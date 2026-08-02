export const LIMITS = Object.freeze({
  requestBytes: 4_000_000,
  htmlBytes: 3_500_000,
  pdfBytes: 4_000_000,
  pages: 25,
  domElements: 10_000,
  domDepth: 64,
  cssRules: 2_000,
  images: 100,
  readinessMs: 20_000,
  browserStartMs: 30_000,
  renderMs: 90_000,
  storageMs: 15_000,
  closeMs: 5_000
});

export const CSP = [
  "default-src 'none'",
  'img-src data:',
  'font-src data:',
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

export const PAGE_POINTS = {
  Letter: { widthPoints: 612, heightPoints: 792 },
  A4: { widthPoints: 595.28, heightPoints: 841.89 },
  Legal: { widthPoints: 612, heightPoints: 1008 }
} as const;

export const RETENTION_DAYS = [1, 7, 30] as const;
