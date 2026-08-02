import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ConsoleForm from './console-form';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const enabled = process.env.NODE_ENV !== 'production' || process.env.PDF_CREATION_CONSOLE_ENABLED === 'true';
  const appABaseline = enabled
    ? readFileSync(join(process.cwd(), 'tests', 'fixtures', 'app-a-baseline.html'), 'utf8')
    : '';
  return (
    <main className="page-shell">
      <header className="intro">
        <p className="eyebrow">Internal service</p>
        <h1>PDF Creation Service</h1>
        <p>This shared backend receives completed, self-contained HTML from Urveska applications and converts it into a validated PDF, with optional Cloudflare view and download links. Each application owns its own report layout, CSS, fonts, logos, images, and content. The controls and generated links below are for testing only; production applications use this service automatically in the background.</p>
        <p className="notice">This is an internal testing console, not a general public file converter. It does not convert Word, Excel, PowerPoint, images, arbitrary URLs, or arbitrary files. Use only fictional or non-sensitive data. Anyone with an open generated report URL can access it during this phase.</p>
      </header>
      {enabled ? <ConsoleForm appABaseline={appABaseline} /> : <section className="panel"><h2>Console disabled</h2><p>The production testing console is disabled. The authenticated API and report routes remain available.</p></section>}
    </main>
  );
}
