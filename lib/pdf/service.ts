import { unstable_checkRateLimit as checkRateLimit } from '@vercel/firewall';
import { authorizeRequest } from './auth';
import { PdfServiceError } from './errors';
import { sha256 } from './pdf-quality';
import { renderPdf } from './renderer';
import type { Caller, PdfCreationRequest, RenderResult } from './types';
import { findIdempotentReport } from '@/lib/storage/idempotency';
import { readManifest, storeReport } from '@/lib/storage/report-store';
import type { ReportManifest } from '@/lib/storage/manifest';

let rendererInUse = false;

export type ServiceResult =
  | { kind: 'direct'; render: RenderResult; durationMs: number; htmlBytes: number }
  | { kind: 'stored'; body: StoredResponse };

export interface StoredResponse {
  status: 'complete';
  requestId: string;
  reportId: string;
  caller: string;
  correlationId?: string;
  filename: string;
  createdAt: string;
  expiresAt: string;
  durationMs: number;
  htmlBytes: number;
  pdfBytes: number;
  pageCount: number;
  pageDimensions: { widthPoints: number; heightPoints: number }[];
  sha256: string;
  storage: { status: 'stored'; htmlStored: boolean; idempotentReplay: boolean };
  links: { view: string; download: string };
}

export async function createPdf(
  request: PdfCreationRequest,
  caller: Caller,
  requestId: string,
  baseUrl: string,
  originalRequest?: Request
): Promise<ServiceResult> {
  const started = Date.now();
  authorizeRequest(caller, request);
  await enforceRateLimit(caller, originalRequest);
  const requestHash = hashRequest(request);

  if (request.storeResult && request.idempotencyKey) {
    const existing = await findIdempotentReport(caller.id, request.idempotencyKey, requestHash);
    if (existing) {
      const manifest = await readManifest(existing);
      return { kind: 'stored', body: storedResponse(manifest, requestId, request.correlationId, 0, true, baseUrl) };
    }
  }

  if (rendererInUse) {
    throw new PdfServiceError('renderer_busy', 429, 'This renderer is already processing another PDF.');
  }
  rendererInUse = true;
  let render: RenderResult;
  try {
    render = await renderPdf(request, caller.id);
  } finally {
    rendererInUse = false;
  }

  const durationMs = Date.now() - started;
  const htmlBytes = Buffer.byteLength(request.html, 'utf8');
  if (!request.storeResult) return { kind: 'direct', render, durationMs, htmlBytes };

  const stored = await storeReport(request, caller, render, requestHash);
  return {
    kind: 'stored',
    body: storedResponse(stored.manifest, requestId, request.correlationId, Date.now() - started, stored.replayed, baseUrl)
  };
}

async function enforceRateLimit(caller: Caller, request?: Request): Promise<void> {
  if (!process.env.VERCEL) return;
  const result = await checkRateLimit(`pdf-creation-${caller.id}`, {
    rateLimitKey: caller.id,
    ...(request ? { request } : {})
  });
  if (result.rateLimited || result.error === 'blocked') {
    throw new PdfServiceError('rate_limited', 429, 'This caller has exceeded its PDF creation rate limit.');
  }
  if (result.error === 'not-found') {
    throw new PdfServiceError('service_unavailable', 503, 'The caller rate limit is not configured.');
  }
}

function storedResponse(
  manifest: ReportManifest,
  requestId: string,
  correlationId: string | undefined,
  durationMs: number,
  replayed: boolean,
  baseUrl: string
): StoredResponse {
  return {
    status: 'complete',
    requestId,
    reportId: manifest.reportId,
    caller: manifest.caller,
    ...(correlationId ? { correlationId } : {}),
    filename: manifest.filename,
    createdAt: manifest.createdAt,
    expiresAt: manifest.expiresAt,
    durationMs,
    htmlBytes: manifest.submittedHtmlBytes,
    pdfBytes: manifest.pdf.bytes,
    pageCount: manifest.pageCount,
    pageDimensions: manifest.pageDimensions,
    sha256: manifest.pdf.sha256,
    storage: { status: 'stored', htmlStored: Boolean(manifest.html), idempotentReplay: replayed },
    links: {
      view: `${baseUrl}/reports/${manifest.reportId}`,
      download: `${baseUrl}/reports/${manifest.reportId}/download`
    }
  };
}

export function hashRequest(request: PdfCreationRequest): string {
  const semanticRequest = { ...request };
  delete semanticRequest.correlationId;
  delete semanticRequest.idempotencyKey;
  return sha256(canonicalJson(semanticRequest));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
