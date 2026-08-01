import { randomUUID } from 'node:crypto';
import { PdfServiceError, asServiceError } from '@/lib/pdf/errors';
import { readManifest, readStoredPdf } from './report-store';

export async function reportResponse(reportId: string, disposition: 'inline' | 'attachment'): Promise<Response> {
  const requestId = randomUUID();
  try {
    const manifest = await readManifest(reportId);
    if (new Date(manifest.expiresAt).getTime() <= Date.now()) {
      return reportError(410, 'report_expired', 'This report has expired.', requestId);
    }
    const pdf = await readStoredPdf(manifest);
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': `${disposition}; filename="${manifest.filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': requestId,
        'X-PDF-SHA256': manifest.pdf.sha256
      }
    });
  } catch (error) {
    const controlled = asServiceError(error);
    if (controlled instanceof PdfServiceError && controlled.status === 404) {
      return reportError(404, 'report_not_found', 'The report was not found.', requestId);
    }
    return reportError(502, 'storage_failed', 'The stored report is temporarily unavailable.', requestId);
  }
}

function reportError(status: number, code: string, message: string, requestId: string): Response {
  return Response.json(
    { error: { code, message, requestId, details: [] } },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': requestId
      }
    }
  );
}
