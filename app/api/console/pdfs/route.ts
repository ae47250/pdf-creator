import { randomUUID } from 'node:crypto';
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
    if (!consoleEnabled()) throw new PdfServiceError('caller_forbidden', 404, 'The testing console is disabled.');
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

function consoleEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.PDF_CREATION_CONSOLE_ENABLED === 'true';
}

function requireSameOrigin(request: Request): string {
  const browserOrigin = request.headers.get('origin');
  const internalOrigin = new URL(request.url).origin;
  const host = request.headers.get('x-forwarded-host')?.split(',', 1)[0].trim() || request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto')?.split(',', 1)[0].trim() || new URL(request.url).protocol.slice(0, -1);
  const publicOrigin = host ? `${protocol}://${host}` : internalOrigin;
  if (!browserOrigin || (browserOrigin !== publicOrigin && browserOrigin !== internalOrigin)) {
    throw new PdfServiceError('caller_forbidden', 403, 'The testing console accepts same-origin requests only.');
  }
  return publicOrigin;
}
