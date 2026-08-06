import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { payloadFor, successFixtures, TEST_BEARER_KEY } from '../regression/fixtures';
// @ts-expect-error The runtime helper is deliberately plain ESM for use by both Node and Playwright.
import { extractPdfText, renderPdfPages, runTimestamp, validatePdfBuffer, writeJson } from '../../scripts/pdf-test-utils.mjs';

test('generates and validates every successful fixture and renders representative pages', async ({ request }) => {
  test.setTimeout(360_000);
  const outputDirectory = join(process.cwd(), 'test-artifacts', 'pdf-regression', `local-${runTimestamp()}`);
  await mkdir(outputDirectory, { recursive: true });
  const results: Array<Record<string, unknown>> = [];
  const extracted = new Map<string, string>();

  for (const fixture of Object.values(successFixtures)) {
    const id = fixture.id;
    const started = performance.now();
    const response = await request.post('/api/v1/pdfs', {
      headers: { authorization: `Bearer ${TEST_BEARER_KEY}`, 'content-type': 'application/json' },
      data: payloadFor(fixture),
      timeout: 120_000
    });
    expect(response.status(), `${id} HTTP status`).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    const bytes = await response.body();
    const pdf = await validatePdfBuffer(bytes);
    expect(pdf.pageCount).toBeGreaterThanOrEqual(fixture.pageRange[0]);
    expect(pdf.pageCount).toBeLessThanOrEqual(fixture.pageRange[1]);
    const pdfPath = join(outputDirectory, `${id}.pdf`);
    await writeFile(pdfPath, bytes);
    const text = await extractPdfText(pdfPath);
    extracted.set(id, text);
    for (const sentinel of fixture.expectedText) expect(text, `${id} expected text`).toContain(sentinel);
    const pageImages = fixture.visual ? await renderPdfPages(pdfPath, join(outputDirectory, id)) : [];
    if (fixture.visual) expect(pageImages).toHaveLength(pdf.pageCount);
    results.push({
      id,
      status: 'pass',
      httpStatus: response.status(),
      durationMs: Math.round(performance.now() - started),
      bytes: pdf.bytes,
      pageCount: pdf.pageCount,
      sha256: pdf.sha256,
      pdfValid: true,
      textValid: true,
      renderedPageCount: fixture.visual ? pageImages.length : null,
      visualInspection: fixture.visual ? 'generated-for-manual-review' : 'not-selected-for-manual-review',
      pdfPath,
      pageImages
    });
  }

  expect(extracted.get('appBlue')).toContain('Application Blue');
  expect(extracted.get('appBlue')).not.toContain('Application Gold');
  expect(extracted.get('appGold')).toContain('Application Gold');
  expect(extracted.get('appGold')).not.toContain('Application Blue');

  await writeJson(join(outputDirectory, 'summary.json'), {
    kind: 'local-visual-regression',
    testedAt: new Date().toISOString(),
    environment: 'local Next.js development server with installed Chrome/Edge and Poppler',
    results
  });
});
