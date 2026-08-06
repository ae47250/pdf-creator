import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { POST } from '@/app/api/v1/pdfs/route';
import { parsePdfCreationRequest } from '@/lib/pdf/contract';
import {
  invalidScenarios,
  malformedCssScenario,
  oversizedPayload,
  payloadFor,
  successFixtures,
  TEST_BEARER_KEY
} from '../regression/fixtures';

const originalTestKey = process.env.PDF_CREATION_TEST;

function request(payload: unknown, authorization = `Bearer ${TEST_BEARER_KEY}`): Request {
  return new Request('http://127.0.0.1:3202/api/v1/pdfs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {})
    },
    body: JSON.stringify(payload)
  });
}

describe.sequential('real local API regression path', () => {
  beforeAll(() => { process.env.PDF_CREATION_TEST = TEST_BEARER_KEY; });
  beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => undefined); });
  afterAll(() => {
    vi.restoreAllMocks();
    if (originalTestKey === undefined) delete process.env.PDF_CREATION_TEST;
    else process.env.PDF_CREATION_TEST = originalTestKey;
  });

  it('returns a valid, parseable PDF with structural diagnostics', async () => {
    const response = await POST(request(payloadFor(successFixtures.minimal)));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('inline; filename="Minimal_Report.pdf"');
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    expect(pdf.getPageCount()).toBe(1);
    expect(response.headers.get('x-pdf-page-count')).toBe('1');
    expect(response.headers.get('x-pdf-sha256')).toMatch(/^[0-9a-f]{64}$/);
    expect(response.headers.get('x-pdf-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  }, 45_000);

  it.each(invalidScenarios)('handles $id with a predictable controlled response', async (scenario) => {
    const response = await POST(request(scenario.payload, scenario.authorization === undefined ? `Bearer ${TEST_BEARER_KEY}` : scenario.authorization));
    const body = await response.json();
    expect(response.status).toBe(scenario.expectedStatus);
    expect(body.error.code).toBe(scenario.expectedCode);
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain(TEST_BEARER_KEY);
    expect(JSON.stringify(body)).not.toContain('<script>');
  });

  it('documents that recoverable malformed CSS is currently accepted by the tolerant parser', async () => {
    const response = await POST(request(malformedCssScenario.payload));
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  }, 45_000);

  it('enforces the HTML payload ceiling before rendering', async () => {
    expect(() => parsePdfCreationRequest(oversizedPayload())).toThrowError(/HTML exceeds/);
    const response = await POST(request(oversizedPayload()));
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('request_too_large');
  });

  it('keeps sequential application CSS, content, filenames, and request IDs isolated', async () => {
    const blue = await POST(request(payloadFor(successFixtures.appBlue)));
    const blueBytes = new Uint8Array(await blue.arrayBuffer());
    const gold = await POST(request(payloadFor(successFixtures.appGold)));
    const goldBytes = new Uint8Array(await gold.arrayBuffer());

    expect(blue.status).toBe(200);
    expect(gold.status).toBe(200);
    expect(blue.headers.get('content-disposition')).toContain('Application_Blue.pdf');
    expect(gold.headers.get('content-disposition')).toContain('Application_Gold.pdf');
    expect(blue.headers.get('x-pdf-request-id')).not.toBe(gold.headers.get('x-pdf-request-id'));
    expect(blue.headers.get('x-pdf-sha256')).not.toBe(gold.headers.get('x-pdf-sha256'));
    await expect(PDFDocument.load(blueBytes)).resolves.toBeDefined();
    await expect(PDFDocument.load(goldBytes)).resolves.toBeDefined();
  }, 60_000);
});
