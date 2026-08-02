import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firewall = vi.hoisted(() => ({ unstable_checkRateLimit: vi.fn() }));
const renderer = vi.hoisted(() => ({ renderPdf: vi.fn() }));

vi.mock('@vercel/firewall', () => firewall);
vi.mock('@/lib/pdf/renderer', () => renderer);

import { createPdf, FIREWALL_RATE_LIMIT_ID } from '@/lib/pdf/service';

const caller = { id: 'test', mayStore: true, maxRetentionDays: 30 as const, rateLimitPerMinute: 30 };
const request = {
  html: '<!doctype html><html><head></head><body>test</body></html>',
  filename: 'Test.pdf',
  storeResult: false,
  storeHtml: false,
  page: { format: 'Letter' as const, orientation: 'portrait' as const, marginsInches: { top: 0, right: 0, bottom: 0, left: 0 } }
};
const originalVercel = process.env.VERCEL;

describe('programmatic Firewall rate limiting', () => {
  beforeEach(() => {
    process.env.VERCEL = '1';
    firewall.unstable_checkRateLimit.mockResolvedValue({ rateLimited: false });
    renderer.renderPdf.mockResolvedValue({
      pdf: new Uint8Array([37, 80, 68, 70]), renderedHtml: request.html, pageCount: 1,
      pageDimensions: [{ widthPoints: 612, heightPoints: 792 }], sha256: 'a'.repeat(64), markerCount: 0
    });
  });

  afterEach(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    vi.clearAllMocks();
  });

  it('uses the one shared Firewall rule and separates callers by key', async () => {
    await createPdf(request, caller, 'request-id', 'https://service.example', new Request('https://service.example/api/console/pdfs'));

    expect(FIREWALL_RATE_LIMIT_ID).toBe('pdf-creation');
    expect(firewall.unstable_checkRateLimit).toHaveBeenCalledWith('pdf-creation', expect.objectContaining({ rateLimitKey: 'test' }));
  });
});
