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
  beforeEach(() => {
    vi.clearAllMocks();
    storage.deleteObjects.mockResolvedValue(undefined);
    identity.claimIdempotency.mockResolvedValue({ won: true });
  });

  it('writes artifacts before the manifest', async () => {
    storage.putObject.mockResolvedValue(undefined);
    const result = await storeReport(request, caller, render, 'b'.repeat(64));
    expect(result.manifest.submittedHtmlBytes).toBe(Buffer.byteLength(request.html));
    expect(storage.putObject).toHaveBeenCalledTimes(3);
    expect(storage.putObject.mock.calls[0][0]).toMatch(/^reports\/retention-30\/.+\/EconPlanner\/report\.pdf$/);
    expect(storage.putObject.mock.calls[1][0]).toMatch(/^reports\/retention-30\/.+\/EconPlanner\/rendered\.html$/);
    expect(storage.putObject.mock.calls[2][0]).toMatch(/manifest\.json$/);
    expect(storage.putObject.mock.calls[0][3]).toEqual({ IfNoneMatch: '*' });
    expect(storage.putObject.mock.calls[1][3]).toEqual({ IfNoneMatch: '*' });
    expect(storage.putObject.mock.calls[2][3]).toEqual({ IfNoneMatch: '*' });
  });

  it('awaits all artifact writes and cleans only confirmed writes after a partial failure', async () => {
    storage.putObject.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('injected R2 failure'));
    await expect(storeReport(request, caller, render, 'b'.repeat(64))).rejects.toMatchObject({ code: 'storage_failed' });
    expect(storage.deleteObjects).toHaveBeenCalledOnce();
    expect(storage.deleteObjects.mock.calls[0][0]).toEqual([expect.stringMatching(/report\.pdf$/)]);
  });

  it('never deletes a pre-existing manifest after a conditional collision', async () => {
    storage.putObject
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('collision'), { name: 'PreconditionFailed' }));

    await expect(storeReport(request, caller, render, 'b'.repeat(64))).rejects.toMatchObject({ code: 'storage_failed' });
    const deleted = storage.deleteObjects.mock.calls[0][0] as string[];
    expect(deleted).toHaveLength(2);
    expect(deleted.every((key) => !key.endsWith('/manifest.json'))).toBe(true);
  });

  it('logs a redacted cleanup failure without masking the original error', async () => {
    storage.putObject.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('write failed'));
    storage.deleteObjects.mockRejectedValueOnce(new Error('cleanup failed'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(storeReport(request, caller, render, 'b'.repeat(64))).rejects.toMatchObject({
      code: 'storage_failed',
      message: 'The report artifacts could not be stored.'
    });
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      event: 'storage_cleanup_failed',
      phase: 'artifact_write',
      count: 1
    });
    log.mockRestore();
  });

  it('does not delete artifacts after an ambiguous manifest timeout', async () => {
    storage.putObject
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new (await import('@/lib/pdf/errors')).PdfServiceError('storage_failed', 504, 'Timed out.'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(storeReport(request, caller, render, 'b'.repeat(64))).rejects.toMatchObject({ code: 'storage_failed' });
    expect(storage.deleteObjects).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      event: 'storage_orphan_possible',
      phase: 'manifest_write',
      count: 1
    });
    log.mockRestore();
  });
});
