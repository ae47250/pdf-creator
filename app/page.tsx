import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cookies } from 'next/headers';
import Image from 'next/image';
import ConsoleForm from './console-form';
import { CONSOLE_SESSION_COOKIE, hasConsoleAccess, isConsoleEnabled } from '@/lib/console-auth';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ consoleLogin?: string }> }) {
  const enabled = isConsoleEnabled();
  const cookieStore = await cookies();
  const signedIn = hasConsoleAccess(cookieStore.get(CONSOLE_SESSION_COOKIE)?.value);
  const loginFailed = (await searchParams).consoleLogin === 'failed';
  const appABaseline = enabled && signedIn
    ? readFileSync(join(process.cwd(), 'tests', 'fixtures', 'app-a-baseline.html'), 'utf8')
    : '';
  return (
    <main className="page-shell">
      <header className="intro">
        <Image className="urveska-logo" src="/urveska-logo.png" alt="Urveska" width={934} height={147} priority />
        <p className="eyebrow">Internal service</p>
        <h1>PDF Creation Service</h1>
        <p>This shared backend receives completed, self-contained HTML from Urveska applications and converts it into a validated PDF, with optional Cloudflare view and download links. Each application owns its own report layout, CSS, fonts, logos, images, and content. The controls and generated links below are for testing only; production applications use this service automatically in the background.</p>
        <p className="notice">This is an internal testing console, not a general public file converter. It does not convert Word, Excel, PowerPoint, images, arbitrary URLs, or arbitrary files. Use only fictional or non-sensitive data. Anyone with an open generated report URL can access it during this phase.</p>
      </header>
      {!enabled && <section className="panel"><h2>Console disabled</h2><p>The production testing console is disabled. The authenticated API and report routes remain available.</p></section>}
      {enabled && !signedIn && <section className="panel login-panel"><h2>Console sign in</h2><p>Enter the shared console password to open the internal testing controls.</p>{loginFailed && <p className="login-error" role="alert">Password not recognized.</p>}<form action="/api/console/session" method="post"><label htmlFor="console-password">Password<input id="console-password" name="password" type="password" autoComplete="current-password" required /></label><button type="submit">Open test console</button></form></section>}
      {enabled && signedIn && <ConsoleForm appABaseline={appABaseline} />}
    </main>
  );
}
