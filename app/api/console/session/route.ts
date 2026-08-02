import { randomUUID } from 'node:crypto';
import {
  CONSOLE_SESSION_COOKIE,
  CONSOLE_SESSION_MAX_AGE_SECONDS,
  createConsoleSession,
  isConsoleEnabled,
  passwordMatches,
  requireSameOrigin
} from '@/lib/console-auth';
import { errorResponse, PdfServiceError } from '@/lib/pdf/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    if (!isConsoleEnabled()) throw new PdfServiceError('caller_forbidden', 404, 'The testing console is disabled.');
    requireSameOrigin(request);
    const form = await request.formData();
    const password = form.get('password');
    if (typeof password !== 'string' || !passwordMatches(password)) return redirectToLoginFailure(request);

    const response = new Response(null, { status: 303, headers: { Location: new URL('/', request.url).toString() } });
    response.headers.append(
      'Set-Cookie',
      `${CONSOLE_SESSION_COOKIE}=${createConsoleSession()}; Path=/; Max-Age=${CONSOLE_SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`
    );
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

function redirectToLoginFailure(request: Request): Response {
  return Response.redirect(new URL('/?consoleLogin=failed', request.url), 303);
}
