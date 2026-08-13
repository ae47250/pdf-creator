'use client';

import { useEffect, useMemo, useState } from 'react';
import { SAVED_FIXTURES, smokeHtml, type FixtureName } from '@/lib/pdf/fixtures';

type Result = Record<string, unknown> & { links?: { view?: string; download?: string } };

export default function ConsoleForm({ appABaseline }: { appABaseline: string }) {
  const [smokeText, setSmokeText] = useState('A fictional smoke test for the PDF creation service.');
  const [html, setHtml] = useState(SAVED_FIXTURES.onePage);
  const [fixture, setFixture] = useState<FixtureName>('onePage');
  const [filename, setFilename] = useState('Test_Report.pdf');
  const [storeResult, setStoreResult] = useState(false);
  const [storeHtml, setStoreHtml] = useState(true);
  const [format, setFormat] = useState('Letter');
  const [orientation, setOrientation] = useState('portrait');
  const [expectedPageCount, setExpectedPageCount] = useState('');
  const [retentionDays, setRetentionDays] = useState('30');
  const [status, setStatus] = useState('Ready.');
  const [result, setResult] = useState<Result | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [directPdfUrl, setDirectPdfUrl] = useState('');
  const [directPdfFilename, setDirectPdfFilename] = useState('');
  const busy = status === 'Creating PDF…';

  useEffect(() => () => { if (directPdfUrl) URL.revokeObjectURL(directPdfUrl); }, [directPdfUrl]);
  const previewUrl = useMemo(() => result?.links?.view || directPdfUrl, [result, directPdfUrl]);

  function loadFixture(name: FixtureName) {
    setFixture(name);
    setHtml(name === 'appA' ? appABaseline : SAVED_FIXTURES[name]);
    setExpectedPageCount(name === 'fixed' ? '3' : '');
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.html') || file.type && file.type !== 'text/html') {
      setStatus('Upload rejected: select a .html file.');
      return;
    }
    if (file.size > 3_500_000) {
      setStatus('Upload rejected: HTML exceeds 3,500,000 bytes.');
      return;
    }
    setHtml(await file.text());
    setExpectedPageCount('');
    setStatus(`Loaded ${file.size.toLocaleString()} HTML bytes.`);
  }

  async function submit() {
    const requestedFilename = filename;
    setStatus('Creating PDF…');
    setResult(null);
    if (directPdfUrl) URL.revokeObjectURL(directPdfUrl);
    setDirectPdfUrl('');
    setDirectPdfFilename('');
    try {
      const payload = {
        html,
        filename,
        storeResult,
        storeHtml: storeResult ? storeHtml : false,
        page: {
          format,
          orientation,
          marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
        },
        ...(expectedPageCount ? { expectedPageCount: Number(expectedPageCount) } : {}),
        ...(storeResult ? { retentionDays: Number(retentionDays) } : {}),
        ...(storeResult ? { idempotencyKey: `console:${crypto.randomUUID()}` } : {}),
        correlationId: `console-${Date.now()}`
      };
      const response = await fetch('/api/console/pdfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const error = contentType.includes('json') ? await response.json() : { error: { message: await response.text() } };
        throw new Error(error?.error?.message ?? `Request failed with ${response.status}.`);
      }
      setPreviewHtml(html);
      if (contentType.includes('application/pdf')) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setDirectPdfUrl(url);
        setDirectPdfFilename(requestedFilename);
        setResult({
          status: 'complete',
          requestId: response.headers.get('x-pdf-request-id'),
          caller: response.headers.get('x-pdf-caller'),
          durationMs: response.headers.get('x-pdf-duration-ms'),
          htmlBytes: response.headers.get('x-pdf-html-bytes'),
          pdfBytes: response.headers.get('x-pdf-bytes'),
          pageCount: response.headers.get('x-pdf-page-count'),
          pageDimensions: response.headers.get('x-pdf-page-dimensions'),
          sha256: response.headers.get('x-pdf-sha256'),
          storage: { status: 'not-requested', htmlStored: false }
        });
      } else {
        setResult(await response.json());
      }
      setStatus('PDF created and validated.');
    } catch (error) {
      setStatus(error instanceof Error ? `PDF creation failed: ${error.message}` : 'PDF creation failed.');
    }
  }

  return (
    <div className="console-grid">
      <section className="panel">
        <h2>Plain-text smoke test</h2>
        <label htmlFor="smoke-text">Fictional text</label>
        <textarea id="smoke-text" rows={4} value={smokeText} onChange={(event) => setSmokeText(event.target.value)} />
        <button type="button" className="secondary" onClick={() => { setHtml(smokeHtml(smokeText)); setExpectedPageCount(''); setStatus('Smoke-test HTML prepared.'); }}>Prepare smoke-test HTML</button>
      </section>

      <section className="panel wide">
        <h2>Completed self-contained HTML</h2>
        <label htmlFor="fixture">Saved fixture</label>
        <select id="fixture" value={fixture} onChange={(event) => loadFixture(event.target.value as FixtureName)}>
          <option value="onePage">Generic one-page</option>
          <option value="flowing">Generic flowing multi-page</option>
          <option value="fixed">Generic fixed-page markers</option>
          <option value="appA">Mr. Lombardi frozen baseline (non-production)</option>
        </select>
        <label htmlFor="html-upload">Upload .html</label>
        <input id="html-upload" type="file" accept=".html,text/html" onChange={(event) => void upload(event.target.files?.[0])} />
        <label htmlFor="html">HTML ({new Blob([html]).size.toLocaleString()} bytes)</label>
        <textarea id="html" className="code" rows={15} value={html} onChange={(event) => setHtml(event.target.value)} />
      </section>

      <section className="panel wide controls">
        <h2>PDF settings</h2>
        <label>Filename<input value={filename} onChange={(event) => setFilename(event.target.value)} /></label>
        <label>Page format<select value={format} onChange={(event) => setFormat(event.target.value)}><option>Letter</option><option>A4</option><option>Legal</option></select></label>
        <label>Orientation<select value={orientation} onChange={(event) => setOrientation(event.target.value)}><option>portrait</option><option>landscape</option></select></label>
        <div>
          <label htmlFor="exact-page-count">Exact page count (optional)</label>
          <input id="exact-page-count" type="number" min="1" max="25" value={expectedPageCount} onChange={(event) => setExpectedPageCount(event.target.value)} aria-describedby="exact-page-count-help" />
          <small id="exact-page-count-help">Leave blank for automatic pagination. If entered, the generated PDF must match this number exactly.</small>
        </div>
        <label className="check"><input type="checkbox" checked={storeResult} onChange={(event) => setStoreResult(event.target.checked)} /> Store result</label>
        <label className="check"><input type="checkbox" checked={storeHtml} disabled={!storeResult} onChange={(event) => setStoreHtml(event.target.checked)} /> Store rendered HTML</label>
        <label>Retention<select disabled={!storeResult} value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label>
        <button type="button" onClick={() => void submit()} disabled={busy}>{busy ? 'Creating…' : 'Generate validated PDF'}</button>
        <p className="status" aria-live="polite">{status}</p>
      </section>

      {previewHtml && <section className="panel wide"><h2>Validated sandbox preview</h2><iframe className="preview" sandbox="" srcDoc={previewHtml} title="Validated submitted HTML preview" /></section>}
      {result && <section className="panel wide"><h2>Result</h2><dl className="results">{Object.entries(result).filter(([key]) => key !== 'links').map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>{result.links?.view && <p><a href={result.links.view} target="_blank" rel="noreferrer">Open stored PDF</a> · <a href={result.links.download} target="_blank" rel="noreferrer">Download stored PDF</a></p>}{directPdfUrl && <p><a href={directPdfUrl} download={directPdfFilename}>Download direct PDF</a></p>}{previewUrl && <iframe className="pdf-preview" src={previewUrl} title="Generated PDF preview" />}</section>}
    </div>
  );
}
