import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ putObject: vi.fn(), deleteObjects: vi.fn(), getObject: vi.fn() }));
const identity = vi.hoisted(() => ({ claimIdempotency: vi.fn(), idempotencyHash: vi.fn(() => 'c'.repeat(64)) }));
vi.mock('@/lib/storage/r2', () => storage);
vi.mock('@/lib/storage/idempotency', () => identity);

import { storeReport } from '@/lib/storage/report-store';

const request = {
  html: '<!doctype html><html><head></head><body>stored</body></html>',
  filename: 'Stored.pdf',
  storeResult: true,
  storeHtml: true,
  retentionDays: 30 as const,
  page: { format: 'Letter' as const, orientation: 'portrait' as const, marginsInches: { top: 0, right: 0, bottom: 0, left: 0 } }
};
const caller = { id: 'econplanner', mayStore: true, maxRetentionDays: 30 as const, rateLimitPerMinute: 10 };
const render = {
  pdf: new Uint8Array([37, 80, 68, 70, 45, 1]),
  renderedHtml: request.html,
  pageCount: 1,
  pageDimensions: [{ widthPoints: 612, heightPoints: 792 }],
  sha256: 'a'.repeat(64),
  markerCount: 0
};

describe('manifest-last report storage', () => {
  beforeEach(() => { vi.clearAllMocks(); storage.deleteObjects.mockResolvedValue(undefined); });

  it('writes artifacts before the manifest', async () => {
    storage.putObject.mockResolvedValue(undefined);
    const result = await storeReport(request, caller, render, 'b'.repeat(64));
    expect(result.manifest.submittedHtmlBytes).toBe(Buffer.byteLength(request.html));
    expect(storage.putObject).toHaveBeenCalledTimes(3);
    expect(storage.putObject.mock.calls[0][0]).toMatch(/^EconPlanner\/reports\/retention-30\/.+\/report\.pdf$/);
    expect(storage.putObject.mock.calls[1][0]).toMatch(/^EconPlanner\/reports\/retention-30\/.+\/rendered\.html$/);
    expect(storage.putObject.mock.calls[2][0]).toMatch(/manifest\.json$/);
    expect(storage.putObject.mock.calls[2][3]).toEqual({ IfNoneMatch: '*' });
  });

  it('awaits all artifact writes and cleans every attempted key after a partial failure', async () => {
    storage.putObject.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('injected R2 failure'));
    await expect(storeReport(request, caller, render, 'b'.repeat(64))).rejects.toMatchObject({ code: 'storage_failed' });
    expect(storage.deleteObjects).toHaveBeenCalledOnce();
    expect(storage.deleteObjects.mock.calls[0][0]).toHaveLength(2);
  });
});
