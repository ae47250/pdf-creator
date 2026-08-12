import chromium from '@sparticuz/chromium';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
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
  PageSettings,
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
    const validated = await finalizeAndValidatePdf(rendered.pdf, request, caller, safe.markerCount, safe.html);
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
  const layoutDiagnostics = await observeFlowLayout(page, request.page);
  return { pdf: await page.pdf(pdfOptions(request)), layoutDiagnostics };
}

async function renderFixedPages(
  page: Page,
  html: string,
  markerCount: number,
  request: PdfCreationRequest
): Promise<{ pdf: Uint8Array; layoutDiagnostics: null }> {
  const pages: Uint8Array[] = [];
  const internalLinks: InternalPdfLink[] = [];
  for (let index = 0; index < markerCount; index += 1) {
    await loadAndWait(page, html);
    const geometry = await page.evaluate((selectedIndex) => {
      const markers = Array.from(document.querySelectorAll<HTMLElement>('[data-pdf-page]'));
      const selected = markers[selectedIndex];
      if (!selected) return { missing: true, overflow: false, internalLinks: [] };
      const selectedBeforeIsolation = selected.getBoundingClientRect();
      const internalLinks = Array.from(selected.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')).flatMap((anchor) => {
        const href = anchor.getAttribute('href');
        if (!href || href.length < 2) return [];
        let targetId: string;
        try { targetId = decodeURIComponent(href.slice(1)); } catch { return []; }
        const target = document.getElementById(targetId);
        const targetMarker = target?.closest<HTMLElement>('[data-pdf-page]');
        if (!target || !targetMarker) return [];
        const targetPageIndex = markers.indexOf(targetMarker);
        if (targetPageIndex < 0) return [];
        const anchorBox = anchor.getBoundingClientRect();
        const targetMarkerBox = targetMarker.getBoundingClientRect();
        const targetBox = target.getBoundingClientRect();
        return [{
          sourcePageIndex: selectedIndex,
          targetPageIndex,
          leftPixels: anchorBox.left - selectedBeforeIsolation.left,
          topPixels: anchorBox.top - selectedBeforeIsolation.top,
          widthPixels: anchorBox.width,
          heightPixels: anchorBox.height,
          targetTopPixels: targetBox.top - targetMarkerBox.top
        }];
      });
      for (const candidate of Array.from(document.body.querySelectorAll<HTMLElement>('*')).reverse()) {
        if (candidate === selected || candidate.contains(selected) || selected.contains(candidate)) continue;
        candidate.remove();
      }
      selected.style.breakBefore = 'auto';
      selected.style.breakAfter = 'auto';
      selected.style.pageBreakBefore = 'auto';
      selected.style.pageBreakAfter = 'auto';
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
      return { missing: false, overflow, internalLinks };
    }, index);
    if (geometry.missing) throw new PdfServiceError('pdf_invalid', 500, 'A fixed-page marker disappeared during rendering.');
    if (geometry.overflow) throw new PdfServiceError('fixed_page_overflow', 422, `Fixed page ${index + 1} contains overflowing content.`);
    const bytes = await page.pdf(pdfOptions(request));
    if (await countPdfPages(bytes) !== 1) {
      throw new PdfServiceError('fixed_page_overflow', 422, `Fixed page ${index + 1} did not render as exactly one PDF page.`);
    }
    internalLinks.push(...geometry.internalLinks);
    pages.push(bytes);
  }
  return { pdf: await mergePdfPages(pages, internalLinks), layoutDiagnostics: null };
}

async function observeFlowLayout(page: Page, settings: PageSettings): Promise<FlowLayoutDiagnostics> {
  const pageWidthInches = settings.format === 'Letter' || settings.format === 'Legal' ? 8.5 : 8.267;
  const physicalWidthInches = settings.orientation === 'portrait'
    ? pageWidthInches
    : settings.format === 'Letter'
      ? 11
      : settings.format === 'Legal'
        ? 14
        : 11.69;
  const printableWidthPixels = Math.max(
    1,
    Math.round((physicalWidthInches - settings.marginsInches.left - settings.marginsInches.right) * 96)
  );
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
