import { execFileSync } from 'node:child_process';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import puppeteer, { type Browser } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPdf, resolveBrowserExecutable } from '@/lib/pdf/renderer';
import { POST } from '@/app/api/v1/pdfs/route';
import { TEST_BEARER_KEY } from '../regression/fixtures';

const page = { format: 'Letter' as const, orientation: 'portrait' as const,
  marginsInches: { top: 0.25, right: 0.3, bottom: 0.4, left: 0.5 } };
const html = (css: string, body = '<a href="https://example.com/area">Area</a>') =>
  `<!doctype html><html><head><style>html,body{margin:0;height:100%;font:16px Arial}body>a{display:block;width:100%;height:100%}${css}</style></head><body>${body}</body></html>`;
const payload = (source: string) => ({ html: source, filename: 'Page_Settings.pdf', storeResult: false, storeHtml: false, page });
const text = (pdf: Uint8Array) => execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf }).toString();
const boxes = (pdf: Uint8Array) => execFileSync('pdftotext', ['-bbox', '-', '-'], { input: pdf }).toString();
const words = (pdf: Uint8Array) => [...boxes(pdf).matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
  .map((match) => ({ x: Number(match[1]), y: Number(match[2]), text: match[5] }));

async function dimensions(pdf: Uint8Array) {
  return (await PDFDocument.load(pdf)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
}

async function contentMargins(pdf: Uint8Array, index = 0) {
  const p = (await PDFDocument.load(pdf)).getPage(index);
  const annotations = p.node.lookup(PDFName.of('Annots'), PDFArray);
  const rect = annotations.lookup(0, PDFDict).lookup(PDFName.of('Rect'), PDFArray).asArray().map((v) => Number(v.toString()));
  return [p.getHeight() - rect[3], p.getWidth() - rect[2], rect[1], rect[0]];
}

describe.sequential('HTML page settings in real Chromium', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await puppeteer.launch({ executablePath: (await resolveBrowserExecutable()).path, headless: true, args: ['--no-sandbox'] }); });
  afterAll(async () => { await browser?.close(); });

  async function native(source: string, margins = page.marginsInches) {
    const tab = await browser.newPage();
    try {
      await tab.emulateMediaType('print');
      await tab.setContent(source);
      return await tab.pdf({ format: 'Letter', preferCSSPageSize: true, printBackground: true,
        margin: { top: `${margins.top}in`, right: `${margins.right}in`, bottom: `${margins.bottom}in`, left: `${margins.left}in` } });
    } finally { await tab.close(); }
  }

  it('B1 preserves every text position and page size without HTML page rules', async () => {
    const source = html('', '<p>First baseline paragraph</p><p style="break-before:page">Second baseline paragraph</p>');
    // The unchanged renderer appended exactly this request rule for documents without @page.
    const baseline = await native(source.replace('</head>', '<style>@page{size:Letter portrait;margin:.25in .3in .4in .5in}</style></head>'));
    const result = await renderPdf(payload(source), 'test');
    expect(await dimensions(result.pdf)).toEqual(await dimensions(baseline));
    expect(boxes(result.pdf).split('<doc>')[1]).toBe(boxes(baseline).split('<doc>')[1]);
  });

  it.each([
    ['B2 size only', '@page{size:A4}', [595, 842], [18, 21.6, 28.8, 36]],
    ['B3 margins only', '@page{margin:.7in .6in .5in .4in}', [612, 792], [50.4, 43.2, 36, 28.8]],
    ['B4 size and margins', '@page{size:A4;margin:.5in}', [595, 842], [36, 36, 36, 36]],
    ['B7 print media', '@media screen{@page{size:Legal}}@media print{@page{size:A4;margin:.5in}}', [595, 842], [36, 36, 36, 36]],
    ['individual margin fallback', '@page{margin-left:1in}', [612, 792], [18, 21.6, 28.8, 72]],
    ['layered HTML beats fallback', '@layer author{@page{size:A4;margin:.5in}}', [595, 842], [36, 36, 36, 36]]
  ])('%s', async (_name, css, size, margins) => {
    const result = await renderPdf(payload(html(css as string)), 'test');
    expect(await dimensions(result.pdf)).toEqual([size]);
    const actual = await contentMargins(result.pdf);
    (margins as number[]).forEach((value, index) => expect(Math.abs(actual[index] - value)).toBeLessThan(0.8));
  });

  it('B5 honors a named landscape page between portrait pages and reports distinct dimensions', async () => {
    const source = html('@page{size:Letter;margin:.5in}@page wide{size:Letter landscape}section{break-after:page}.wide{page:wide}',
      '<section>First</section><section class="wide">Middle</section><section>Last</section>');
    const result = await renderPdf(payload(source), 'test');
    expect(await dimensions(result.pdf)).toEqual([[612, 792], [792, 612], [612, 792]]);
    expect(result.pageDimensions).toEqual([{ widthPoints: 612, heightPoints: 792 }, { widthPoints: 792, heightPoints: 612 }]);
  });

  it('B6 honors first, left and right margins', async () => {
    const result = await renderPdf(payload(html('@page{margin:.5in}@page:first{margin-left:1in}@page:left{margin-left:.75in}@page:right{margin-right:1in}section{break-after:page}',
      '<section>FIRST</section><section>SECOND</section><section>THIRD</section>')), 'test');
    const positions = words(result.pdf);
    for (const [word, left] of [['FIRST', 72], ['SECOND', 54], ['THIRD', 36]] as const) {
      expect(Math.abs(positions.find((p) => p.text === word)!.x - left)).toBeLessThan(0.8);
    }
  });

  it('B8 matches Chrome cascade for conflicting, named, layered and important declarations', async () => {
    const source = html('@page{size:Letter;margin:1in}@page{size:A4!important;margin:.5in!important}@page{size:Legal;margin:2in}@layer author{@page{margin-left:.75in!important}}');
    const direct = await native(source);
    const result = await renderPdf(payload(source), 'test');
    expect(await dimensions(result.pdf)).toEqual(await dimensions(direct));
    expect(await contentMargins(result.pdf)).toEqual(await contentMargins(direct));
    expect(words(result.pdf)).toEqual(words(direct));
  });

  it('verifies PDF margin options do not override CSS margins in this Chromium', async () => {
    const source = html('@page{size:A4;margin:.5in}');
    const direct = await native(source, { top: 1, right: 1, bottom: 1, left: 1 });
    for (const value of await contentMargins(direct)) expect(Math.abs(value - 36)).toBeLessThan(0.8);
  });

  it('B9 keeps a bottom-center page counter including the unsuppressed first page', async () => {
    const result = await renderPdf(payload(html('@page{margin:.5in;@bottom-center{content:"Page " counter(page) " of " counter(pages)}}',
      '<p>One</p><p style="break-before:page">Two</p>')), 'test');
    expect(text(result.pdf)).toContain('Page 1 of 2');
    expect(text(result.pdf)).toContain('Page 2 of 2');
  });

  it.each(['rotate-left', 'rotate-right'])('keeps fixed-page link rectangles aligned after page-orientation:%s', async (orientation) => {
    const source = html(`@page{size:A4;margin:.5in;page-orientation:${orientation}}[data-pdf-page]{height:4in}p{margin:0}`,
      '<section data-pdf-page><a href="#target">LINK</a></section><section data-pdf-page><p id="target">TARGET</p></section>');
    const result = await renderPdf(payload(source), 'test');
    const document = await PDFDocument.load(result.pdf);
    const p = document.getPage(0);
    const annotations = p.node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((ref) => document.context.lookup(ref, PDFDict));
    const link = annotations.find((a) => a.has(PDFName.of('Dest')))!;
    const rect = link.lookup(PDFName.of('Rect'), PDFArray).asArray().map((v) => Number(v.toString()));
    const word = words(result.pdf).find((w) => w.text === 'LINK')!;
    expect(word.x).toBeGreaterThanOrEqual(rect[0] - 1);
    expect(word.x).toBeLessThanOrEqual(rect[2] + 1);
    expect(word.y).toBeGreaterThanOrEqual(p.getHeight() - rect[3] - 1);
    expect(word.y).toBeLessThanOrEqual(p.getHeight() - rect[1] + 1);
    expect(await dimensions(result.pdf)).toEqual([[842, 595], [842, 595]]);
  });

  it('B10 positions every fixed A4 link over its text and on its correct destination', async () => {
    const source = html('@page{size:A4;margin:.5in}[data-pdf-page]{height:5in}p{margin:0}.nav{text-align:right}.target{padding-top:48px}',
      '<section data-pdf-page><div class="nav"><a href="#two">FORWARD</a></div><p class="target" id="one">TARGETONE</p></section><section data-pdf-page><div class="nav"><a href="#one">BACKWARD</a></div><p class="target" id="two">TARGETTWO</p></section>');
    const result = await renderPdf(payload(source), 'test');
    const document = await PDFDocument.load(result.pdf);
    expect(await dimensions(result.pdf)).toEqual([[595, 842], [595, 842]]);
    const textPages = boxes(result.pdf).split('<page ').slice(1);
    for (let index = 0; index < 2; index++) {
      const p = document.getPage(index);
      const annotations = p.node.lookup(PDFName.of('Annots'), PDFArray);
      const links = annotations.asArray().map((ref) => document.context.lookup(ref, PDFDict))
        .filter((annotation) => annotation.has(PDFName.of('Dest')));
      expect(links).toHaveLength(1);
      const dest = links[0].lookup(PDFName.of('Dest'), PDFArray);
      expect(dest.get(0)).toBeInstanceOf(PDFRef);
      expect(dest.get(0).toString()).toBe(document.getPage(1 - index).ref.toString());
      const rect = links[0].lookup(PDFName.of('Rect'), PDFArray).asArray().map((v) => Number(v.toString()));
      const anchor = textPages[index].match(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>(?:FORWARD|BACKWARD)<\/word>/)!;
      expect(Math.abs(Number(anchor[1]) - rect[0])).toBeLessThan(1);
      expect(Number(anchor[2])).toBeGreaterThanOrEqual(p.getHeight() - rect[3] - 1);
      expect(Number(anchor[2])).toBeLessThan(p.getHeight() - rect[1]);
      // Destination is the target element's top (before its 48px padding), 18px below the anchor.
      expect(Math.abs(dest.lookup(3, PDFNumber).asNumber() - (document.getPage(1 - index).getHeight() - 36 - 13.5))).toBeLessThan(1);
    }
  });

  async function response(source: string, expectedPageCount?: number) {
    const previous = process.env.PDF_CREATION_TEST;
    process.env.PDF_CREATION_TEST = TEST_BEARER_KEY;
    try {
      return await POST(new Request('http://localhost/api/v1/pdfs', {
        method: 'POST', headers: { authorization: `Bearer ${TEST_BEARER_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload(source), expectedPageCount })
      }));
    } finally {
      if (previous === undefined) delete process.env.PDF_CREATION_TEST;
      else process.env.PDF_CREATION_TEST = previous;
    }
  }

  it.each([
    ['sizes', '@page{size:Letter}@page wide{size:A4}.second{page:wide}'],
    ['margins', '@page{margin:.5in}@page:first{margin-left:1in}']
  ])('B11 rejects fixed-page mixed %s with 422', async (_name, css) => {
    const result = await response(html(css, '<section data-pdf-page>First</section><section data-pdf-page class="second">Second</section>'));
    expect(result.status).toBe(422);
    expect((await result.json()).error.message).toMatch(/mixed page sizes or margins/);
  });

  it.each(['11in 17in', 'A3'])('B12 accepts %s', async (size) => {
    expect((await response(html(`@page{size:${size};margin:0}`))).status).toBe(200);
  });
  it.each(['11in 18in', '.5in 5in'])('B12 rejects %s with 422 and explicit limits', async (size) => {
    const result = await response(html(`@page{size:${size};margin:0}`));
    expect(result.status).toBe(422);
    expect((await result.json()).error.message).toMatch(/1 and 17 inches.*72.*1224 pt/);
  });

  it('B13 rejects size URLs before Chromium or geometry processing', async () => {
    const result = await response(html('@page{size:url(https://example.com/leak)}'));
    expect(result.status).toBe(400);
    expect((await result.json()).error.code).toBe('unsafe_html');
  });
  it('B14 continues enforcing exact page counts with HTML settings', async () => {
    const result = await response(html('@page{size:A4;margin:.5in}'), 2);
    expect(result.status).toBe(422);
    expect((await result.json()).error.code).toBe('expected_page_count_mismatch');
  });
});
