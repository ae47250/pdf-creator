import { randomUUID } from 'node:crypto';
import { CONSOLE_SESSION_COOKIE, hasConsoleAccess, isConsoleEnabled, readCookie, requireSameOrigin } from '@/lib/console-auth';
import { authenticateBearer } from '@/lib/pdf/auth';
import { parsePdfCreationRequest, readJsonRequest } from '@/lib/pdf/contract';
import { errorResponse, PdfServiceError } from '@/lib/pdf/errors';
import { createPdf } from '@/lib/pdf/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  let correlationId: string | undefined;
  try {
    if (!isConsoleEnabled()) throw new PdfServiceError('caller_forbidden', 404, 'The testing console is disabled.');
    if (!hasConsoleAccess(readCookie(request.headers.get('cookie'), CONSOLE_SESSION_COOKIE))) {
      throw new PdfServiceError('caller_forbidden', 403, 'Sign in to the testing console first.');
    }
    const origin = requireSameOrigin(request);
    const key = process.env.PDF_CREATION_TEST;
    if (!key) throw new PdfServiceError('service_unavailable', 503, 'The testing caller is not configured.');
    const caller = authenticateBearer(`Bearer ${key}`);
    const creationRequest = parsePdfCreationRequest(await readJsonRequest(request));
    correlationId = creationRequest.correlationId;
    const result = await createPdf(creationRequest, caller, requestId, origin, request);
    if (result.kind === 'stored') {
      return Response.json(result.body, { headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } });
    }
    return new Response(Buffer.from(result.render.pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${creationRequest.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-PDF-Request-Id': requestId,
        'X-PDF-Caller': caller.id,
        'X-PDF-HTML-Bytes': String(result.htmlBytes),
        'X-PDF-Bytes': String(result.render.pdf.byteLength),
        'X-PDF-Duration-Ms': String(result.durationMs),
        'X-PDF-Page-Count': String(result.render.pageCount),
        'X-PDF-Page-Dimensions': result.render.pageDimensions.map((item) => `${item.widthPoints}x${item.heightPoints}`).join(','),
        'X-PDF-SHA256': result.render.sha256
      }
    });
  } catch (error) {
    return errorResponse(error, requestId, correlationId);
  }
}
