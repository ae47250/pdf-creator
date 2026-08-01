const shell = (title: string, body: string, extraCss = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
*{box-sizing:border-box}body{margin:0;color:#17201a;font-family:Arial,sans-serif;font-size:16px;line-height:1.5}
main{padding:.55in}h1{color:#245b35}section{margin:0 0 24px}${extraCss}
</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

export const SAVED_FIXTURES = {
  onePage: shell('Generic one-page fixture', '<p>This fictional document verifies a simple one-page conversion.</p><p><a href="https://example.com/citation">Example HTTPS citation</a></p>'),
  flowing: shell('Generic flowing fixture', Array.from({ length: 55 }, (_, index) => `<section><h2>Section ${index + 1}</h2><p>This neutral paragraph verifies normal browser pagination for a flowing document. It contains no application data.</p></section>`).join('')),
  fixed: shell('Generic fixed-page fixture', Array.from({ length: 3 }, (_, index) => `<section data-pdf-page><h2>Fixed page ${index + 1}</h2><p>This marker must create exactly one PDF page.</p></section>`).join(''), 'main{padding:0}section[data-pdf-page]{width:8.5in;height:11in;padding:.6in;overflow:hidden;break-after:page}')
} as const;

export type FixtureName = keyof typeof SAVED_FIXTURES | 'appA';

export function smokeHtml(text: string): string {
  return shell('Plain-text smoke test', `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]!);
}
