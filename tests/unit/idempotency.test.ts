import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfServiceError } from '@/lib/pdf/errors';

const storage = vi.hoisted(() => ({
  getObject: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  isPreconditionFailure: vi.fn((error: unknown) => (error as { status?: number }).status === 412)
}));

vi.mock('@/lib/storage/r2', () => storage);

import { claimIdempotency, findIdempotentReport, idempotencyHash } from '@/lib/storage/idempotency';
import { hashRequest } from '@/lib/pdf/service';

const mapping = { requestHash: 'a'.repeat(64), reportId: 'r30_00000000-0000-4000-8000-000000000001', expiresAt: '2099-01-01T00:00:00.000Z' };

describe('idempotency records', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses a caller-scoped one-way object key', () => {
    expect(idempotencyHash('pathfinder', 'safe:key')).toMatch(/^[0-9a-f]{64}$/);
    expect(idempotencyHash('pathfinder', 'safe:key')).not.toBe(idempotencyHash('test', 'safe:key'));
  });

  it('ignores diagnostic correlation IDs when hashing a retry', () => {
    const request = {
      html: '<!doctype html><html><head></head><body>retry</body></html>',
      filename: 'Retry.pdf',
      storeResult: true,
      storeHtml: true,
      retentionDays: 30 as const,
      idempotencyKey: 'safe:key',
      correlationId: 'attempt-one',
      page: {
        format: 'Letter' as const,
        orientation: 'portrait' as const,
        marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
      }
    };
    expect(hashRequest(request)).toBe(hashRequest({ ...request, correlationId: 'attempt-two' }));
    expect(hashRequest(request)).not.toBe(hashRequest({ ...request, filename: 'Different.pdf' }));
  });

  it('replays the same request and rejects a different request', async () => {
    storage.getObject.mockResolvedValue({ bytes: Buffer.from(JSON.stringify(mapping)), eTag: 'etag-1' });
    await expect(findIdempotentReport('test', 'safe:key', mapping.requestHash)).resolves.toBe(mapping.reportId);
    await expect(findIdempotentReport('test', 'safe:key', 'b'.repeat(64))).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('returns the racing winner after a conditional-create loss', async () => {
    storage.putObject.mockRejectedValue({ status: 412 });
    storage.getObject.mockResolvedValue({ bytes: Buffer.from(JSON.stringify(mapping)), eTag: 'etag-1' });
    await expect(claimIdempotency('test', 'safe:key', mapping)).resolves.toEqual({ won: false, reportId: mapping.reportId });
  });

  it('treats a missing mapping as unused', async () => {
    storage.getObject.mockRejectedValue(new PdfServiceError('storage_failed', 404, 'missing'));
    await expect(findIdempotentReport('test', 'safe:key', mapping.requestHash)).resolves.toBeNull();
  });

  it('conditionally removes an expired mapping before reuse', async () => {
    storage.getObject.mockResolvedValue({
      bytes: Buffer.from(JSON.stringify({ ...mapping, expiresAt: '2000-01-01T00:00:00.000Z' })),
      eTag: 'stale-etag'
    });
    storage.deleteObject.mockResolvedValue(undefined);
    await expect(findIdempotentReport('test', 'safe:key', mapping.requestHash)).resolves.toBeNull();
    expect(storage.deleteObject).toHaveBeenCalledWith(expect.stringMatching(/^idempotency\/test\//), 'stale-etag');
  });
});
