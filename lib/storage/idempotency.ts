import { PdfServiceError } from '@/lib/pdf/errors';
import { sha256 } from '@/lib/pdf/pdf-quality';
import { deleteObject, getObject, isPreconditionFailure, putObject } from './r2';

interface Mapping { requestHash: string; reportId: string; expiresAt: string }

export function idempotencyHash(caller: string, key: string): string {
  return sha256(`${caller}\0${key}`);
}

export async function findIdempotentReport(caller: string, key: string, requestHash: string): Promise<string | null> {
  const objectKey = mappingKey(caller, key);
  const record = await readMapping(objectKey);
  if (!record) return null;
  if (new Date(record.mapping.expiresAt).getTime() <= Date.now()) {
    if (!record.eTag) throw new PdfServiceError('storage_failed', 502, 'An expired idempotency record has no version tag.');
    try {
      await deleteObject(objectKey, record.eTag);
      return null;
    } catch (error) {
      if (isPreconditionFailure(error)) return findIdempotentReport(caller, key, requestHash);
      throw error;
    }
  }
  if (record.mapping.requestHash !== requestHash) conflict();
  return record.mapping.reportId;
}

export async function claimIdempotency(
  caller: string,
  key: string,
  mapping: Mapping
): Promise<{ won: true } | { won: false; reportId: string }> {
  const objectKey = mappingKey(caller, key);
  try {
    await putObject(objectKey, JSON.stringify(mapping), 'application/json', { IfNoneMatch: '*' });
    return { won: true };
  } catch (error) {
    if (!isPreconditionFailure(error)) throw error;
    const existing = await readMapping(objectKey);
    if (!existing || existing.mapping.requestHash !== mapping.requestHash) conflict();
    return { won: false, reportId: existing.mapping.reportId };
  }
}

function mappingKey(caller: string, key: string): string {
  return `idempotency/${caller}/${idempotencyHash(caller, key)}.json`;
}

async function readMapping(key: string): Promise<{ mapping: Mapping; eTag?: string } | null> {
  try {
    const object = await getObject(key);
    const value = JSON.parse(new TextDecoder().decode(object.bytes)) as Partial<Mapping>;
    if (typeof value.requestHash !== 'string' || typeof value.reportId !== 'string' || typeof value.expiresAt !== 'string') {
      throw new Error('invalid mapping');
    }
    return { mapping: value as Mapping, eTag: object.eTag };
  } catch (error) {
    if (error instanceof PdfServiceError && error.status === 404) return null;
    if (error instanceof PdfServiceError) throw error;
    throw new PdfServiceError('storage_failed', 502, 'An idempotency record is invalid.');
  }
}

function conflict(): never {
  throw new PdfServiceError('idempotency_conflict', 409, 'The idempotency key was already used for a different request.');
}
