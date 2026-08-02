import chromium from '@sparticuz/chromium';
import { existsSync } from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { PdfServiceError } from './errors';
import { validateAndNormalizeHtml } from './html-safety';
import { LIMITS } from './limits';
import { countPdfPages, finalizeAndValidatePdf, mergePdfPages } from './pdf-quality';
import type { PdfCreationRequest, RenderResult } from './types';

const localBrowserPaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

export async function renderPdf(request: PdfCreationRequest, caller: string): Promise<RenderResult> {
  const renderStarted = Date.now();
  const safe = validateAndNormalizeHtml(request.html, request.page);
  let browser: Browser | undefined;
  let page: Page | undefined;
  let originalError: unknown;

  try {
    browser = await launchBrowserWithinTimeout();
    page = await browser.newPage();
    await configurePage(page);
    const remainingRenderMs = Math.max(1, LIMITS.renderMs - (Date.now() - renderStarted));
    const raw = await withTimeout(
      safe.markerCount === 0
        ? renderWholeDocument(page, safe.html, request)
        : renderFixedPages(page, safe.html, safe.markerCount, request),
      remainingRenderMs,
      'render_timeout',
      'PDF rendering exceeded the time limit.'
    );
    return await finalizeAndValidatePdf(raw, request, caller, safe.markerCount, safe.html);
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    await closeSafely(page, browser, originalError);
  }
}

async function launchBrowserWithinTimeout(): Promise<Browser> {
  const launch = launchBrowser();
  try {
    return await withTimeout(launch, LIMITS.browserStartMs, 'render_timeout', 'The browser did not start in time.');
  } catch (error) {
    void launch.then((lateBrowser) => closeSafely(undefined, lateBrowser, error)).catch(() => undefined);
    throw error;
  }
}

async function launchBrowser(): Promise<Browser> {
  const explicit = process.env.CHROME_PATH;
  if (explicit && !existsSync(explicit)) {
    throw new PdfServiceError('service_unavailable', 503, 'CHROME_PATH does not point to a readable browser.');
  }
  const local = explicit || localBrowserPaths.find((candidate) => existsSync(candidate));
  if (!local && process.arch !== 'x64') {
    throw new PdfServiceError('service_unavailable', 503, 'Bundled Chromium requires an x64 runtime.');
  }
  return puppeteer.launch({
    args: local
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      : [...chromium.args, '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    executablePath: local || await chromium.executablePath(),
    headless: true
  });
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

async function renderWholeDocument(page: Page, html: string, request: PdfCreationRequest): Promise<Uint8Array> {
  await loadAndWait(page, html);
  return page.pdf(pdfOptions(request));
}

async function renderFixedPages(page: Page, html: string, markerCount: number, request: PdfCreationRequest): Promise<Uint8Array> {
  const pages: Uint8Array[] = [];
  for (let index = 0; index < markerCount; index += 1) {
    await loadAndWait(page, html);
    const geometry = await page.evaluate((selectedIndex) => {
      const markers = Array.from(document.querySelectorAll<HTMLElement>('[data-pdf-page]'));
      const selected = markers[selectedIndex];
      if (!selected) return { missing: true, overflow: false };
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
      return { missing: false, overflow };
    }, index);
    if (geometry.missing) throw new PdfServiceError('pdf_invalid', 500, 'A fixed-page marker disappeared during rendering.');
    if (geometry.overflow) throw new PdfServiceError('fixed_page_overflow', 422, `Fixed page ${index + 1} contains overflowing content.`);
    const bytes = await page.pdf(pdfOptions(request));
    if (await countPdfPages(bytes) !== 1) {
      throw new PdfServiceError('fixed_page_overflow', 422, `Fixed page ${index + 1} did not render as exactly one PDF page.`);
    }
    pages.push(bytes);
  }
  return mergePdfPages(pages);
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
