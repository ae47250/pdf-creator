import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { finalizeAndValidatePdf } from '@/lib/pdf/pdf-quality';
import { PdfServiceError } from '@/lib/pdf/errors';

const request = {
  html: '<!doctype html><html><head></head><body>test</body></html>',
  filename: 'Test.pdf',
  storeResult: false,
  storeHtml: false,
  page: { format: 'Letter' as const, orientation: 'portrait' as const, marginsInches: { top: 0, right: 0, bottom: 0, left: 0 } },
  expectedPageCount: 1,
  metadata: { title: 'Test title', author: 'Test author', keywords: ['test'] }
};

async function onePage(width = 612, height = 792) {
  const pdf = await PDFDocument.create();
  pdf.addPage([width, height]);
  return pdf.save();
}

describe('PDF quality', () => {
  it('applies metadata and reports page properties', async () => {
    const result = await finalizeAndValidatePdf(await onePage(), request, 'test', 0, request.html);
    expect(result.pageCount).toBe(1);
    expect(result.pageDimensions).toEqual([{ widthPoints: 612, heightPoints: 792 }]);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    const loaded = await PDFDocument.load(result.pdf, { updateMetadata: false });
    expect(loaded.getTitle()).toBe('Test title');
    expect(loaded.getProducer()).toBe('Urveska PDF Creation Service');
  });

  it('rejects unexpected dimensions', async () => {
    await expect(finalizeAndValidatePdf(await onePage(500, 500), request, 'test', 0, request.html))
      .rejects.toBeInstanceOf(PdfServiceError);
  });

  it('replaces Chromium\'s about:blank title with the requested filename', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    pdf.setTitle('about:blank');
    const withoutMetadata = { ...request, filename: 'Fallback_Title.pdf', metadata: undefined };
    const result = await finalizeAndValidatePdf(await pdf.save(), withoutMetadata, 'test', 0, request.html);
    const loaded = await PDFDocument.load(result.pdf, { updateMetadata: false });
    expect(loaded.getTitle()).toBe('Fallback_Title');
  });

  it('rejects an expected page-count mismatch', async () => {
    const mismatch = { ...request, expectedPageCount: 2 };
    await expect(finalizeAndValidatePdf(await onePage(), mismatch, 'test', 0, request.html))
      .rejects.toMatchObject({ code: 'expected_page_count_mismatch' });
  });
});
