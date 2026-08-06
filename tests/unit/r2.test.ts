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

import { assertR2Environment, deleteObjects } from '@/lib/storage/r2';

describe('R2 cleanup', () => {
  beforeEach(() => {
    vi.stubEnv('PDF_CREATION_R2_ACCOUNT_ID', 'account');
    vi.stubEnv('PDF_CREATION_R2_BUCKET_NAME', 'private-bucket');
    vi.stubEnv('PDF_CREATION_R2_ACCESS_KEY_ID', 'access');
    vi.stubEnv('PDF_CREATION_R2_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('PDF_CREATION_R2_ENVIRONMENT', 'test');
    vi.stubEnv('VERCEL_ENV', 'preview');
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

  it.each([
    ['production', 'production'],
    ['preview', 'test'],
    ['development', 'test']
  ])('accepts %s only with the %s storage marker', (vercelEnvironment, storageEnvironment) => {
    expect(assertR2Environment({
      VERCEL_ENV: vercelEnvironment,
      PDF_CREATION_R2_ENVIRONMENT: storageEnvironment
    })).toBe(storageEnvironment);
  });

  it.each([
    ['production', 'test'],
    ['preview', 'production'],
    ['development', 'production'],
    ['preview', undefined]
  ])('rejects Vercel %s with storage marker %s', (vercelEnvironment, storageEnvironment) => {
    expect(() => assertR2Environment({
      VERCEL_ENV: vercelEnvironment,
      PDF_CREATION_R2_ENVIRONMENT: storageEnvironment
    })).toThrowError(expect.objectContaining({ code: 'service_unavailable', status: 503 }));
  });
});
