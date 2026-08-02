import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public readonly input: unknown) {}
  }
  return {
    S3Client: class { send = storage.send; },
    DeleteObjectsCommand: Command,
    DeleteObjectCommand: Command,
    GetObjectCommand: Command,
    PutObjectCommand: Command
  };
});

import { deleteObjects } from '@/lib/storage/r2';

describe('R2 cleanup', () => {
  beforeEach(() => {
    vi.stubEnv('PDF_CREATION_R2_ACCOUNT_ID', 'account');
    vi.stubEnv('PDF_CREATION_R2_BUCKET_NAME', 'private-bucket');
    vi.stubEnv('PDF_CREATION_R2_ACCESS_KEY_ID', 'access');
    vi.stubEnv('PDF_CREATION_R2_SECRET_ACCESS_KEY', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejects a bulk delete response containing per-object errors', async () => {
    storage.send.mockResolvedValue({ Errors: [{ Key: 'reports/example/report.pdf', Code: 'AccessDenied' }] });
    await expect(deleteObjects(['reports/example/report.pdf']))
      .rejects.toMatchObject({ code: 'storage_failed' });
  });
});
