import { createHash, timingSafeEqual } from 'node:crypto';
import { PdfServiceError } from './errors';
import type { Caller } from './types';

interface CallerDefinition extends Caller {
  env: string;
}

const CALLERS: CallerDefinition[] = [
  { id: 'econplanner', env: 'PDF_CREATION_ECONPLANNER', mayStore: true, maxRetentionDays: 30, rateLimitPerMinute: 10 },
  { id: 'pathfinder', env: 'PDF_CREATION_PATHFINDER', mayStore: true, maxRetentionDays: 30, rateLimitPerMinute: 10 },
  { id: 'jobsearch', env: 'PDF_CREATION_JOBSEARCH', mayStore: true, maxRetentionDays: 30, rateLimitPerMinute: 10 },
  { id: 'treeservice', env: 'PDF_CREATION_TREESERVICE', mayStore: true, maxRetentionDays: 30, rateLimitPerMinute: 10 },
  { id: 'test', env: 'PDF_CREATION_TEST', mayStore: true, maxRetentionDays: 30, rateLimitPerMinute: 30 }
];

export function authenticateBearer(
  authorization: string | null,
  environment: Record<string, string | undefined> = process.env
): Caller {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  const supplied = match?.[1] ?? '';
  const suppliedDigest = digest(supplied);
  let configuredCount = 0;
  let matched: CallerDefinition | undefined;
  const matchedCallerIds = new Set<string>();

  for (const caller of CALLERS) {
    for (const suffix of ['', '_PREVIOUS']) {
      const configured = environment[`${caller.env}${suffix}`];
      if (!configured) continue;
      configuredCount += 1;
      if (configured.length < 32) {
        throw new PdfServiceError(
          'service_unavailable',
          503,
          'The PDF service authentication configuration is invalid.'
        );
      }
      const isMatch = timingSafeEqual(suppliedDigest, digest(configured));
      if (isMatch) {
        matched = caller;
        matchedCallerIds.add(caller.id);
      }
    }
  }

  if (configuredCount === 0) {
    throw new PdfServiceError(
      'service_unavailable',
      503,
      'The PDF service authentication configuration is unavailable.'
    );
  }
  if (matchedCallerIds.size > 1) {
    throw new PdfServiceError(
      'service_unavailable',
      503,
      'The PDF service authentication configuration is invalid.'
    );
  }
  if (!match || !matched) {
    throw new PdfServiceError('unauthorized', 401, 'A valid bearer key is required.');
  }

  return {
    id: matched.id,
    mayStore: matched.mayStore,
    maxRetentionDays: matched.maxRetentionDays,
    rateLimitPerMinute: matched.rateLimitPerMinute
  };
}

export function authorizeRequest(caller: Caller, request: { storeResult: boolean; retentionDays?: number }): void {
  if (request.storeResult && !caller.mayStore) {
    throw new PdfServiceError('caller_forbidden', 403, 'This caller may not store PDF results.');
  }
  if (request.retentionDays && request.retentionDays > caller.maxRetentionDays) {
    throw new PdfServiceError('caller_forbidden', 403, 'The requested retention is not allowed for this caller.');
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function testCaller(): Caller {
  return { id: 'test', mayStore: true, maxRetentionDays: 30, rateLimitPerMinute: 30 };
}
