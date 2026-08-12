import { readFile } from 'node:fs/promises';

export async function nativeFixedReportHtml(sentinel: string, pageCount = 8): Promise<string> {
  const font = await readFile(
    new URL('../quality-audit/fonts/open-sans-v44/OpenSans-latin-wght-v44.woff2', import.meta.url)
  );
  const pages = Array.from({ length: pageCount }, (_, index) => nativePage(sentinel, index, pageCount)).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Native fixed report ${sentinel}</title>
  <style>
    @font-face {
      font-family: "PDF Audit Open Sans";
      font-style: normal;
      font-weight: 400 700;
      font-display: block;
      src: url(data:font/woff2;base64,${font.toString('base64')}) format("woff2");
    }
    @page { size: Letter portrait; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #18232a; font-family: "PDF Audit Open Sans", sans-serif; font-size: 10.5pt; line-height: 1.4; }
    [data-pdf-page] { position: relative; width: 8.5in; height: 11in; padding: .58in .62in .66in; overflow: hidden; background: #fff; }
    header { padding-bottom: 10pt; border-bottom: 3px solid #245f47; }
    h1 { margin: 0; color: #18392b; font-size: 23pt; }
    h2 { margin: 16pt 0 7pt; color: #245f47; font-size: 14pt; }
    p { margin: 7pt 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 7pt; border: 1px solid #a9b9ae; text-align: left; }
    th { background: #e3efe7; }
    a { color: #1b5ea8; }
    footer { position: absolute; right: .62in; bottom: .32in; left: .62in; padding-top: 7pt; border-top: 1px solid #b9cbbf; color: #607066; font-size: 9pt; }
  </style>
</head>
<body>${pages}</body>
</html>`;
}

function nativePage(sentinel: string, index: number, pageCount: number): string {
  const pageNumber = index + 1;
  const id = pageNumber === 1 ? 'native-start' : pageNumber === 2 ? 'native-target' : `native-page-${pageNumber}`;
  const navigation = pageNumber === 1
    ? '<p><a href="#native-target">Continue to the internal page-two destination</a></p>'
    : pageNumber === 2
      ? '<p><a href="#native-start">Return to the internal page-one destination</a></p>'
      : '';

  return `<section data-pdf-page id="${id}">
    <header><h1>Native Fixed Report - Page ${pageNumber}</h1><p>Isolation sentinel: ${sentinel}</p></header>
    <h2>Selectable native content</h2>
    <p>This fictional page uses real HTML text so the fixed-page copy and merge boundary can be inspected.</p>
    <ul><li>Selectable heading and paragraph text</li><li>Ordered native list content</li><li>No external assets or scripts</li></ul>
    <table><thead><tr><th>Measure</th><th>Fictional value</th></tr></thead><tbody><tr><td>Page sequence</td><td>${pageNumber} of ${pageCount}</td></tr><tr><td>Sentinel</td><td>${sentinel}</td></tr></tbody></table>
    <p><a href="https://example.com/pdf-creator/native-fixed">Synthetic HTTPS reference</a></p>
    ${navigation}
    <footer>Native fixed qualification fixture - Page ${pageNumber} of ${pageCount}</footer>
  </section>`;
}
