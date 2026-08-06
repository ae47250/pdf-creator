export type ErrorCode =
  | 'unauthorized'
  | 'caller_forbidden'
  | 'json_required'
  | 'invalid_json'
  | 'request_too_large'
  | 'invalid_request'
  | 'unsafe_html'
  | 'asset_not_ready'
  | 'render_timeout'
  | 'fixed_page_overflow'
  | 'pdf_invalid'
  | 'pdf_too_large'
  | 'expected_page_count_mismatch'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'renderer_busy'
  | 'storage_failed'
  | 'service_unavailable';

export class PdfServiceError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details: unknown[] = []
  ) {
    super(message);
    this.name = 'PdfServiceError';
  }
}

export function asServiceError(error: unknown): PdfServiceError {
  if (error instanceof PdfServiceError) return error;
  return new PdfServiceError(
    'service_unavailable',
    503,
    'The PDF service is temporarily unavailable.'
  );
}

export function errorResponse(
  error: unknown,
  requestId: string,
  correlationId?: string
): Response {
  const controlled = asServiceError(error);
  const retryAfter = controlled.code === 'renderer_busy'
    ? '1'
    : controlled.code === 'rate_limited'
      ? '60'
      : undefined;
  return Response.json(
    {
      error: {
        code: controlled.code,
        message: controlled.message,
        requestId,
        ...(correlationId ? { correlationId } : {}),
        details: controlled.details
      }
    },
    {
      status: controlled.status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
        ...(retryAfter ? { 'Retry-After': retryAfter } : {})
      }
    }
  );
}
