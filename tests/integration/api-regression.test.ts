import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { POST } from '@/app/api/v1/pdfs/route';
import { parsePdfCreationRequest } from '@/lib/pdf/contract';
// @ts-expect-error The runtime helper is deliberately plain ESM for use by both Node and Playwright.
import { extractPdfText, extractPdfTextByPage, renderPdfPages, runTimestamp, validatePdfBuffer, writeJson } from '../../scripts/pdf-test-utils.mjs';
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

  it('reports all prohibited elements with static print guidance through the real API path', async () => {
    const html = '<!doctype html><html><head></head><body><button onclick="activate()">Report</button><form><input></form><script>activate()</script><iframe></iframe></body></html>';
    const response = await POST(request({ ...payloadFor(successFixtures.minimal), html }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('unsafe_html');
    expect(body.error.message).toBe(
      'The document contains prohibited elements: button, form, iframe, input, script. Remove prohibited elements and provide static print HTML.'
    );
  });

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

  it('preserves edge-case content, pagination, and repeat rendering through the API', async () => {
    const edgeFixtures = [
      successFixtures.edgeFixedPages,
      successFixtures.edgeLongTable,
      successFixtures.edgeUnicode,
      successFixtures.edgeEmbeddedMedia,
      successFixtures.edgeWrapAndGrid
    ];
    const directory = join(process.cwd(), 'test-artifacts', 'pdf-regression', `edge-cases-${runTimestamp()}`);
    await mkdir(directory, { recursive: true });
    const results: Array<Record<string, unknown>> = [];

    for (const fixture of edgeFixtures) {
      const runs: Array<{ pdfPath: string; pageImages: string[]; pageCount: number; durationMs: number }> = [];
      for (let repetition = 1; repetition <= 2; repetition += 1) {
        const started = performance.now();
        const response = await POST(request(payloadFor(fixture)));
        expect(response.status, `${fixture.id} run ${repetition}`).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/pdf');
        const bytes = new Uint8Array(await response.arrayBuffer());
        const pdf = await validatePdfBuffer(bytes);
        expect(pdf.pageCount).toBeGreaterThanOrEqual(fixture.pageRange[0]);
        expect(pdf.pageCount).toBeLessThanOrEqual(fixture.pageRange[1]);
        for (const dimensions of pdf.pageDimensions) {
          expect(dimensions.widthPoints).toBeCloseTo(612, 0);
          expect(dimensions.heightPoints).toBeCloseTo(792, 0);
        }
        const pdfPath = join(directory, `${fixture.id}-run-${repetition}.pdf`);
        await writeFile(pdfPath, bytes);
        const extracted = await extractPdfText(pdfPath);
        for (const sentinel of fixture.expectedText) {
          expect(extracted, `${fixture.id} missing ${sentinel}`).toContain(sentinel);
        }
        if (fixture.id === 'edgeLongTable') {
          const pages = await extractPdfTextByPage(pdfPath, pdf.pageCount);
          for (const page of pages) {
            expect(page.text, `table header missing on page ${page.pageNumber}`).toContain('Control label');
          }
          for (let row = 1; row <= 40; row += 1) {
            const value = (100 + row + (row % 10) / 10).toFixed(1);
            expect(extracted, `table value missing from row ${row}`).toContain(value);
          }
        }
        if (fixture.id === 'edgeFixedPages') {
          const pages = await extractPdfTextByPage(pdfPath, pdf.pageCount);
          for (const [index, name] of ['one', 'two', 'three'].entries()) {
            expect(pages[index].text).toContain(`Fixed page ${name}`);
            expect(pages[index].text).toContain(`Page ${index + 1} of 3`);
          }
        }
        const pageImages = await renderPdfPages(pdfPath, join(directory, `${fixture.id}-run-${repetition}`));
        expect(pageImages).toHaveLength(pdf.pageCount);
        runs.push({ pdfPath, pageImages, pageCount: pdf.pageCount, durationMs: Math.round(performance.now() - started) });
      }

      expect(runs[1].pageCount).toBe(runs[0].pageCount);
      const rasterHashes = await Promise.all(runs.map(async (run) => Promise.all(run.pageImages.map(async (path) =>
        createHash('sha256').update(await readFile(path)).digest('hex')
      ))));
      expect(rasterHashes[1], `${fixture.id} repeat raster`).toEqual(rasterHashes[0]);
      results.push({ id: fixture.id, runs, rasterHashes: rasterHashes[0], status: 'pass' });
    }

    await writeJson(join(directory, 'summary.json'), {
      kind: 'ready-html-edge-cases',
      testedAt: new Date().toISOString(),
      environment: 'in-process Next.js API route with installed Chrome and Poppler',
      results
    });
  }, 300_000);
});
