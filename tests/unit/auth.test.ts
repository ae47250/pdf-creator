import { describe, expect, it } from 'vitest';
import { authenticateBearer, authorizeRequest } from '@/lib/pdf/auth';
import { PdfServiceError } from '@/lib/pdf/errors';

const current = 'a'.repeat(43);
const previous = 'b'.repeat(43);
const env = {
  PDF_CREATION_PATHFINDER: current,
  PDF_CREATION_PATHFINDER_PREVIOUS: previous
};

describe('bearer authentication', () => {
  it.each([current, previous])('accepts a configured current or previous key', (key) => {
    expect(authenticateBearer(`Bearer ${key}`, env).id).toBe('pathfinder');
  });

  it.each([null, 'Basic value', `Bearer ${'z'.repeat(43)}`])('rejects missing or wrong credentials', (header) => {
    expect(() => authenticateBearer(header, env)).toThrowError(PdfServiceError);
    try {
      authenticateBearer(header, env);
    } catch (error) {
      expect((error as PdfServiceError).code).toBe('unauthorized');
    }
  });

  it('fails closed for short configured keys', () => {
    expect(() => authenticateBearer(`Bearer ${current}`, { PDF_CREATION_TEST: 'short' }))
      .toThrowError(/configuration is invalid/);
  });

  it('fails closed when one key is assigned to multiple caller identities', () => {
    expect(() => authenticateBearer(`Bearer ${current}`, {
      PDF_CREATION_PATHFINDER: current,
      PDF_CREATION_TEST: current
    })).toThrowError(/configuration is invalid/);
  });

  it('enforces caller storage permissions', () => {
    expect(() => authorizeRequest({ id: 'limited', mayStore: false, maxRetentionDays: 1, rateLimitPerMinute: 1 }, { storeResult: true, retentionDays: 1 }))
      .toThrowError(/may not store/);
  });
});
