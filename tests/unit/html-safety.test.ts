import { describe, expect, it } from 'vitest';
import { validateAndNormalizeHtml } from '@/lib/pdf/html-safety';
import { PdfServiceError } from '@/lib/pdf/errors';

const page = {
  format: 'Letter' as const,
  orientation: 'portrait' as const,
  marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
};
const document = (body: string, css = '') => `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`;

describe('HTML safety', () => {
  it('accepts static HTML, links, and non-nested markers', () => {
    const safe = validateAndNormalizeHtml(document('<section data-pdf-page><a href="https://example.com">Citation</a></section>'), page);
    expect(safe.markerCount).toBe(1);
    expect(safe.html).toContain('Content-Security-Policy');
    expect(safe.html).toContain('@page{size:Letter portrait');
  });

  it.each([
    ['script', document('<script>alert(1)</script><p>text</p>')],
    ['handler', document('<p onclick="alert(1)">text</p>')],
    ['external image', document('<img src="https://example.com/a.png">')],
    ['relative image', document('<img src="/a.png">')],
    ['javascript link', document('<a href="javascript:alert(1)">text</a>')],
    ['form', document('<form><p>text</p></form>')],
    ['CSS import', document('<p>text</p>', '@import "https://example.com/a.css";')],
    ['external CSS URL', document('<p>text</p>', 'p{background:url(https://example.com/a.png)}')],
    ['nested markers', document('<section data-pdf-page><div data-pdf-page>text</div></section>')]
  ])('rejects unsafe %s content', (_name, html) => {
    expect(() => validateAndNormalizeHtml(html, page)).toThrow(PdfServiceError);
  });

  it('accepts a valid embedded PNG', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    expect(validateAndNormalizeHtml(document(`<img src="${png}" alt="pixel">`), page).imageCount).toBe(1);
  });
});
