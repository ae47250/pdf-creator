import { PDFDocument } from 'pdf-lib';
import { expect, it } from 'vitest';
import { finalizeAndValidatePdf } from '@/lib/pdf/pdf-quality';
import { validateAndNormalizeHtml } from '@/lib/pdf/html-safety';

const request = {
  html: '<!doctype html><html><head></head><body>Dimensions</body></html>',
  filename: 'Dimensions.pdf', storeResult: false, storeHtml: false,
  page: { format: 'Letter' as const, orientation: 'portrait' as const, marginsInches: { top: 0, right: 0, bottom: 0, left: 0 } }
};

it('distinguishes author size declarations from injected fallback and margin-box content', () => {
  expect(validateAndNormalizeHtml(request.html, request.page).hasPageSize).toBe(false);
  for (const css of ['@page{margin:1in}', '@page{@bottom-center{font-size:10pt}}']) {
    expect(validateAndNormalizeHtml(request.html.replace('</head>', `<style>${css}</style></head>`), request.page).hasPageSize).toBe(false);
  }
  expect(validateAndNormalizeHtml(request.html.replace('</head>', '<style>@media print{@page wide{size:A4}}</style></head>'), request.page).hasPageSize).toBe(true);
});

it.each([[71.9, 792], [612, 71.9], [1224.1, 792], [612, 1224.1]])('checks every page side limit: %s x %s', async (width, height) => {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  document.addPage([width, height]);
  await expect(finalizeAndValidatePdf(await document.save(), request, 'test', 0, request.html, true))
    .rejects.toMatchObject({ status: 422, message: expect.stringContaining('1 and 17 inches') });
});

it('accepts inclusive bounds and reports all distinct page dimensions', async () => {
  const document = await PDFDocument.create();
  document.addPage([72, 1224]);
  document.addPage([1224, 72]);
  document.addPage([72, 1224]);
  const result = await finalizeAndValidatePdf(await document.save(), request, 'test', 0, request.html, true);
  expect(result.pageDimensions).toEqual([{ widthPoints: 72, heightPoints: 1224 }, { widthPoints: 1224, heightPoints: 72 }]);
});

it('retains strict request-size checks on every page when HTML declares no size', async () => {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  document.addPage([595, 842]);
  await expect(finalizeAndValidatePdf(await document.save(), request, 'test', 0, request.html, false))
    .rejects.toMatchObject({ code: 'pdf_invalid', message: expect.stringContaining('requested dimensions') });
});
