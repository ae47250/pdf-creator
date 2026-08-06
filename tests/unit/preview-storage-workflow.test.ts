import { describe, expect, it } from 'vitest';
// @ts-expect-error The verification runner is intentionally plain Node.js so it can run without a build step.
import {
  assertHeadBucketIsolation,
  lifecycleInspectionRequest,
  parseLifecycleApiResponse,
  parseRetryAfterSeconds,
  validateCanaryLedger,
  validateLifecycleApiResponse
} from '@/scripts/run-preview-storage-workflow.mjs';
// @ts-expect-error The verification utilities are intentionally plain Node.js modules.
import { busyRetryDelayMs, canStartAdmissionRetry } from '@/scripts/pdf-test-utils.mjs';

describe('isolated Preview storage guards', () => {
  it('requires test 200 followed by Production 403', () => {
    expect(() => assertHeadBucketIsolation(200, 403)).not.toThrow();
    for (const [testStatus, productionStatus] of [[403, 403], [200, 400], [200, 404], [200, 200], [0, 403]]) {
      expect(() => assertHeadBucketIsolation(testStatus, productionStatus)).toThrow();
    }
  });

  it('validates the Cloudflare lifecycle response for the test bucket', () => {
    const valid = {
      success: true,
      result: {
        rules: [
          { enabled: true, conditions: { prefix: 'reports/retention-1/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 172800 } } },
          { enabled: true, conditions: { prefix: 'reports/retention-7/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 691200 } } },
          { enabled: true, conditions: { prefix: 'reports/retention-30/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 2678400 } } },
          { enabled: true, conditions: { prefix: 'Test/idempotency/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 2678400 } } },
          { enabled: true, conditions: { prefix: '' }, abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 604800 } } }
        ]
      }
    };
    expect(validateLifecycleApiResponse(valid)).toBe(true);
    expect(parseLifecycleApiResponse(200, JSON.stringify(valid))).toBe(true);
    expect(() => parseLifecycleApiResponse(403, '')).toThrow('test-lifecycle-read-failed');
    expect(() => parseLifecycleApiResponse(200, '{')).toThrow('test-lifecycle-response-invalid');
    for (const invalid of [
      null,
      { success: false, result: { rules: [] } },
      { success: true, result: { rules: [] } },
      { success: true, result: { rules: [{ enabled: false, conditions: { prefix: 'reports/retention-1/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 172800 } } }] } },
      { success: true, result: { rules: [{ enabled: true, conditions: { prefix: 'reports/retention-1/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 1 } } }] } }
    ]) {
      expect(() => validateLifecycleApiResponse(invalid)).toThrow();
    }
  });

  it('builds only a GET request for the approved test bucket', () => {
    const request = lifecycleInspectionRequest('pdf-tests-bucket', {
      PDF_CREATION_R2_ACCOUNT_ID: 'account-id',
      PDF_CREATION_R2_EXPECTED_TEST_BUCKET_NAME: 'pdf-tests-bucket',
      PDF_CREATION_R2_LIFECYCLE_READ_TOKEN: 'local-token',
      PDF_CREATION_R2_JURISDICTION: ''
    });
    expect(request.options.method).toBe('GET');
    expect(request.url).toContain('/r2/buckets/pdf-tests-bucket/lifecycle');
    expect(() => lifecycleInspectionRequest('pdf-html-files', {
      PDF_CREATION_R2_ACCOUNT_ID: 'account-id',
      PDF_CREATION_R2_EXPECTED_TEST_BUCKET_NAME: 'pdf-tests-bucket',
      PDF_CREATION_R2_LIFECYCLE_READ_TOKEN: 'local-token'
    })).toThrow('blocked-lifecycle-bucket-not-approved-test-bucket');
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
