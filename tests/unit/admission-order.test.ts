import { afterEach, describe, expect, it, vi } from 'vitest';

const firewall = vi.hoisted(() => ({ unstable_checkRateLimit: vi.fn() }));
const renderer = vi.hoisted(() => ({ renderPdf: vi.fn() }));
const idempotency = vi.hoisted(() => ({ findIdempotentReport: vi.fn() }));
const reports = vi.hoisted(() => ({ readManifest: vi.fn(), storeReport: vi.fn() }));

vi.mock('@vercel/firewall', () => firewall);
vi.mock('@/lib/pdf/renderer', () => renderer);
vi.mock('@/lib/storage/idempotency', () => idempotency);
vi.mock('@/lib/storage/report-store', () => reports);

import { createPdf } from '@/lib/pdf/service';

const caller = { id: 'test', mayStore: true, maxRetentionDays: 30 as const, rateLimitPerMinute: 30 };
const request = {
  html: '<!doctype html><html><head></head><body>stored</body></html>',
  filename: 'Stored.pdf',
  storeResult: true,
  storeHtml: false,
  retentionDays: 1 as const,
  idempotencyKey: 'stable-key',
  page: { format: 'Letter' as const, orientation: 'portrait' as const, marginsInches: { top: 0, right: 0, bottom: 0, left: 0 } }
};

describe('PDF admission order', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns a completed idempotent replay before renderer admission and rate limiting', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    idempotency.findIdempotentReport.mockResolvedValue('r1_123e4567-e89b-42d3-a456-426614174000');
    reports.readManifest.mockResolvedValue({
      version: 1,
      reportId: 'r1_123e4567-e89b-42d3-a456-426614174000',
      caller: 'test',
      filename: 'Stored.pdf',
      createdAt: '2026-08-06T00:00:00.000Z',
      expiresAt: '2026-08-07T00:00:00.000Z',
      pdf: { key: 'reports/example/Test/report.pdf', contentType: 'application/pdf', bytes: 100, sha256: 'a'.repeat(64) },
      submittedHtmlBytes: 64,
      submittedHtmlSha256: 'b'.repeat(64),
      renderedHtmlSha256: 'c'.repeat(64),
      page: request.page,
      pageCount: 1,
      pageDimensions: [{ widthPoints: 612, heightPoints: 792 }],
      metadata: {},
      versions: { service: '1.0.0', node: '24', puppeteer: '25', chromium: '149' },
      requestHash: 'd'.repeat(64)
    });

    const result = await createPdf(request, caller, 'request-id', 'https://preview.example');

    expect(result).toMatchObject({ kind: 'stored', body: { storage: { idempotentReplay: true } } });
    expect(firewall.unstable_checkRateLimit).not.toHaveBeenCalled();
    expect(renderer.renderPdf).not.toHaveBeenCalled();
    expect(reports.storeReport).not.toHaveBeenCalled();
  });
});
