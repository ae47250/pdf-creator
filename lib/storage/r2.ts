import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput
} from '@aws-sdk/client-s3';
import { PdfServiceError } from '@/lib/pdf/errors';
import { LIMITS } from '@/lib/pdf/limits';

let client: S3Client | undefined;

function config() {
  const accountId = process.env.PDF_CREATION_R2_ACCOUNT_ID;
  const bucket = process.env.PDF_CREATION_R2_BUCKET_NAME;
  const accessKeyId = process.env.PDF_CREATION_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.PDF_CREATION_R2_SECRET_ACCESS_KEY;
  const jurisdiction = process.env.PDF_CREATION_R2_JURISDICTION;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new PdfServiceError('service_unavailable', 503, 'PDF storage is not configured.');
  }
  const suffix = jurisdiction ? `.${jurisdiction}` : '';
  return {
    bucket,
    endpoint: `https://${accountId}${suffix}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  };
}

function r2(): { client: S3Client; bucket: string } {
  const settings = config();
  client ??= new S3Client({
    region: 'auto',
    endpoint: settings.endpoint,
    credentials: settings.credentials,
    maxAttempts: 3
  });
  return { client, bucket: settings.bucket };
}

export async function putObject(
  key: string,
  body: Uint8Array | string,
  contentType: string,
  options: Pick<PutObjectCommandInput, 'IfNoneMatch'> = {}
): Promise<void> {
  const { client: storage, bucket } = r2();
  try {
    await storageTimeout(storage.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'private, no-store',
      ...options
    })));
  } catch (error) {
    if (isPreconditionFailure(error)) throw error;
    if (error instanceof PdfServiceError) throw error;
    throw new PdfServiceError('storage_failed', 502, 'A storage write failed.');
  }
}

export async function getObject(key: string): Promise<{ bytes: Uint8Array; contentType?: string; contentLength?: number; eTag?: string }> {
  const { client: storage, bucket } = r2();
  try {
    const response = await storageTimeout(storage.send(new GetObjectCommand({ Bucket: bucket, Key: key })));
    if (!response.Body) throw new Error('empty body');
    return {
      bytes: await storageTimeout(response.Body.transformToByteArray()),
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      eTag: response.ETag
    };
  } catch (error) {
    if (isNotFound(error)) throw new PdfServiceError('storage_failed', 404, 'The stored report was not found.');
    if (error instanceof PdfServiceError) throw error;
    throw new PdfServiceError('storage_failed', 502, 'A storage read failed.');
  }
}

export async function deleteObject(key: string, ifMatch: string): Promise<void> {
  const { client: storage, bucket } = r2();
  try {
    await storageTimeout(storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, IfMatch: ifMatch })));
  } catch (error) {
    if (isPreconditionFailure(error)) throw error;
    if (error instanceof PdfServiceError) throw error;
    throw new PdfServiceError('storage_failed', 502, 'An expired idempotency record could not be removed.');
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { client: storage, bucket } = r2();
  try {
    const response = await storageTimeout(storage.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true }
    })));
    if (response.Errors?.length) {
      throw new PdfServiceError('storage_failed', 502, 'Storage cleanup failed.');
    }
  } catch {
    throw new PdfServiceError('storage_failed', 502, 'Storage cleanup failed.');
  }
}

export function isPreconditionFailure(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.name === 'PreconditionFailed' || candidate?.$metadata?.httpStatusCode === 412;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.name === 'NoSuchKey' || candidate?.name === 'NotFound' || candidate?.$metadata?.httpStatusCode === 404;
}

async function storageTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PdfServiceError('storage_failed', 504, 'A storage operation timed out.')), LIMITS.storageMs);
    })
  ]).finally(() => clearTimeout(timer!));
}
