import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONSOLE_SESSION_COOKIE,
  CONSOLE_SESSION_MAX_AGE_SECONDS,
  createConsoleSession,
  hasConsoleAccess,
  isConsoleEnabled,
  passwordMatches,
  readCookie
} from '@/lib/console-auth';
import { POST as createConsoleSessionRoute } from '@/app/api/console/session/route';
import { POST as createConsolePdf } from '@/app/api/console/pdfs/route';

const productionEnvironment = {
  NODE_ENV: 'production',
  PDF_CREATION_CONSOLE_ENABLED: 'true',
  PDF_CREATION_CONSOLE_PASSWORD: 'correct-console-password'
};

const originalNodeEnv = process.env.NODE_ENV;
const originalConsoleEnabled = process.env.PDF_CREATION_CONSOLE_ENABLED;
const originalConsolePassword = process.env.PDF_CREATION_CONSOLE_PASSWORD;

afterEach(() => {
  vi.unstubAllEnvs();
  restoreEnvironment('NODE_ENV', originalNodeEnv);
  restoreEnvironment('PDF_CREATION_CONSOLE_ENABLED', originalConsoleEnabled);
  restoreEnvironment('PDF_CREATION_CONSOLE_PASSWORD', originalConsolePassword);
});

describe('console authentication', () => {
  it('requires both production console variables', () => {
    expect(isConsoleEnabled({ NODE_ENV: 'production', PDF_CREATION_CONSOLE_ENABLED: 'true' })).toBe(false);
    expect(isConsoleEnabled({ NODE_ENV: 'production', PDF_CREATION_CONSOLE_PASSWORD: 'password' })).toBe(false);
    expect(isConsoleEnabled(productionEnvironment)).toBe(true);
  });

  it('accepts only the configured password and signs an eight-hour session', () => {
    const now = Date.now();
    const session = createConsoleSession(productionEnvironment, now);
    expect(passwordMatches('correct-console-password', productionEnvironment)).toBe(true);
    expect(passwordMatches('wrong-password', productionEnvironment)).toBe(false);
    expect(hasConsoleAccess(session, productionEnvironment)).toBe(true);
    expect(Number(session.split('.')[0]) - now).toBe(CONSOLE_SESSION_MAX_AGE_SECONDS * 1000);
  });

  it('accepts an unexpired signed session and rejects missing, altered, and expired values', () => {
    const now = Date.now();
    const session = createConsoleSession(productionEnvironment, now);
    expect(hasConsoleAccess(session, productionEnvironment)).toBe(true);
    expect(hasConsoleAccess(undefined, productionEnvironment)).toBe(false);
    expect(hasConsoleAccess(`${session}x`, productionEnvironment)).toBe(false);
    expect(hasConsoleAccess(createConsoleSession(productionEnvironment, now - CONSOLE_SESSION_MAX_AGE_SECONDS * 1000 - 1), productionEnvironment)).toBe(false);
  });

  it('reads only the requested cookie', () => {
    expect(readCookie(`other=value; ${CONSOLE_SESSION_COOKIE}=session-value`, CONSOLE_SESSION_COOKIE)).toBe('session-value');
  });
});

describe('console routes in production', () => {
  it('does not set a session for an incorrect password', async () => {
    configureProductionConsole();
    const form = new FormData();
    form.set('password', 'wrong-password');
    const response = await createConsoleSessionRoute(new Request('https://service.example/api/console/session', {
      method: 'POST', headers: { origin: 'https://service.example' }, body: form
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://service.example/?consoleLogin=failed');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('sets a secure session only for the correct password', async () => {
    configureProductionConsole();
    const form = new FormData();
    form.set('password', 'correct-console-password');
    const response = await createConsoleSessionRoute(new Request('https://service.example/api/console/session', {
      method: 'POST', headers: { origin: 'https://service.example' }, body: form
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain(`${CONSOLE_SESSION_COOKIE}=`);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  it('rejects the console PDF route before it can use the test caller without a session', async () => {
    configureProductionConsole();
    const response = await createConsolePdf(new Request('https://service.example/api/console/pdfs', {
      method: 'POST', headers: { origin: 'https://service.example', 'content-type': 'application/json' }, body: '{}'
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'caller_forbidden' } });
  });
});

function configureProductionConsole(): void {
  vi.stubEnv('NODE_ENV', 'production');
  process.env.PDF_CREATION_CONSOLE_ENABLED = 'true';
  process.env.PDF_CREATION_CONSOLE_PASSWORD = 'correct-console-password';
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (name === 'NODE_ENV') return;
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
