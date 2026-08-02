import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PdfServiceError } from '@/lib/pdf/errors';

export const CONSOLE_SESSION_COOKIE = '__Host-pdf-creation-console';
export const CONSOLE_SESSION_MAX_AGE_SECONDS = 2 * 60;

type Environment = Record<string, string | undefined>;

export function isConsoleEnabled(environment: Environment = process.env): boolean {
  if (environment.NODE_ENV !== 'production') return true;
  return environment.PDF_CREATION_CONSOLE_ENABLED === 'true' && Boolean(environment.PDF_CREATION_CONSOLE_PASSWORD);
}

export function hasConsoleAccess(cookieValue: string | undefined, environment: Environment = process.env): boolean {
  if (environment.NODE_ENV !== 'production') return true;
  const password = environment.PDF_CREATION_CONSOLE_PASSWORD;
  if (!password || !cookieValue) return false;

  const [expiresAtText, signature, ...extra] = cookieValue.split('.');
  if (extra.length || !/^\d+$/.test(expiresAtText || '') || !/^[A-Za-z0-9_-]+$/.test(signature || '')) return false;
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;

  return safeEqual(signature, sessionSignature(expiresAtText, password));
}

export function createConsoleSession(environment: Environment = process.env, now = Date.now()): string {
  const password = environment.PDF_CREATION_CONSOLE_PASSWORD;
  if (!password) throw new PdfServiceError('service_unavailable', 503, 'The testing console is not configured.');
  const expiresAtText = String(now + CONSOLE_SESSION_MAX_AGE_SECONDS * 1000);
  return `${expiresAtText}.${sessionSignature(expiresAtText, password)}`;
}

export function passwordMatches(supplied: string, environment: Environment = process.env): boolean {
  const configured = environment.PDF_CREATION_CONSOLE_PASSWORD;
  if (!configured) return false;
  return safeEqual(digest(supplied), digest(configured));
}

export function requireSameOrigin(request: Request): string {
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

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function sessionSignature(expiresAtText: string, password: string): string {
  return createHmac('sha256', password).update(`pdf-creation-console:${expiresAtText}`, 'utf8').digest('base64url');
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}
