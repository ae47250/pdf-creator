import { LIMITS } from '@/lib/pdf/limits';

export const TEST_BEARER_KEY = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

export const letterPage = {
  format: 'Letter' as const,
  orientation: 'portrait' as const,
  marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
};

export interface SuccessFixture {
  id: string;
  title: string;
  html: string;
  filename: string;
  expectedText: string[];
  pageRange: [number, number];
  visual: boolean;
  page?: typeof letterPage;
}

export interface InvalidScenario {
  id: string;
  payload: unknown;
  authorization?: string;
  expectedStatus: number;
  expectedCode: string;
}

const baseCss = `
  *{box-sizing:border-box}
  body{margin:0;color:#17201a;background:#fff;font-family:Arial,sans-serif;font-size:12pt;line-height:1.45}
  main{padding:.65in}h1,h2,h3{break-after:avoid;color:#214f37}h1{font-size:24pt}h2{font-size:16pt;margin-top:22pt}
  p,li{orphans:3;widows:3}a{color:#185aa7}table{width:100%;border-collapse:collapse}th,td{padding:6px;border:1px solid #9fb0a5;text-align:left}
`;

function document(title: string, body: string, css = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${baseCss}${css}</style></head><body><main>${body}</main></body></html>`;
}

function fixedPages(title: string, pages: string[], css = ''): string {
  return document(
    title,
    pages.map((body, index) => `<section data-pdf-page><header>${title}</header>${body}<footer>Page ${index + 1} of ${pages.length}</footer></section>`).join(''),
    `main{padding:0}section[data-pdf-page]{position:relative;width:8.5in;height:11in;padding:.65in;overflow:hidden;break-after:page}header{border-bottom:2px solid #214f37;padding-bottom:8px;font-weight:700}footer{position:absolute;left:.65in;right:.65in;bottom:.4in;border-top:1px solid #9fb0a5;padding-top:6px;text-align:right;font-size:9pt}${css}`
  );
}

function svgDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="280" viewBox="0 0 640 280"><rect width="640" height="280" fill="#edf5f0"/><line x1="60" y1="230" x2="600" y2="230" stroke="#173b2a" stroke-width="3"/><line x1="60" y1="30" x2="60" y2="230" stroke="#173b2a" stroke-width="3"/><rect x="110" y="150" width="70" height="80" fill="#2f7d50"/><rect x="250" y="105" width="70" height="125" fill="#4d91c6"/><rect x="390" y="65" width="70" height="165" fill="#d18a2d"/><text x="60" y="22" font-family="Arial" font-size="18">Fictional index chart</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const academic = fixedPages('Fictional Academic Report', [
  '<h1>Public Finance and Local Investment</h1><p>Executive summary for a fictional classroom exercise.</p><h2>Research question</h2><p>How do stable public investments affect long-run productivity?</p><h2>Method</h2><p>The example compares three invented regions and contains no personal or production data.</p>',
  '<h1>Results</h1><table><thead><tr><th>Region</th><th>Index</th><th>Change</th></tr></thead><tbody><tr><td>North</td><td>104</td><td>+4%</td></tr><tr><td>Central</td><td>101</td><td>+1%</td></tr><tr><td>South</td><td>106</td><td>+6%</td></tr></tbody></table><h2>Interpretation</h2><p>The fictional estimates are descriptive and not policy advice.</p>',
  '<h1>Conclusion</h1><p>The exercise demonstrates stable multi-page pagination, headings, tables, citations, and page numbering.</p><h2>References</h2><ol><li><a href="https://example.com/research">Example research reference</a></li><li><a href="https://example.com/data">Example data reference</a></li></ol>'
]);

const longReport = document(
  'Long Flowing Report',
  `<h1>Long Flowing Report</h1>${Array.from({ length: 70 }, (_, index) => `<section><h2>Section ${index + 1}</h2><p>Stable paragraph ${index + 1} tests flowing pagination, heading placement, widows, and orphans. The content is fictional and deliberately repetitive for regression testing.</p></section>`).join('')}`
);

const flowingTwentyPageReport = document(
  'Extended Natural-Flow Report',
  `<h1>Extended Natural-Flow Report</h1>${Array.from({ length: 180 }, (_, index) => `<section><h2>Natural section ${index + 1}</h2><p>Fictional natural-flow paragraph ${index + 1} verifies long browser pagination without fixed markers or an exact expected-page assertion. Stable wrapping and heading placement remain caller-controlled.</p></section>`).join('')}`
);

const tableReport = document(
  'Table Pagination Report',
  `<h1>Table Pagination Report</h1><p>This table intentionally crosses page boundaries.</p><table><thead><tr><th>Observation</th><th>Fictional value</th><th>Comment</th></tr></thead><tbody>${Array.from({ length: 85 }, (_, index) => `<tr><td>Row ${index + 1}</td><td>${(100 + index / 10).toFixed(1)}</td><td>Stable table regression entry</td></tr>`).join('')}</tbody></table>`,
  'main{padding:0}thead{display:table-header-group}tr{break-inside:avoid}th{background:#dfeee5}'
);

const flowingTablePage = {
  ...letterPage,
  marginsInches: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 }
};

const mediaReport = document(
  'Embedded Media and Chart Report',
  `<h1>Embedded Media and Chart Report</h1><p>All artwork is embedded and fictional.</p><img src="${svgDataUrl()}" alt="Bar chart with three fictional values"><h2>Findings</h2><ul><li>Embedded logo and chart rendering</li><li>Lists and HTTPS links</li><li><a href="https://example.com/chart-source">Example chart source</a></li></ul>`,
  'img{display:block;width:100%;max-width:6.8in;height:auto;margin:18px auto;border:1px solid #9fb0a5}'
);

const pagedReport = fixedPages('Headers and Deliberate Breaks', [
  '<h1>Deliberate Page One</h1><p>This page verifies margins, a header, a footer, and a deliberate fixed-page break.</p>',
  '<h1>Deliberate Page Two</h1><p>This second page verifies numbering and consistent branding.</p>'
]);

const unicodeEconomics = document(
  'Unicode and Economics Notation',
  '<h1>Unicode and Economics Notation</h1><p>English, Español, Français, Íslenska, Deutsch, Português, Русский, Ελληνικά.</p><p>Accents: á é í ó ú ý ñ ç ø å æ ß.</p><p>Economics: GDPₜ = Cₜ + Iₜ + Gₜ + NXₜ; π = ΔP/P; β, γ, λ, μ, σ; x² + y² ≥ 0; ∑ᵢ qᵢpᵢ.</p>'
);

function appFixture(name: string, color: string, accent: string): string {
  return document(
    `${name} CSS Isolation`,
    `<article class="application-card"><p class="application-label">${name}</p><h1>${name} CSS Isolation</h1><p>Only ${name} colors and content may appear in this request.</p></article>`,
    `.application-card{margin:.5in;padding:.45in;border:12px solid ${accent};background:${color}}.application-label{font-weight:800;text-transform:uppercase;color:${accent}}`
  );
}

const edgeFixedPages = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fixed-page boundary report</title>
  <style>
    @page { size: Letter; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #183047; font: 14px/1.45 Arial, sans-serif; }
    [data-pdf-page] { position: relative; width: 8.5in; height: 11in; padding: .55in; overflow: hidden; break-after: page; }
    header { border-bottom: 3px solid #246a8a; padding-bottom: 12px; font-weight: 700; }
    h1 { font-size: 27px; margin: 32px 0 12px; }
    .card { border: 1px solid #9cb4c3; border-radius: 8px; padding: 18px; background: #eef5f8; }
    footer { position: absolute; bottom: .4in; right: .55in; left: .55in; border-top: 1px solid #9cb4c3; padding-top: 8px; text-align: right; }
  </style>
</head>
<body>
  <section data-pdf-page>
    <header>Fixed-page boundary report</header>
    <h1>Fixed page one</h1>
    <div class="card">The first page establishes the top, side, and footer boundaries.</div>
    <footer>Page 1 of 3</footer>
  </section>
  <section data-pdf-page>
    <header>Fixed-page boundary report</header>
    <h1>Fixed page two</h1>
    <div class="card">This middle page verifies isolated page rendering and ordering.</div>
    <footer>Page 2 of 3</footer>
  </section>
  <section data-pdf-page>
    <header>Fixed-page boundary report</header>
    <h1>Fixed page three</h1>
    <div class="card">The final page must not be dropped, duplicated, or reordered.</div>
    <footer>Page 3 of 3</footer>
  </section>
</body>
</html>`;

const edgeLongTable = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Long table pagination</title>
  <style>
    @page { size: Letter; margin: .55in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #24342b; font: 12px/1.35 Arial, sans-serif; }
    h1 { font-size: 24px; margin: 0 0 12px; }
    p { margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #a9b8ac; padding: 8px 10px; text-align: left; }
    th { background: #dcebe0; }
    tbody tr:nth-child(even) { background: #f4f8f5; }
  </style>
</head>
<body>
  <h1>Long table pagination</h1>
  <p>Every row, including the final row, must survive a page break. The header should repeat.</p>
  <table>
    <thead><tr><th>Row</th><th>Fictional value</th><th>Control label</th></tr></thead>
    <tbody>
      <tr><td>01</td><td>101.1</td><td>North sample</td></tr>
      <tr><td>02</td><td>102.2</td><td>North sample</td></tr>
      <tr><td>03</td><td>103.3</td><td>North sample</td></tr>
      <tr><td>04</td><td>104.4</td><td>North sample</td></tr>
      <tr><td>05</td><td>105.5</td><td>North sample</td></tr>
      <tr><td>06</td><td>106.6</td><td>North sample</td></tr>
      <tr><td>07</td><td>107.7</td><td>North sample</td></tr>
      <tr><td>08</td><td>108.8</td><td>North sample</td></tr>
      <tr><td>09</td><td>109.9</td><td>North sample</td></tr>
      <tr><td>10</td><td>110.0</td><td>North sample</td></tr>
      <tr><td>11</td><td>111.1</td><td>North sample</td></tr>
      <tr><td>12</td><td>112.2</td><td>North sample</td></tr>
      <tr><td>13</td><td>113.3</td><td>North sample</td></tr>
      <tr><td>14</td><td>114.4</td><td>North sample</td></tr>
      <tr><td>15</td><td>115.5</td><td>North sample</td></tr>
      <tr><td>16</td><td>116.6</td><td>North sample</td></tr>
      <tr><td>17</td><td>117.7</td><td>North sample</td></tr>
      <tr><td>18</td><td>118.8</td><td>North sample</td></tr>
      <tr><td>19</td><td>119.9</td><td>North sample</td></tr>
      <tr><td>20</td><td>120.0</td><td>North sample</td></tr>
      <tr><td>21</td><td>121.1</td><td>South sample</td></tr>
      <tr><td>22</td><td>122.2</td><td>South sample</td></tr>
      <tr><td>23</td><td>123.3</td><td>South sample</td></tr>
      <tr><td>24</td><td>124.4</td><td>South sample</td></tr>
      <tr><td>25</td><td>125.5</td><td>South sample</td></tr>
      <tr><td>26</td><td>126.6</td><td>South sample</td></tr>
      <tr><td>27</td><td>127.7</td><td>South sample</td></tr>
      <tr><td>28</td><td>128.8</td><td>South sample</td></tr>
      <tr><td>29</td><td>129.9</td><td>South sample</td></tr>
      <tr><td>30</td><td>130.0</td><td>South sample</td></tr>
      <tr><td>31</td><td>131.1</td><td>South sample</td></tr>
      <tr><td>32</td><td>132.2</td><td>South sample</td></tr>
      <tr><td>33</td><td>133.3</td><td>South sample</td></tr>
      <tr><td>34</td><td>134.4</td><td>South sample</td></tr>
      <tr><td>35</td><td>135.5</td><td>South sample</td></tr>
      <tr><td>36</td><td>136.6</td><td>South sample</td></tr>
      <tr><td>37</td><td>137.7</td><td>South sample</td></tr>
      <tr><td>38</td><td>138.8</td><td>South sample</td></tr>
      <tr><td>39</td><td>139.9</td><td>South sample</td></tr>
      <tr><td>40</td><td>140.0</td><td>Final row sentinel</td></tr>
    </tbody>
  </table>
</body>
</html>`;

const edgeUnicode = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Unicode and notation</title>
  <style>
    @page { size: Letter; margin: .6in; }
    body { margin: 0; color: #222; font: 18px/1.6 Arial, sans-serif; }
    h1 { color: #304d7a; font-size: 28px; }
    .sample { padding: 10px 14px; border-left: 4px solid #304d7a; background: #f3f6fb; }
  </style>
</head>
<body>
  <h1>Unicode and notation</h1>
  <p class="sample">Español: año, acción. Français: élève, façade. Português: coração. Deutsch: Straße.</p>
  <p class="sample">Greek: α β γ Δ π Σ. Economics: GDPₜ = Cₜ + Iₜ + Gₜ + NXₜ.</p>
  <p class="sample">Mathematics: x² + y² ≥ 0; ∑ᵢ qᵢpᵢ = 42.</p>
  <p>The final line is a visual glyph and extraction sentinel: café 42.</p>
</body>
</html>`;

const edgeEmbeddedMedia = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Embedded artwork and links</title>
  <style>
    @page { size: Letter; margin: .55in; }
    body { margin: 0; color: #17324d; font: 16px/1.45 Arial, sans-serif; }
    h1 { font-size: 27px; margin: 0 0 12px; }
    figure { margin: 20px 0; padding: 16px; border: 1px solid #afc5d4; background: #f7fbfd; }
    img { display: block; width: 100%; max-width: 6.3in; height: auto; }
    figcaption { margin-top: 10px; font-size: 13px; }
    a { color: #075c91; text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Embedded artwork and links</h1>
  <p>This page must render without fetching a network resource.</p>
  <figure>
    <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMjQwIiB2aWV3Qm94PSIwIDAgNjQwIDI0MCI+PHJlY3Qgd2lkdGg9IjY0MCIgaGVpZ2h0PSIyNDAiIGZpbGw9IiNlZWY1ZmIiLz48cmVjdCB4PSI2NCIgeT0iMTE4IiB3aWR0aD0iMTEwIiBoZWlnaHQ9IjgyIiBmaWxsPSIjMjg3NmE1Ii8+PHJlY3QgeD0iMjM4IiB5PSI3OCIgd2lkdGg9IjExMCIgaGVpZ2h0PSIxMjIiIGZpbGw9IiM0ZDk0NjMiLz48cmVjdCB4PSI0MTIiIHk9IjM4IiB3aWR0aD0iMTEwIiBoZWlnaHQ9IjE2MiIgZmlsbD0iI2M5N2IzMiIvPjx0ZXh0IHg9IjY0IiB5PSIyOCIgZm9udC1zaXplPSIyMCIgZmlsbD0iIzE3MzI0ZCI+UXVhcnRlcmx5IGluZGV4PC90ZXh0Pjwvc3ZnPg==" alt="Three rising bars in a fictional quarterly index chart">
    <figcaption>Figure 1. Fictional quarterly index: 82, 122, and 162.</figcaption>
  </figure>
  <p><a href="https://example.com/reference">External reference link</a> and <a href="#note">internal note link</a>.</p>
  <p id="note">Internal note destination.</p>
</body>
</html>`;

const edgeWrapAndGrid = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Wrapping and grid boundaries</title>
  <style>
    @page { size: Letter; margin: .45in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #2c2d35; font: 14px/1.4 Arial, sans-serif; }
    h1 { font-size: 25px; margin: 0 0 18px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
    .card { min-width: 0; padding: 16px; border: 1px solid #b2a5c2; border-radius: 8px; background: #f7f3fb; }
    .token { overflow-wrap: anywhere; word-break: break-word; font-family: monospace; }
    .footer { margin-top: 22px; padding: 12px; background: #e8e1f0; }
  </style>
</head>
<body>
  <h1>Wrapping and grid boundaries</h1>
  <div class="grid">
    <div class="card"><strong>Left column</strong><p>The left cell contains an unbroken token that must wrap inside its border.</p><p class="token">CASELEFT-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-END</p></div>
    <div class="card"><strong>Right column</strong><p>Long labels and compact boxes should remain aligned with the left column.</p><p class="token">CASERIGHT-1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-END</p></div>
  </div>
  <p class="footer">Both terminal markers must remain visible: CASELEFT-END and CASERIGHT-END.</p>
</body>
</html>`;

export const successFixtures: Record<string, SuccessFixture> = {
  minimal: { id: 'minimal', title: 'Minimal one-page document', html: document('Minimal Report', '<h1>Minimal Report</h1><p>Minimal fixture sentinel.</p>'), filename: 'Minimal_Report.pdf', expectedText: ['Minimal Report', 'Minimal fixture sentinel'], pageRange: [1, 1], visual: true },
  academic: { id: 'academic', title: 'Realistic multi-page academic report', html: academic, filename: 'Academic_Report.pdf', expectedText: ['Public Finance and Local Investment', 'Page 3 of 3'], pageRange: [3, 3], visual: true },
  long: { id: 'long', title: 'Long report with headings and paragraphs', html: longReport, filename: 'Long_Report.pdf', expectedText: ['Long Flowing Report', 'Section 70'], pageRange: [5, 15], visual: false },
  flowing20: { id: 'flowing20', title: 'Approximately twenty-page natural-flow report', html: flowingTwentyPageReport, filename: 'Extended_Natural_Flow_Report.pdf', expectedText: ['Extended Natural-Flow Report', 'Natural section 180'], pageRange: [17, 23], visual: false },
  tables: { id: 'tables', title: 'Table-heavy report crossing pages', html: tableReport, filename: 'Table_Report.pdf', expectedText: ['Table Pagination Report', 'Row 85'], pageRange: [2, 8], visual: true, page: flowingTablePage },
  media: { id: 'media', title: 'Lists, hyperlinks, embedded image, and chart', html: mediaReport, filename: 'Media_Report.pdf', expectedText: ['Embedded Media and Chart Report', 'Example chart source'], pageRange: [1, 2], visual: true },
  paged: { id: 'paged', title: 'Headers, footers, page numbers, margins, and breaks', html: pagedReport, filename: 'Paged_Report.pdf', expectedText: ['Deliberate Page One', 'Page 2 of 2'], pageRange: [2, 2], visual: false },
  unicode: { id: 'unicode', title: 'Unicode and international text', html: unicodeEconomics, filename: 'Unicode_Report.pdf', expectedText: ['Unicode and Economics Notation', 'Русский'], pageRange: [1, 1], visual: true },
  accented: { id: 'accented', title: 'Accented characters', html: document('Accented Characters', '<h1>Accented Characters</h1><p>á é í ó ú ý ñ ç ø å æ ß</p>'), filename: 'Accented_Report.pdf', expectedText: ['Accented Characters', 'áéíóú'], pageRange: [1, 1], visual: false },
  economics: { id: 'economics', title: 'Mathematical and economics notation', html: document('Economics Notation', '<h1>Economics Notation</h1><p>GDPₜ = Cₜ + Iₜ + Gₜ + NXₜ; π, β, γ, λ, μ, σ; x² ≥ 0.</p>'), filename: 'Economics_Notation.pdf', expectedText: ['Economics Notation', 'GDP'], pageRange: [1, 1], visual: false },
  short: { id: 'short', title: 'Very short document', html: document('Short', '<p>OK</p>'), filename: 'Short.pdf', expectedText: ['OK'], pageRange: [1, 1], visual: false },
  large: { id: 'large', title: 'Large but permitted document', html: document('Large Permitted Report', '<h1>Large Permitted Report</h1><p>Large permitted fixture sentinel.</p>', `/*${'x'.repeat(3_000_000)}*/`), filename: 'Large_Permitted_Report.pdf', expectedText: ['Large Permitted Report'], pageRange: [1, 1], visual: false },
  edgeFixedPages: { id: 'edgeFixedPages', title: 'Fixed-page boundary report', html: edgeFixedPages, filename: 'Edge_Fixed_Pages.pdf', expectedText: ['Fixed page one', 'Fixed page two', 'Fixed page three', 'Page 3 of 3'], pageRange: [3, 3], visual: true },
  edgeLongTable: { id: 'edgeLongTable', title: 'Long table pagination edge case', html: edgeLongTable, filename: 'Edge_Long_Table.pdf', expectedText: ['Long table pagination', 'North sample', 'Final row sentinel'], pageRange: [2, 4], visual: true, page: { format: 'Letter', orientation: 'portrait', marginsInches: { top: 0.55, right: 0.55, bottom: 0.55, left: 0.55 } } },
  edgeUnicode: { id: 'edgeUnicode', title: 'Unicode and notation edge case', html: edgeUnicode, filename: 'Edge_Unicode.pdf', expectedText: ['Unicode and notation', 'Español', 'Straße', 'α β γ Δ π Σ', 'x² + y² ≥ 0', '∑ᵢ qᵢpᵢ = 42', 'café 42'], pageRange: [1, 1], visual: true, page: { format: 'Letter', orientation: 'portrait', marginsInches: { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 } } },
  edgeEmbeddedMedia: { id: 'edgeEmbeddedMedia', title: 'Embedded artwork and links edge case', html: edgeEmbeddedMedia, filename: 'Edge_Embedded_Media.pdf', expectedText: ['Embedded artwork and links', 'Figure 1.', 'Internal note destination'], pageRange: [1, 1], visual: true, page: { format: 'Letter', orientation: 'portrait', marginsInches: { top: 0.55, right: 0.55, bottom: 0.55, left: 0.55 } } },
  edgeWrapAndGrid: { id: 'edgeWrapAndGrid', title: 'Wrapping and grid boundaries edge case', html: edgeWrapAndGrid, filename: 'Edge_Wrap_And_Grid.pdf', expectedText: ['Wrapping and grid boundaries', 'CASELEFT-END', 'CASERIGHT-END'], pageRange: [1, 1], visual: true, page: { format: 'Letter', orientation: 'portrait', marginsInches: { top: 0.45, right: 0.45, bottom: 0.45, left: 0.45 } } },
  appBlue: { id: 'appBlue', title: 'Application Blue CSS', html: appFixture('Application Blue', '#e8f3ff', '#0b5cad'), filename: 'Application_Blue.pdf', expectedText: ['Application Blue CSS Isolation', 'Only Application Blue'], pageRange: [1, 1], visual: true },
  appGold: { id: 'appGold', title: 'Application Gold CSS', html: appFixture('Application Gold', '#fff6d8', '#8a5a00'), filename: 'Application_Gold.pdf', expectedText: ['Application Gold CSS Isolation', 'Only Application Gold'], pageRange: [1, 1], visual: true }
};

const validPayload = (html = successFixtures.minimal.html) => ({
  html,
  filename: 'Regression_Test.pdf',
  storeResult: false,
  page: letterPage,
  expectedPageCount: 1
});

export const invalidScenarios: InvalidScenario[] = [
  { id: 'malformed-html', payload: validPayload('<html><head></head><body><p>Missing doctype and closing tags'), expectedStatus: 400, expectedCode: 'unsafe_html' },
  { id: 'empty-request', payload: {}, expectedStatus: 400, expectedCode: 'invalid_request' },
  { id: 'missing-required-fields', payload: { html: successFixtures.minimal.html }, expectedStatus: 400, expectedCode: 'invalid_request' },
  { id: 'invalid-request-types', payload: { ...validPayload(), storeResult: 'no' }, expectedStatus: 400, expectedCode: 'invalid_request' },
  { id: 'unauthorized-request', payload: validPayload(), authorization: '', expectedStatus: 401, expectedCode: 'unauthorized' },
  { id: 'failed-external-asset', payload: validPayload('<!doctype html><html><head></head><body><img src="https://example.com/image.png" alt="external"></body></html>'), expectedStatus: 400, expectedCode: 'unsafe_html' },
  { id: 'unsupported-dangerous-input', payload: validPayload('<!doctype html><html><head></head><body><script>fetch("file:///etc/passwd")</script><p>Dangerous</p></body></html>'), expectedStatus: 400, expectedCode: 'unsafe_html' }
];

export const malformedCssScenario = {
  id: 'malformed-css',
  payload: validPayload('<!doctype html><html><head><style>body{color:</style></head><body>Malformed CSS sentinel</body></html>')
};

export const requiredScenarioIds = [
  'minimal', 'academic', 'long', 'flowing20', 'tables', 'media', 'paged', 'unicode', 'accented', 'economics', 'short', 'large',
  malformedCssScenario.id, ...invalidScenarios.map((scenario) => scenario.id),
  'edgeFixedPages', 'edgeLongTable', 'edgeUnicode', 'edgeEmbeddedMedia', 'edgeWrapAndGrid', 'appBlue', 'appGold'
];

export const representativeFixtureIds = ['minimal', 'academic', 'tables', 'media', 'unicode', 'appBlue', 'appGold'] as const;

export function payloadFor(fixture: SuccessFixture) {
  return {
    html: fixture.html,
    filename: fixture.filename,
    storeResult: false,
    storeHtml: false,
    page: fixture.page ?? letterPage,
    ...(fixture.pageRange[0] === fixture.pageRange[1] ? { expectedPageCount: fixture.pageRange[0] } : {})
  };
}

export function oversizedPayload() {
  return validPayload('x'.repeat(LIMITS.htmlBytes + 1));
}
