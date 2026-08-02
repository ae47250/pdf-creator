import { randomUUID } from 'node:crypto';
import packageJson from '@/package.json';
import { PdfServiceError } from '@/lib/pdf/errors';
import { sha256 } from '@/lib/pdf/pdf-quality';
import type { Caller, PdfCreationRequest, RenderResult, RetentionDays } from '@/lib/pdf/types';
import { claimIdempotency, idempotencyHash } from './idempotency';
import { parseManifest, reportLocation, type ReportManifest } from './manifest';
import { callerStoragePrefix } from './prefixes';
import { deleteObjects, getObject, putObject } from './r2';

export interface StoredReport {
  manifest: ReportManifest;
  replayed: boolean;
}

export async function storeReport(
  request: PdfCreationRequest,
  caller: Caller,
  render: RenderResult,
  requestHash: string
): Promise<StoredReport> {
  const retentionDays = request.retentionDays as RetentionDays;
  const uuid = randomUUID();
  const reportId = `r${retentionDays}_${uuid}`;
  const location = reportLocation(reportId)!;
  const artifactPrefix = `${callerStoragePrefix(caller.id)}/${location.prefix}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + retentionDays * 86_400_000);
  const pdfKey = `${artifactPrefix}/report.pdf`;
  const htmlKey = `${artifactPrefix}/rendered.html`;
  const manifestKey = `${location.prefix}/manifest.json`;
  const attempted = [pdfKey, ...(request.storeHtml ? [htmlKey] : [])];
  const renderedHtmlBytes = Buffer.from(render.renderedHtml, 'utf8');

  const uploads = [putObject(pdfKey, render.pdf, 'application/pdf')];
  if (request.storeHtml) uploads.push(putObject(htmlKey, renderedHtmlBytes, 'text/html; charset=utf-8'));
  const results = await Promise.allSettled(uploads);
  if (results.some((result) => result.status === 'rejected')) {
    await cleanup(attempted);
    throw new PdfServiceError('storage_failed', 502, 'The report artifacts could not be stored.');
  }

  const manifest: ReportManifest = {
    version: 1,
    reportId,
    caller: caller.id,
    filename: request.filename,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    pdf: { key: pdfKey, contentType: 'application/pdf', bytes: render.pdf.byteLength, sha256: render.sha256 },
    ...(request.storeHtml ? {
      html: {
        key: htmlKey,
        contentType: 'text/html; charset=utf-8',
        bytes: renderedHtmlBytes.byteLength,
        sha256: sha256(renderedHtmlBytes)
      }
    } : {}),
    submittedHtmlBytes: Buffer.byteLength(request.html, 'utf8'),
    submittedHtmlSha256: sha256(request.html),
    renderedHtmlSha256: sha256(renderedHtmlBytes),
    page: request.page,
    pageCount: render.pageCount,
    pageDimensions: render.pageDimensions,
    metadata: request.metadata ?? {},
    versions: {
      service: packageJson.version,
      node: process.version,
      puppeteer: packageJson.dependencies['puppeteer-core'],
      chromium: packageJson.dependencies['@sparticuz/chromium']
    },
    requestHash,
    ...(request.idempotencyKey ? { idempotencyHash: idempotencyHash(caller.id, request.idempotencyKey) } : {})
  };

  try {
    await putObject(manifestKey, JSON.stringify(manifest), 'application/json', { IfNoneMatch: '*' });
  } catch {
    await cleanup([...attempted, manifestKey]);
    throw new PdfServiceError('storage_failed', 502, 'The report manifest could not be stored.');
  }

  if (request.idempotencyKey) {
    try {
      const claim = await claimIdempotency(caller.id, request.idempotencyKey, {
        requestHash,
        reportId,
        expiresAt: expiresAt.toISOString()
      });
      if (!claim.won) {
        await cleanup([...attempted, manifestKey]);
        return { manifest: await readManifest(claim.reportId), replayed: true };
      }
    } catch (error) {
      await cleanup([...attempted, manifestKey]);
      throw error;
    }
  }
  return { manifest, replayed: false };
}

export async function readManifest(reportId: string): Promise<ReportManifest> {
  const location = reportLocation(reportId);
  if (!location) throw new PdfServiceError('storage_failed', 404, 'The stored report was not found.');
  const object = await getObject(`${location.prefix}/manifest.json`);
  try {
    return parseManifest(JSON.parse(new TextDecoder().decode(object.bytes)));
  } catch (error) {
    if (error instanceof PdfServiceError) throw error;
    throw new PdfServiceError('storage_failed', 502, 'The stored report manifest is invalid.');
  }
}

export async function readStoredPdf(manifest: ReportManifest): Promise<Uint8Array> {
  const object = await getObject(manifest.pdf.key);
  if (object.bytes.byteLength !== manifest.pdf.bytes || sha256(object.bytes) !== manifest.pdf.sha256) {
    throw new PdfServiceError('storage_failed', 502, 'The stored PDF failed its integrity check.');
  }
  return object.bytes;
}

async function cleanup(keys: string[]): Promise<void> {
  try { await deleteObjects(keys); } catch { /* retain original storage failure */ }
}
