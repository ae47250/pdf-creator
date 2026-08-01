import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '@/contracts/pdf-creation.schema.json';
import { PdfServiceError } from './errors';
import { LIMITS } from './limits';
import type { PdfCreationRequest } from './types';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

export function parsePdfCreationRequest(value: unknown): PdfCreationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest(validate.errors);
  }

  const normalized = structuredClone(value) as Record<string, unknown>;
  if (normalized.storeResult === true) {
    normalized.storeHtml ??= true;
    normalized.retentionDays ??= 30;
  } else if (normalized.storeResult === false) {
    normalized.storeHtml ??= false;
  }

  if (!validate(normalized)) throw invalidRequest(validate.errors);

  const request = normalized as unknown as PdfCreationRequest;
  const htmlBytes = Buffer.byteLength(request.html, 'utf8');
  if (htmlBytes > LIMITS.htmlBytes) {
    throw new PdfServiceError(
      'request_too_large',
      413,
      `The HTML exceeds the ${LIMITS.htmlBytes}-byte limit.`
    );
  }

  if (Buffer.byteLength(request.filename, 'ascii') > 120) {
    throw invalidRequest([]);
  }
  return request;
}

function invalidRequest(errors: ErrorObject[] | null | undefined): PdfServiceError {
  return new PdfServiceError(
    'invalid_request',
    400,
    'The request does not match the PDF creation contract.',
    (errors ?? []).map(({ instancePath, keyword, message }) => ({
      path: instancePath || '/',
      keyword,
      message
    }))
  );
}

export async function readJsonRequest(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new PdfServiceError('json_required', 415, 'Content-Type must be application/json.');
  }

  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > LIMITS.requestBytes) {
    throw new PdfServiceError('request_too_large', 413, 'The request body is too large.');
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > LIMITS.requestBytes) {
    throw new PdfServiceError('request_too_large', 413, 'The request body is too large.');
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PdfServiceError('invalid_json', 400, 'The request body is not valid UTF-8 JSON.');
  }
}
