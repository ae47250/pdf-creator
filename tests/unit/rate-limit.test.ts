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
const originalVercelEnvironment = process.env.VERCEL_ENV;

describe('programmatic Firewall rate limiting', () => {
  beforeEach(() => {
    process.env.VERCEL = '1';
    firewall.unstable_checkRateLimit.mockResolvedValue({ rateLimited: false });
    renderer.renderPdf.mockResolvedValue({
      pdf: new Uint8Array([37, 80, 68, 70]), renderedHtml: request.html, pageCount: 1,
      pageDimensions: [{ widthPoints: 612, heightPoints: 792 }], sha256: 'a'.repeat(64), markerCount: 0,
      renderer: { source: 'installed', product: 'Chrome', version: '149.0.0.0' }, layoutDiagnostics: null
    });
  });

  afterEach(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnvironment;
    vi.clearAllMocks();
  });

  it('uses the one shared Firewall rule and separates callers by key', async () => {
    await createPdf(request, caller, 'request-id', 'https://service.example', new Request('https://service.example/api/console/pdfs'));

    expect(FIREWALL_RATE_LIMIT_ID).toBe('pdf-creation');
    expect(firewall.unstable_checkRateLimit).toHaveBeenCalledWith('pdf-creation', expect.objectContaining({ rateLimitKey: 'test' }));
  });

  it('fails closed when the Vercel Firewall rule is unavailable', async () => {
    firewall.unstable_checkRateLimit.mockResolvedValue({ rateLimited: false, error: 'not-found' });
    await expect(createPdf(request, caller, 'request-id', 'https://service.example'))
      .rejects.toMatchObject({ code: 'service_unavailable', status: 503 });
    expect(renderer.renderPdf).not.toHaveBeenCalled();
  });

  it('skips the external rule in local Vercel development', async () => {
    process.env.VERCEL_ENV = 'development';
    await createPdf(request, caller, 'request-id', 'http://localhost:3000');
    expect(firewall.unstable_checkRateLimit).not.toHaveBeenCalled();
    expect(renderer.renderPdf).toHaveBeenCalledOnce();
  });

  it('rejects a busy request before it consumes the distributed limit', async () => {
    let finishRender!: () => void;
    renderer.renderPdf.mockImplementationOnce(() => new Promise((resolve) => {
      finishRender = () => resolve({
        pdf: new Uint8Array([37, 80, 68, 70]), renderedHtml: request.html, pageCount: 1,
        pageDimensions: [{ widthPoints: 612, heightPoints: 792 }], sha256: 'a'.repeat(64), markerCount: 0,
        renderer: { source: 'installed', product: 'Chrome', version: '149.0.0.0' }, layoutDiagnostics: null
      });
    }));
    const first = createPdf(request, caller, 'first', 'https://service.example');
    await vi.waitFor(() => expect(renderer.renderPdf).toHaveBeenCalledOnce());

    await expect(createPdf(request, caller, 'second', 'https://service.example'))
      .rejects.toMatchObject({ code: 'renderer_busy', status: 429 });
    expect(firewall.unstable_checkRateLimit).toHaveBeenCalledOnce();

    finishRender();
    await first;
  });
});
