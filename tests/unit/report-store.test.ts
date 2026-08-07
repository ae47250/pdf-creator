import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfServiceError } from '@/lib/pdf/errors';

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
  idempotencyKey: 'operation:12345678',
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

  afterEach(() => vi.useRealTimers());

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

  it.each([
    [1, '2026-08-08T00:00:00.000Z'],
    [7, '2026-08-14T00:00:00.000Z'],
    [30, '2026-09-06T00:00:00.000Z']
  ] as const)('uses the retention-%i prefix and exact logical expiry', async (retentionDays, expiresAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T00:00:00.000Z'));
    storage.putObject.mockResolvedValue(undefined);

    const result = await storeReport({ ...request, retentionDays, storeHtml: false }, caller, render, 'b'.repeat(64));

    expect(result.manifest.expiresAt).toBe(expiresAt);
    expect(result.manifest.pdf.key).toMatch(new RegExp(`^reports/retention-${retentionDays}/`));
    expect(result.manifest.html).toBeUndefined();
    expect(storage.putObject.mock.calls[1][0]).toMatch(new RegExp(`^reports/retention-${retentionDays}/.+/manifest\\.json$`));
  });

  it('removes the losing report and returns the winner for an identical concurrent request', async () => {
    const winnerReportId = 'r30_00000000-0000-4000-8000-000000000001';
    const winnerManifest = {
      version: 1,
      reportId: winnerReportId,
      caller: caller.id,
      filename: request.filename,
      createdAt: '2026-08-07T00:00:00.000Z',
      expiresAt: '2026-09-06T00:00:00.000Z',
      pdf: { key: 'reports/retention-30/winner/EconPlanner/report.pdf', contentType: 'application/pdf', bytes: 6, sha256: 'a'.repeat(64) },
      html: { key: 'reports/retention-30/winner/EconPlanner/rendered.html', contentType: 'text/html; charset=utf-8', bytes: Buffer.byteLength(request.html), sha256: 'd'.repeat(64) },
      submittedHtmlBytes: Buffer.byteLength(request.html),
      submittedHtmlSha256: 'e'.repeat(64),
      renderedHtmlSha256: 'd'.repeat(64),
      page: request.page,
      pageCount: 1,
      pageDimensions: render.pageDimensions,
      metadata: {},
      versions: { service: '1.0.0', node: 'v24.0.0', puppeteer: '25.1.0', chromium: '149.0.0' },
      requestHash: 'b'.repeat(64),
      idempotencyHash: 'c'.repeat(64)
    };
    storage.putObject.mockResolvedValue(undefined);
    storage.getObject.mockResolvedValue({ bytes: Buffer.from(JSON.stringify(winnerManifest)) });
    identity.claimIdempotency.mockResolvedValue({ won: false, reportId: winnerReportId });

    const result = await storeReport(request, caller, render, 'b'.repeat(64));

    expect(result).toMatchObject({ replayed: true, manifest: { reportId: winnerReportId } });
    expect(storage.deleteObjects).toHaveBeenCalledOnce();
    expect(storage.deleteObjects.mock.calls[0][0]).toHaveLength(3);
  });

  it('removes its report and preserves the 409 conflict for concurrent changed-payload reuse', async () => {
    storage.putObject.mockResolvedValue(undefined);
    identity.claimIdempotency.mockRejectedValue(new PdfServiceError(
      'idempotency_conflict',
      409,
      'The idempotency key was already used for a different request.'
    ));

    await expect(storeReport(request, caller, render, 'b'.repeat(64)))
      .rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    expect(storage.deleteObjects).toHaveBeenCalledOnce();
    expect(storage.deleteObjects.mock.calls[0][0]).toHaveLength(3);
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
