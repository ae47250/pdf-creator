import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFString
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderPdf } from '@/lib/pdf/renderer';
import { nativeFixedReportHtml } from '../helpers/native-fixed-report';
// @ts-expect-error The runtime helper is deliberately plain ESM for Node and Playwright.
import { extractTextFromBytes, inspectPdfWithPoppler } from '../../scripts/pdf-test-utils.mjs';

describe.sequential('native fixed-page preservation through copyPages', () => {
  it('preserves native text, metadata, dimensions, and inspectable link structures', async () => {
    const sentinel = 'NATIVE-PRESERVATION-SENTINEL';
    const request = {
      html: await nativeFixedReportHtml(sentinel, 4),
      filename: 'Native_Fixed_Preservation.pdf',
      storeResult: false,
      storeHtml: false,
      page: {
        format: 'Letter' as const,
        orientation: 'portrait' as const,
        marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      expectedPageCount: 4,
      metadata: {
        title: 'Native fixed preservation qualification',
        author: 'Synthetic PDF qualification fixture',
        subject: 'copyPages preservation evidence'
      }
    };
    const result = await renderPdf(request, 'test');
    const loaded = await PDFDocument.load(result.pdf, { updateMetadata: false });
    const text = await extractTextFromBytes(result.pdf);
    const links = inspectLinks(loaded);
    const artifactDirectory = join(process.cwd(), 'test-artifacts', 'pdf-regression', 'hardening');
    const pdfPath = join(artifactDirectory, 'native-fixed-preservation.pdf');
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(pdfPath, result.pdf);
    const poppler = await inspectPdfWithPoppler(pdfPath);

    expect(result.pageCount).toBe(4);
    expect(result.pageDimensions).toEqual([{ widthPoints: 612, heightPoints: 792 }]);
    expect(loaded.getPageCount()).toBe(4);
    expect(loaded.getTitle()).toBe(request.metadata.title);
    expect(loaded.getAuthor()).toBe(request.metadata.author);
    expect(loaded.getSubject()).toBe(request.metadata.subject);
    expect(poppler.encrypted).toBe(false);
    expect(poppler.pageDimensions).toEqual(Array.from({ length: 4 }, () => ({ widthPoints: 612, heightPoints: 792 })));
    expect(text.match(new RegExp(sentinel, 'g'))?.length).toBeGreaterThanOrEqual(4);
    for (let pageNumber = 1; pageNumber <= 4; pageNumber += 1) {
      expect(text).toContain(`Native Fixed Report - Page ${pageNumber}`);
    }
    expect(text.indexOf('Native Fixed Report - Page 1')).toBeLessThan(text.indexOf('Native Fixed Report - Page 2'));
    expect(text.indexOf('Native Fixed Report - Page 2')).toBeLessThan(text.indexOf('Native Fixed Report - Page 3'));
    expect(text.indexOf('Native Fixed Report - Page 3')).toBeLessThan(text.indexOf('Native Fixed Report - Page 4'));
    expect(links.externalUris).toEqual(Array.from({ length: 4 }, () => 'https://example.com/pdf-creator/native-fixed'));
    expect(links.internalDestinations).toHaveLength(2);

    console.log(`NATIVE_FIXED_EVIDENCE ${JSON.stringify({
      pageCount: result.pageCount,
      pageDimensions: result.pageDimensions,
      textOrderPreserved: true,
      externalLinkCount: links.externalUris.length,
      internalLinkCount: links.internalDestinations.length,
      tagged: poppler.tagged,
      structTreeRootPresent: loaded.catalog.has(PDFName.of('StructTreeRoot')),
      markInfoPresent: loaded.catalog.has(PDFName.of('MarkInfo')),
      title: loaded.getTitle(),
      author: loaded.getAuthor(),
      subject: loaded.getSubject(),
      pdfPath
    })}`);
  }, 60_000);

  it('confirms the richer flowing load-save control retains link and tag structures', async () => {
    const fixedHtml = await nativeFixedReportHtml('NATIVE-FLOW-CONTROL', 4);
    const html = fixedHtml
      .replace('[data-pdf-page]', '.flow-page')
      .replaceAll(' data-pdf-page', ' class="flow-page"')
      .replace('overflow: hidden; background: #fff;', 'break-after: page; background: #fff;');
    const result = await renderPdf({
      html,
      filename: 'Native_Flow_Control.pdf',
      storeResult: false,
      storeHtml: false,
      page: {
        format: 'Letter',
        orientation: 'portrait',
        marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      expectedPageCount: 4
    }, 'test');
    const loaded = await PDFDocument.load(result.pdf, { updateMetadata: false });
    const links = inspectLinks(loaded);
    const directory = await mkdtemp(join(tmpdir(), 'pdf-native-flow-'));
    const pdfPath = join(directory, 'native-flow.pdf');

    try {
      await writeFile(pdfPath, result.pdf);
      const poppler = await inspectPdfWithPoppler(pdfPath);
      expect(links.externalUris).toHaveLength(4);
      expect(links.internalDestinations).toHaveLength(2);
      expect(poppler.tagged).toBe(true);
      expect(loaded.catalog.has(PDFName.of('StructTreeRoot'))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

function inspectLinks(document: PDFDocument): { externalUris: string[]; internalDestinations: string[] } {
  const externalUris: string[] = [];
  const internalDestinations: string[] = [];

  for (const page of document.getPages()) {
    const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annotations) continue;
    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = annotations.lookup(index, PDFDict);
      if (annotation.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
      const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict);
      const uri = action ? decodePdfText(action.get(PDFName.of('URI'))) : null;
      if (uri) externalUris.push(uri);
      const destination = annotation.get(PDFName.of('Dest')) ?? action?.get(PDFName.of('D'));
      if (destination) internalDestinations.push(destination.toString());
    }
  }
  return { externalUris, internalDestinations };
}

function decodePdfText(value: PDFObject | undefined): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return null;
}
