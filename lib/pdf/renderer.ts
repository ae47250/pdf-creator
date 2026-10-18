import chromium from '@sparticuz/chromium';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { PdfServiceError } from './errors';
import { validateAndNormalizeHtml } from './html-safety';
import { LIMITS } from './limits';
import {
  countPdfPages,
  finalizeAndValidatePdf,
  mergePdfPages,
  type InternalPdfLink
} from './pdf-quality';
import type {
  FlowLayoutDiagnostics,
  FlowLayoutObservation,
  PdfCreationRequest,
  RendererIdentity,
  RenderResult
} from './types';

const windowsBrowserPaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const macOSBrowserRelativePaths = [
  'Google Chrome.app/Contents/MacOS/Google Chrome',
  'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'Chromium.app/Contents/MacOS/Chromium'
];

export async function renderPdf(request: PdfCreationRequest, caller: string): Promise<RenderResult> {
  const renderStarted = Date.now();
  const safe = validateAndNormalizeHtml(request.html, request.page);
  let browser: Browser | undefined;
  let page: Page | undefined;
  let originalError: unknown;

  try {
    const launched = await launchBrowserWithinTimeout();
    browser = launched.browser;
    const renderer = rendererIdentityFromVersion(await browser.version(), launched.local);
    page = await browser.newPage();
    await configurePage(page);
    const remainingRenderMs = Math.max(1, LIMITS.renderMs - (Date.now() - renderStarted));
    const renderOperation: Promise<RenderedOutput> = safe.markerCount === 0
        ? renderWholeDocument(page, safe.html, request)
        : renderFixedPages(page, safe.html, safe.markerCount, request);
    const rendered = await withTimeout(
      renderOperation,
      remainingRenderMs,
      'render_timeout',
      'PDF rendering exceeded the time limit.'
    );
    const validated = await finalizeAndValidatePdf(rendered.pdf, request, caller, safe.markerCount, safe.html, safe.hasPageSize);
    return { ...validated, renderer, layoutDiagnostics: rendered.layoutDiagnostics };
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    await closeSafely(page, browser, originalError);
  }
}

interface LaunchedBrowser {
  browser: Browser;
  local: boolean;
}

interface RenderedOutput {
  pdf: Uint8Array;
  layoutDiagnostics: FlowLayoutDiagnostics | null;
}

async function launchBrowserWithinTimeout(): Promise<LaunchedBrowser> {
  const launch = launchBrowser();
  try {
    return await withTimeout(launch, LIMITS.browserStartMs, 'render_timeout', 'The browser did not start in time.');
  } catch (error) {
    void launch.then((late) => closeSafely(undefined, late.browser, error)).catch(() => undefined);
    throw error;
  }
}

async function launchBrowser(): Promise<LaunchedBrowser> {
  const executable = await resolveBrowserExecutable();
  const browser = await puppeteer.launch({
    args: executable.local
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      : [...chromium.args, '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    executablePath: executable.path,
    headless: true
  });
  return { browser, local: executable.local };
}

export function rendererIdentityFromVersion(browserVersion: string, local: boolean): RendererIdentity {
  const normalized = browserVersion.trim();
  const separator = normalized.indexOf('/');
  return {
    source: local ? 'installed' : 'bundled',
    product: separator > 0 ? normalized.slice(0, separator) : normalized || 'Unknown',
    version: separator > 0 ? normalized.slice(separator + 1) : 'unknown'
  };
}

export async function resolveBrowserExecutable({
  explicitPath = process.env.CHROME_PATH,
  platform = process.platform,
  architecture = process.arch,
  homeDirectory = homedir(),
  pathExists = existsSync,
  bundledExecutablePath = () => chromium.executablePath()
}: {
  explicitPath?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  homeDirectory?: string;
  pathExists?: (path: string) => boolean;
  bundledExecutablePath?: () => Promise<string>;
} = {}): Promise<{ path: string; local: boolean }> {
  if (explicitPath && !pathExists(explicitPath)) {
    throw new PdfServiceError('service_unavailable', 503, 'CHROME_PATH does not point to a readable browser.');
  }
  const local = explicitPath || browserPaths(platform, homeDirectory).find((candidate) => pathExists(candidate));
  if (!local && architecture !== 'x64') {
    throw new PdfServiceError('service_unavailable', 503, 'Bundled Chromium requires an x64 runtime.');
  }
  return local
    ? { path: local, local: true }
    : { path: await bundledExecutablePath(), local: false };
}

function browserPaths(platform: NodeJS.Platform, homeDirectory: string): string[] {
  if (platform === 'win32') return windowsBrowserPaths;
  if (platform !== 'darwin') return [];
  return macOSBrowserRelativePaths.flatMap((relativePath) => [
    posix.join('/Applications', relativePath),
    posix.join(homeDirectory, 'Applications', relativePath)
  ]);
}

async function configurePage(page: Page): Promise<void> {
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url === 'about:blank' || url.startsWith('data:')) void request.continue();
    else void request.abort('blockedbyclient');
  });
  await page.emulateMediaType('print');
}

async function loadAndWait(page: Page, html: string): Promise<void> {
  const attempted: string[] = [];
  const listener = (request: { url(): string }) => {
    const url = request.url();
    if (url !== 'about:blank' && !url.startsWith('data:')) attempted.push(redactUrl(url));
  };
  page.on('request', listener);
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: LIMITS.readinessMs });
    if (attempted.length > 0) {
      throw new PdfServiceError('unsafe_html', 400, 'The document attempted an outbound resource request.');
    }
    const readiness = await withTimeout(page.evaluate(async () => {
      await document.fonts.ready;
      const fonts = Array.from(document.fonts).map((font) => ({ family: font.family, status: font.status }));
      const images = await Promise.all(Array.from(document.images).map(async (image) => {
        try { await image.decode(); } catch { return { ok: false, reason: 'decode' }; }
        return { ok: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0, reason: 'dimensions' };
      }));
      const body = document.body.getBoundingClientRect();
      const visible = body.width > 0 && body.height > 0 && Boolean(document.body.innerText.trim() || document.images.length);
      return { fonts, images, visible };
    }), LIMITS.readinessMs, 'asset_not_ready', 'Document assets did not become ready.');
    if (!readiness.visible) throw new PdfServiceError('asset_not_ready', 422, 'The document has no visible renderable content.');
    if (readiness.fonts.some((font) => font.status !== 'loaded')) throw new PdfServiceError('asset_not_ready', 422, 'A document font did not load.');
    if (readiness.images.some((image) => !image.ok)) throw new PdfServiceError('asset_not_ready', 422, 'A document image did not decode.');
  } finally {
    page.off('request', listener);
  }
}

async function renderWholeDocument(
  page: Page,
  html: string,
  request: PdfCreationRequest
): Promise<{ pdf: Uint8Array; layoutDiagnostics: FlowLayoutDiagnostics }> {
  await loadAndWait(page, html);
  const [geometry] = await measurePrintGeometry(page, request, false);
  await loadAndWait(page, html);
  const layoutDiagnostics = await observeFlowLayout(page, geometry.printableWidthPixels);
  return { pdf: await page.pdf(pdfOptions(request)), layoutDiagnostics };
}

async function renderFixedPages(
  page: Page,
  html: string,
  markerCount: number,
  request: PdfCreationRequest
): Promise<{ pdf: Uint8Array; layoutDiagnostics: null }> {
  const pages: Uint8Array[] = [];
  const internalLinks: (InternalPdfLink & { targetId: string })[] = [];
  const targetPoints = new Map<string, { leftPixels: number; topPixels: number }>();
  await loadAndWait(page, html);
  const geometries = await measurePrintGeometry(page, request, true);
  const paper = geometries[0];
  if (geometries.length !== markerCount || geometries.some((geometry) =>
    Object.keys(paper).some((key) => Math.abs(geometry[key as keyof PrintGeometry] - paper[key as keyof PrintGeometry]) > 0.01)
  )) {
    throw new PdfServiceError('pdf_invalid', 422, 'Fixed-page documents must use the same page size and margins on every page; mixed page sizes or margins are not supported.');
  }
  // Match Chromium's resolved printable area before measuring content and links.
  await page.setViewport({ ...page.viewport()!, width: Math.max(1, Math.round(paper.printableWidthPixels)) });
  for (let index = 0; index < markerCount; index += 1) {
    await loadAndWait(page, html);
    const geometry = await page.evaluate((selectedIndex) => {
      const markers = Array.from(document.querySelectorAll<HTMLElement>('[data-pdf-page]'));
      const selected = markers[selectedIndex];
      if (!selected) return { missing: true, overflow: false, internalLinks: [], targets: [], printScale: 1 };
      const anchors = Array.from(selected.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')).flatMap((anchor) => {
        const href = anchor.getAttribute('href');
        if (!href || href.length < 2) return [];
        let targetId: string;
        try { targetId = decodeURIComponent(href.slice(1)); } catch { return []; }
        const target = document.getElementById(targetId);
        const targetMarker = target?.closest<HTMLElement>('[data-pdf-page]');
        if (!target || !targetMarker) return [];
        const targetPageIndex = markers.indexOf(targetMarker);
        if (targetPageIndex < 0) return [];
        return [{ anchor, targetId, targetPageIndex }];
      });
      for (const candidate of Array.from(document.body.querySelectorAll<HTMLElement>('*')).reverse()) {
        if (candidate === selected || candidate.contains(selected) || selected.contains(candidate)) continue;
        candidate.remove();
      }
      selected.style.breakBefore = 'auto';
      selected.style.breakAfter = 'auto';
      selected.style.pageBreakBefore = 'auto';
      selected.style.pageBreakAfter = 'auto';
      const internalLinks = anchors.flatMap(({ anchor, targetId, targetPageIndex }) => Array.from(anchor.getClientRects()).map(rect => ({
        sourcePageIndex: selectedIndex, targetPageIndex, targetId,
        leftPixels: rect.left, topPixels: rect.top,
        widthPixels: rect.width, heightPixels: rect.height, targetTopPixels: 0
      })));
      const targets = [selected, ...selected.querySelectorAll<HTMLElement>('[id]')]
        .filter(element => element.id).map(element => ({ id: element.id, top: element.getBoundingClientRect().top, left: element.getBoundingClientRect().left }));
      const box = selected.getBoundingClientRect();
      let left = box.left;
      let top = box.top;
      let right = box.right;
      let bottom = box.bottom;
      for (const descendant of selected.querySelectorAll<HTMLElement>('*')) {
        const rect = descendant.getBoundingClientRect();
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
      const overflow = left < box.left - 1 || top < box.top - 1 || right > box.right + 1 || bottom > box.bottom + 1 || selected.scrollWidth > selected.clientWidth + 1 || selected.scrollHeight > selected.clientHeight + 1;
      // Chromium shrinks the printable viewport when fixed-width content extends it.
      // Margins remain physical inches and are added after this content scale.
      const printScale = document.documentElement.clientWidth / Math.max(document.documentElement.clientWidth, document.documentElement.scrollWidth);
      return { missing: false, overflow, internalLinks, targets, printScale };
    }, index);
    if (geometry.missing) throw new PdfServiceError('pdf_invalid', 500, 'A fixed-page marker disappeared during rendering.');
    if (geometry.overflow) throw new PdfServiceError('fixed_page_overflow', 422, `Fixed page ${index + 1} contains overflowing content.`);
    const bytes = await page.pdf(pdfOptions(request));
    if (await countPdfPages(bytes) !== 1) {
      throw new PdfServiceError('fixed_page_overflow', 422, `Fixed page ${index + 1} did not render as exactly one PDF page.`);
    }
    for (const target of geometry.targets) {
      targetPoints.set(`${index}:${target.id}`, printPoint(paper, target.left * geometry.printScale, target.top * geometry.printScale));
    }
    internalLinks.push(...geometry.internalLinks.map((link) => {
      const start = printPoint(paper, link.leftPixels * geometry.printScale, link.topPixels * geometry.printScale);
      const end = printPoint(paper, (link.leftPixels + link.widthPixels) * geometry.printScale, (link.topPixels + link.heightPixels) * geometry.printScale);
      return { ...link, leftPixels: Math.min(start.leftPixels, end.leftPixels), topPixels: Math.min(start.topPixels, end.topPixels),
        widthPixels: Math.abs(end.leftPixels - start.leftPixels), heightPixels: Math.abs(end.topPixels - start.topPixels) };
    }));
    pages.push(bytes);
  }
  for (const link of internalLinks) {
    const target = targetPoints.get(`${link.targetPageIndex}:${link.targetId}`);
    link.targetTopPixels = target?.topPixels ?? 0;
    if (paper.rotation) link.targetLeftPixels = target?.leftPixels;
  }
  return { pdf: await mergePdfPages(pages, internalLinks), layoutDiagnostics: null };
}

interface PrintGeometry {
  widthPoints: number;
  heightPoints: number;
  leftPixels: number;
  topPixels: number;
  printableWidthPixels: number;
  printableHeightPixels: number;
  rotation: number;
}

function printPoint(paper: PrintGeometry, x: number, y: number) {
  if (paper.rotation === -1) return { leftPixels: paper.leftPixels + y, topPixels: paper.topPixels + paper.printableWidthPixels - x };
  if (paper.rotation === 1) return { leftPixels: paper.leftPixels + paper.printableHeightPixels - y, topPixels: paper.topPixels + x };
  return { leftPixels: paper.leftPixels + x, topPixels: paper.topPixels + y };
}

// Print a disposable measuring document with the original styles. A full-area link
// and an origin marker expose geometry after Chromium resolves page rules, including
// named pages, pseudo-pages, layers, conditional rules, units, and !important.
// The caller reloads the unchanged safe HTML before rendering the actual content.
async function measurePrintGeometry(page: Page, request: PdfCreationRequest, fixed: boolean): Promise<PrintGeometry[]> {
  await page.evaluate((isFixed) => {
    const markers = Array.from(document.querySelectorAll<HTMLElement>('[data-pdf-page]'));
    const firstContent = Array.from(document.body.querySelectorAll<HTMLElement>('*')).find((element) =>
      getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().height > 0
    );
    const names = (isFixed ? markers : [firstContent ?? document.body]).map((element) => getComputedStyle(element).page);
    // Preserve style elements even when callers put them in the body.
    for (const style of document.body.querySelectorAll('style')) document.head.append(style);
    document.body.replaceChildren();
    for (const element of [document.documentElement, document.body]) {
      for (const [property, value] of Object.entries({
        display: 'block', position: 'static', width: 'auto', height: '100%',
        margin: '0', padding: '0', border: '0', transform: 'none',
        'min-width': '0', 'max-width': 'none', 'min-height': '0', 'max-height': 'none',
        overflow: 'visible', 'box-sizing': 'content-box'
      })) element.style.setProperty(property, value, 'important');
    }
    names.forEach((name, index) => {
      const area = document.createElement('div');
      area.style.cssText = 'all:initial!important;display:block!important;position:relative!important;width:100%!important;height:100%!important;break-after:page!important;';
      area.style.setProperty('page', name, 'important');
      const bounds = document.createElement('a');
      bounds.href = `https://pdf.invalid/geometry/${index}`;
      bounds.style.cssText = 'all:initial!important;display:block!important;width:100%!important;height:100%!important;';
      const origin = document.createElement('a');
      origin.href = `https://pdf.invalid/origin/${index}`;
      origin.style.cssText = 'all:initial!important;position:absolute!important;left:0!important;top:0!important;width:1px!important;height:1px!important;';
      area.append(bounds, origin);
      document.body.append(area);
    });
  }, fixed);
  const probe = await PDFDocument.load(await page.pdf(pdfOptions(request)), { updateMetadata: false });
  return probe.getPages().map((printedPage) => {
    const annotations = printedPage.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    const rectangles = new Map<string, number[]>();
    for (let index = 0; index < (annotations?.size() ?? 0); index += 1) {
      const annotation = annotations!.lookup(index, PDFDict);
      const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict);
      const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString)?.decodeText();
      if (!uri) continue;
      rectangles.set(uri, annotation.lookup(PDFName.of('Rect'), PDFArray).asArray().map((value) => Number(value.toString())));
    }
    for (const [uri, rect] of rectangles) {
      if (!uri.startsWith('https://pdf.invalid/geometry/')) continue;
      const origin = rectangles.get(uri.replace('/geometry/', '/origin/'));
      if (!origin) continue;
      // Locate the unrotated top-left corner to distinguish upright and rotated
      // page boxes. This also keeps links correct for CSS page-orientation.
      const rotation = origin[3] < (rect[1] + rect[3]) / 2 ? -1 : origin[0] > (rect[0] + rect[2]) / 2 ? 1 : 0;
      const width = (rect[2] - rect[0]) / 0.75;
      const height = (rect[3] - rect[1]) / 0.75;
      return {
        widthPoints: printedPage.getWidth(), heightPoints: printedPage.getHeight(),
        leftPixels: rect[0] / 0.75, topPixels: (printedPage.getHeight() - rect[3]) / 0.75,
        printableWidthPixels: rotation ? height : width,
        printableHeightPixels: rotation ? width : height,
        rotation
      };
    }
    throw new PdfServiceError('pdf_invalid', 422, 'The HTML page size and margins must leave a printable area.');
  });
}

async function observeFlowLayout(page: Page, widthPixels: number): Promise<FlowLayoutDiagnostics> {
  const printableWidthPixels = Math.max(1, Math.round(widthPixels));
  const originalViewport = page.viewport()!;

  await page.setViewport({ ...originalViewport, width: printableWidthPixels });
  try {
    const observations = await page.evaluate((availableWidth) => {
      const findings: FlowLayoutObservation[] = [];
      const add = (kind: FlowLayoutObservation['kind'], element: Element, excess: number) => {
        if (excess <= 1 || findings.length >= 20) return;
        const tagName = element === document.documentElement
          ? 'html'
          : element === document.body
            ? 'body'
            : element.tagName.toLowerCase();
        if (findings.some((finding) => finding.kind === kind && finding.tagName === tagName)) return;
        findings.push({ kind, tagName, excessPixels: Math.round(excess * 100) / 100 });
      };
      const rootOverflow = Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body.scrollWidth - document.body.clientWidth
      );
      add('document_overflow', document.documentElement, rootOverflow);

      for (const element of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        if (findings.length >= 20) break;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const horizontalExcess = Math.max(0, rect.right - availableWidth, -rect.left, rect.width - availableWidth);
        const ownOverflow = Math.max(0, element.scrollWidth - element.clientWidth);
        const tag = element.tagName.toLowerCase();

        if (tag === 'table') add('table_overflow', element, Math.max(horizontalExcess, ownOverflow));
        if (tag === 'img' || tag === 'svg') add('image_overflow', element, Math.max(horizontalExcess, ownOverflow));
        if ((style.whiteSpace === 'nowrap' || ownOverflow > 1) && element.textContent?.trim()) {
          add('unbreakable_content', element, Math.max(horizontalExcess, ownOverflow));
        }
        if ((style.position === 'absolute' || style.position === 'fixed' || style.transform !== 'none') && horizontalExcess > 1) {
          add('positioned_content', element, horizontalExcess);
        }
      }
      return findings;
    }, printableWidthPixels);
    return {
      mode: 'observe-only',
      printableWidthPixels,
      observationCount: observations.length,
      observations
    };
  } finally {
    await page.setViewport(originalViewport);
  }
}

function pdfOptions(request: PdfCreationRequest) {
  const margin = request.page.marginsInches;
  return {
    format: request.page.format,
    landscape: request.page.orientation === 'landscape',
    printBackground: true,
    preferCSSPageSize: true,
    margin: {
      top: `${margin.top}in`, right: `${margin.right}in`, bottom: `${margin.bottom}in`, left: `${margin.left}in`
    }
  } as const;
}

async function closeSafely(page: Page | undefined, browser: Browser | undefined, originalError: unknown): Promise<void> {
  try {
    if (page && !page.isClosed()) await withCloseTimeout(page.close());
  } catch { /* cleanup must not mask the result */ }
  try {
    if (browser?.connected) await withCloseTimeout(browser.close());
  } catch {
    try { browser?.process()?.kill('SIGKILL'); } catch { /* already gone */ }
    if (!originalError) console.error(JSON.stringify({ event: 'browser_close_failed' }));
  }
}

async function withCloseTimeout(operation: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('close timeout')), LIMITS.closeMs);
    })
  ]).finally(() => clearTimeout(timer!));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: 'render_timeout' | 'asset_not_ready', message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PdfServiceError(code, 504, message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer!));
}

function redactUrl(value: string): string {
  try { return new URL(value).protocol; } catch { return 'invalid:'; }
}
