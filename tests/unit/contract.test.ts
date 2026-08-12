import { describe, expect, it } from 'vitest';
import { parsePdfCreationRequest } from '@/lib/pdf/contract';
import { PdfServiceError } from '@/lib/pdf/errors';

const valid = {
  html: '<!doctype html><html><head><style>body{color:#111}</style></head><body>Hello</body></html>',
  filename: 'Report.pdf',
  storeResult: false,
  page: {
    format: 'Letter',
    orientation: 'portrait',
    marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
  }
};

describe('PDF creation contract', () => {
  it('normalizes direct and stored defaults', () => {
    expect(parsePdfCreationRequest(valid)).toMatchObject({ storeHtml: false });
    expect(parsePdfCreationRequest({ ...valid, storeResult: true, idempotencyKey: 'operation:12345678' })).toMatchObject({
      storeHtml: true,
      retentionDays: 30
    });
  });

  it('requires one stable idempotency key for every stored request', () => {
    expect(() => parsePdfCreationRequest({ ...valid, storeResult: true }))
      .toThrowError(PdfServiceError);
  });

  it('preserves ordinary direct requests without storage or idempotency fields', () => {
    expect(parsePdfCreationRequest(valid)).toEqual({ ...valid, storeHtml: false });
  });

  it('keeps expectedPageCount optional while preserving an explicit exact assertion', () => {
    expect(parsePdfCreationRequest(valid).expectedPageCount).toBeUndefined();
    expect(parsePdfCreationRequest({ ...valid, expectedPageCount: 3 }).expectedPageCount).toBe(3);
  });

  it.each([
    [{ ...valid, extra: true }],
    [{ ...valid, filename: '../unsafe.pdf' }],
    [{ ...valid, filename: 'report.txt' }],
    [{ ...valid, storeHtml: true }],
    [{ ...valid, idempotencyKey: 'direct:not-allowed' }],
    [{ ...valid, expectedPageCount: 26 }],
    [{ ...valid, page: { ...valid.page, format: 'Tabloid' } }]
  ])('rejects an invalid request', (request) => {
    expect(() => parsePdfCreationRequest(request)).toThrow(PdfServiceError);
  });

  it('rejects HTML over its byte limit', () => {
    expect(() => parsePdfCreationRequest({ ...valid, html: 'a'.repeat(3_500_001) }))
      .toThrowError(/HTML exceeds/);
  });
});
