import { randomUUID } from 'node:crypto';
import { authenticateBearer } from '@/lib/pdf/auth';
import { parsePdfCreationRequest, readJsonRequest } from '@/lib/pdf/contract';
import { asServiceError, errorResponse } from '@/lib/pdf/errors';
import { createPdf } from '@/lib/pdf/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const started = Date.now();
  let correlationId: string | undefined;
  try {
    const caller = authenticateBearer(request.headers.get('authorization'));
    const creationRequest = parsePdfCreationRequest(await readJsonRequest(request));
    correlationId = creationRequest.correlationId;
    const origin = new URL(request.url).origin;
    const result = await createPdf(creationRequest, caller, requestId, origin, request);
    if (result.kind === 'stored') {
      logResult({ event: 'pdf_complete', requestId, caller: caller.id, durationMs: result.body.durationMs, htmlBytes: result.body.htmlBytes, pdfBytes: result.body.pdfBytes, pageCount: result.body.pageCount, stored: true });
      return Response.json(result.body, { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } });
    }
    logResult({ event: 'pdf_complete', requestId, caller: caller.id, durationMs: result.durationMs, htmlBytes: result.htmlBytes, pdfBytes: result.render.pdf.byteLength, pageCount: result.render.pageCount, stored: false });
    return new Response(Buffer.from(result.render.pdf), {
      status: 200,
      headers: directHeaders(requestId, caller.id, creationRequest.filename, result)
    });
  } catch (error) {
    const controlled = asServiceError(error);
    logResult({ event: 'pdf_failed', requestId, code: controlled.code, status: controlled.status, durationMs: Date.now() - started });
    return errorResponse(controlled, requestId, correlationId);
  }
}

function directHeaders(requestId: string, caller: string, filename: string, result: Extract<Awaited<ReturnType<typeof createPdf>>, { kind: 'direct' }>): HeadersInit {
  return {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-PDF-Request-Id': requestId,
    'X-PDF-Caller': caller,
    'X-PDF-HTML-Bytes': String(result.htmlBytes),
    'X-PDF-Bytes': String(result.render.pdf.byteLength),
    'X-PDF-Duration-Ms': String(result.durationMs),
    'X-PDF-Page-Count': String(result.render.pageCount),
    'X-PDF-Page-Dimensions': result.render.pageDimensions.map((item) => `${item.widthPoints}x${item.heightPoints}`).join(','),
    'X-PDF-SHA256': result.render.sha256
  };
}

function logResult(fields: Record<string, string | number | boolean>): void {
  console.info(JSON.stringify(fields));
}
