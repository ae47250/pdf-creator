import { describe, expect, it } from 'vitest';
// @ts-expect-error The verification runner is intentionally plain Node.js so it can run without a build step.
import { assertHeadBucketIsolation, parseRetryAfterSeconds, validateCanaryLedger } from '@/scripts/run-preview-storage-workflow.mjs';
// @ts-expect-error The verification utilities are intentionally plain Node.js modules.
import { busyRetryDelayMs, canStartAdmissionRetry } from '@/scripts/pdf-test-utils.mjs';

describe('isolated Preview storage guards', () => {
  it('requires test 200 followed by Production 403', () => {
    expect(() => assertHeadBucketIsolation(200, 403)).not.toThrow();
    for (const [testStatus, productionStatus] of [[403, 403], [200, 400], [200, 404], [200, 200], [0, 403]]) {
      expect(() => assertHeadBucketIsolation(testStatus, productionStatus)).toThrow();
    }
  });

  it('accepts only complete canary ledger entries and exact remaining keys', () => {
    const canaries = [{
      prefix: 'reports/retention-1/canary.json',
      createdAt: '2026-08-06T00:00:00.000Z',
      expectedExpiration: '2026-08-08T00:00:00.000Z',
      scheduledObservation: '2026-08-09T00:00:00.000Z'
    }];
    expect(validateCanaryLedger([canaries[0].prefix], canaries)).toBe(true);
    expect(() => validateCanaryLedger(['reports/retention-1/unidentified.json'], canaries)).toThrow('unidentified-object-remains');
    expect(() => validateCanaryLedger([canaries[0].prefix], [{ ...canaries[0], scheduledObservation: '' }])).toThrow('invalid-lifecycle');
  });

  it('rejects missing, malformed, and date-based Retry-After values', () => {
    expect(parseRetryAfterSeconds('1')).toBe(1);
    expect(parseRetryAfterSeconds('60')).toBe(60);
    for (const value of [null, '', '-1', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      expect(() => parseRetryAfterSeconds(value)).toThrow('invalid-retry-after');
    }
  });

  it('uses bounded full jitter and never starts at or beyond the admission deadline', () => {
    expect(busyRetryDelayMs(1, 0)).toBe(1000);
    expect(busyRetryDelayMs(2, 1)).toBe(2000);
    expect(busyRetryDelayMs(3, 1)).toBe(4000);
    expect(busyRetryDelayMs(4, 1)).toBe(4000);
    expect(canStartAdmissionRetry(10_000, 1_000, 15_000)).toBe(true);
    expect(canStartAdmissionRetry(14_000, 1_000, 15_000)).toBe(false);
    expect(canStartAdmissionRetry(15_000, 0, 15_000)).toBe(false);
  });
});
