import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { POST } from '@/app/api/v1/pdfs/route';
import { TEST_BEARER_KEY } from '../regression/fixtures';

it('captures the supplied page-settings fixtures through the real service', async () => {
  const previous = process.env.PDF_CREATION_TEST;
  process.env.PDF_CREATION_TEST = TEST_BEARER_KEY;
  const output = join(process.cwd(), 'test-artifacts/html-page-settings/current');
  await mkdir(output, { recursive: true });
  try {
    for (const name of ['generic_flowing_fixture', 'test1_annual_financial_report', 'test2_program_outcomes_review', 'test3_rendering_torture_test']) {
      const html = await readFile(join(process.cwd(), 'tests/fixtures/html-page-settings', `${name}.html`), 'utf8');
      const response = await POST(new Request('http://localhost/api/v1/pdfs', {
        method: 'POST',
        headers: { authorization: `Bearer ${TEST_BEARER_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ html, filename: `${name}.pdf`, storeResult: false, storeHtml: false,
          page: { format: 'Letter', orientation: 'portrait', marginsInches: { top: 0, right: 0, bottom: 0, left: 0 } } })
      }));
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(response.status, `${name}: ${response.status === 200 ? 'PDF' : bytes.toString()}`).toBe(200);
      await writeFile(join(output, `${name}.pdf`), bytes);
      await writeFile(join(output, `${name}.headers.json`), JSON.stringify(Object.fromEntries(response.headers), null, 2));
    }
  } finally {
    if (previous === undefined) delete process.env.PDF_CREATION_TEST;
    else process.env.PDF_CREATION_TEST = previous;
  }
}, 180_000);
