import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderPdf } from '@/lib/pdf/renderer';

const page = {
  format: 'Letter' as const,
  orientation: 'portrait' as const,
  marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
};

async function request(fixture: string, expectedPageCount: number) {
  return {
    html: await readFile(new URL(`../fixtures/${fixture}`, import.meta.url), 'utf8'),
    filename: 'Integration_Test.pdf',
    storeResult: false,
    storeHtml: false,
    page,
    expectedPageCount
  };
}

describe.sequential('local Chromium renderer', () => {
  it('renders and validates a whole document', async () => {
    const result = await renderPdf(await request('one-page.html', 1), 'test');
    expect(result.pageCount).toBe(1);
    expect(result.markerCount).toBe(0);
    expect(result.pdf.byteLength).toBeGreaterThan(1_000);
    expect(result.renderer.source).toBe('installed');
    expect(result.renderer.product).toMatch(/Chrome|Chromium|Edg/i);
    expect(result.renderer.version).toMatch(/^\d+(?:\.\d+)+$/);
    expect(result.layoutDiagnostics).toMatchObject({ mode: 'observe-only', observationCount: 0 });
  }, 45_000);

  it('renders a flowing multi-page document once without markers', async () => {
    const result = await renderPdf(await request('flowing-pages.html', 3), 'test');
    expect(result.pageCount).toBe(3);
    expect(result.markerCount).toBe(0);
    expect(result.layoutDiagnostics).toMatchObject({ mode: 'observe-only', observationCount: 0 });
  }, 45_000);

  it('isolates, validates, and merges fixed pages in order', async () => {
    const result = await renderPdf(await request('fixed-pages.html', 3), 'test');
    expect(result.pageCount).toBe(3);
    expect(result.markerCount).toBe(3);
    expect(result.layoutDiagnostics).toBeNull();
  }, 45_000);

  it('reports high-value flowing layout risks without rejecting the PDF', async () => {
    const html = `<!doctype html><html><head><style>
      @page{size:Letter;margin:0}*{box-sizing:border-box}body{margin:0}
      table{width:1000px}.token{display:block;width:240px;white-space:nowrap;overflow:visible}
      .positioned{position:absolute;left:900px;width:200px}.transformed{width:200px;transform:translateX(900px)}
    </style></head><body><main><h1>Observe-only layout probe</h1>
      <table><tr><td>Deliberately wide table</td></tr></table>
      <svg width="1200" height="30" viewBox="0 0 1200 30"><rect width="1200" height="30" fill="#245f47"/></svg>
      <span class="token">${'UNBREAKABLE'.repeat(80)}</span>
      <div class="positioned">Positioned outside printable width</div>
      <div class="transformed">Transformed outside printable width</div>
    </main></body></html>`;
    const result = await renderPdf({ ...(await request('one-page.html', 1)), html }, 'test');
    const kinds = result.layoutDiagnostics?.observations.map((item) => item.kind) ?? [];

    expect(result.pageCount).toBe(1);
    expect(result.layoutDiagnostics?.mode).toBe('observe-only');
    expect(kinds).toEqual(expect.arrayContaining([
      'document_overflow', 'table_overflow', 'image_overflow', 'unbreakable_content', 'positioned_content'
    ]));
  }, 45_000);

  it('preserves the frozen App A baseline with all embedded drum images', async () => {
    const result = await renderPdf(await request('app-a-baseline.html', 1), 'test');
    expect(result.pageCount).toBe(1);
    expect(result.renderedHtml.match(/data:image\/svg\+xml;base64/g)).toHaveLength(4);
  }, 45_000);

  it('renders the complete 25-marker ceiling', async () => {
    const result = await renderPdf(await request('fixed-25-pages.html', 25), 'test');
    expect(result.pageCount).toBe(25);
    expect(result.markerCount).toBe(25);
  }, 90_000);

  it('rejects fixed-page content that exceeds the marker bounds', async () => {
    const html = '<!doctype html><html><head><style>@page{size:Letter;margin:0}body{margin:0}[data-pdf-page]{width:8.5in;height:1in;overflow:hidden}.too-tall{height:2in}</style></head><body><section data-pdf-page><div class="too-tall">Overflow</div></section></body></html>';
    await expect(renderPdf({ ...(await request('one-page.html', 1)), html }, 'test'))
      .rejects.toMatchObject({ code: 'fixed_page_overflow' });
  }, 45_000);

  it('fails closed when a used embedded WOFF2 font cannot load', async () => {
    const bytes = Buffer.alloc(64);
    bytes.write('wOF2', 0, 'ascii');
    const font = bytes.toString('base64');
    const html = `<!doctype html><html><head><style>@font-face{font-family:Broken;src:url(data:font/woff2;base64,${font}) format('woff2')}body{font-family:Broken}</style></head><body><p>Broken font</p></body></html>`;
    await expect(renderPdf({ ...(await request('one-page.html', 1)), html }, 'test'))
      .rejects.toMatchObject({ code: 'asset_not_ready' });
  }, 45_000);

  it('fails closed when an image has a valid signature but cannot decode', async () => {
    const broken = 'data:image/png;base64,iVBORw0KGgoAAA==';
    const html = `<!doctype html><html><head></head><body><img src="${broken}" alt="broken"></body></html>`;
    await expect(renderPdf({ ...(await request('one-page.html', 1)), html }, 'test'))
      .rejects.toMatchObject({ code: 'asset_not_ready' });
  }, 45_000);
});
