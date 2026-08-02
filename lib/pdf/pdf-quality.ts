import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { PdfServiceError } from './errors';
import { LIMITS, PAGE_POINTS } from './limits';
import type { PageDimension, PdfCreationRequest, PdfMetadata, RenderResult } from './types';

export async function finalizeAndValidatePdf(
  input: Uint8Array,
  request: PdfCreationRequest,
  caller: string,
  markerCount: number,
  renderedHtml: string
): Promise<RenderResult> {
  if (input.byteLength < 5 || new TextDecoder().decode(input.subarray(0, 5)) !== '%PDF-') {
    throw new PdfServiceError('pdf_invalid', 500, 'The renderer did not create a valid PDF.');
  }

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(input, { updateMetadata: false });
  } catch {
    throw new PdfServiceError('pdf_invalid', 500, 'The generated PDF could not be parsed.');
  }
  applyMetadata(document, request.metadata, caller, request.filename);
  const saved = await document.save({ useObjectStreams: true });
  if (saved.byteLength > LIMITS.pdfBytes) {
    throw new PdfServiceError('pdf_too_large', 413, `The PDF exceeds the ${LIMITS.pdfBytes}-byte limit.`);
  }

  const pageCount = document.getPageCount();
  if (pageCount < 1 || pageCount > LIMITS.pages) {
    throw new PdfServiceError('pdf_invalid', 500, 'The generated PDF has an invalid page count.');
  }
  if (markerCount > 0 && pageCount !== markerCount) {
    throw new PdfServiceError('pdf_invalid', 500, 'The fixed-page PDF count does not match its markers.');
  }
  if (request.expectedPageCount && pageCount !== request.expectedPageCount) {
    throw new PdfServiceError(
      'expected_page_count_mismatch',
      422,
      `Expected ${request.expectedPageCount} pages but generated ${pageCount}.`
    );
  }

  const expected = PAGE_POINTS[request.page.format];
  const expectedWidth = request.page.orientation === 'portrait' ? expected.widthPoints : expected.heightPoints;
  const expectedHeight = request.page.orientation === 'portrait' ? expected.heightPoints : expected.widthPoints;
  const pageDimensions: PageDimension[] = [];
  for (const page of document.getPages()) {
    const { width, height } = page.getSize();
    if (Math.abs(width - expectedWidth) > 1 || Math.abs(height - expectedHeight) > 1) {
      throw new PdfServiceError('pdf_invalid', 500, 'A PDF page does not match the requested dimensions.');
    }
    const rounded = { widthPoints: round(width), heightPoints: round(height) };
    if (!pageDimensions.some((item) => item.widthPoints === rounded.widthPoints && item.heightPoints === rounded.heightPoints)) {
      pageDimensions.push(rounded);
    }
  }

  return {
    pdf: saved,
    renderedHtml,
    pageCount,
    pageDimensions,
    sha256: sha256(saved),
    markerCount
  };
}

export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  try {
    return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch {
    throw new PdfServiceError('pdf_invalid', 500, 'A fixed page could not be parsed.');
  }
}

export async function mergePdfPages(documents: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of documents) {
    const source = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save({ useObjectStreams: true });
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function applyMetadata(document: PDFDocument, metadata: PdfMetadata | undefined, caller: string, filename: string): void {
  document.setProducer('Urveska PDF Creation Service');
  document.setCreator(`Urveska PDF Creation Service (${caller})`);
  document.setCreationDate(new Date());
  document.setModificationDate(new Date());
  if (metadata?.title) document.setTitle(metadata.title, { showInWindowTitleBar: true });
  else if (!document.getTitle() || document.getTitle() === 'about:blank') document.setTitle(filename.replace(/\.pdf$/i, ''));
  if (metadata?.author) document.setAuthor(metadata.author);
  if (metadata?.subject) document.setSubject(metadata.subject);
  if (metadata?.keywords) document.setKeywords(metadata.keywords);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
