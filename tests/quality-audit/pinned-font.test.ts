import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fontPath = path.join(rootDir, 'tests', 'quality-audit', 'fonts', 'open-sans-v44', 'OpenSans-latin-wght-v44.woff2');
const licensePath = path.join(rootDir, 'tests', 'quality-audit', 'fonts', 'open-sans-v44', 'OFL.txt');
const fixturePath = path.join(rootDir, 'tests', 'fixtures', 'one-page.html');
const fontHash = 'd8e4fe0452aa2076429a9bb5d8757d00a994dd95986cf950e9a1a371b9a072a0';

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('A-BASIC-01 pinned font', () => {
  it('embeds the reviewed Open Sans v44 Latin bytes without a runtime font URL', async () => {
    const [font, fixture, license] = await Promise.all([
      readFile(fontPath),
      readFile(fixturePath, 'utf8'),
      readFile(licensePath, 'utf8')
    ]);
    const encoded = fixture.match(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/)?.[1];

    expect(font.byteLength).toBe(48_320);
    expect(sha256(font)).toBe(fontHash);
    expect(font.subarray(0, 4).toString('ascii')).toBe('wOF2');
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(fixture).toContain('font-family: "PDF Audit Open Sans"');
    expect(fixture).toContain('font-weight: 400 700');
    expect(encoded).toBeTruthy();
    expect(sha256(Buffer.from(encoded!, 'base64'))).toBe(fontHash);
    expect(fixture).not.toMatch(/https?:\/\/|fonts\.googleapis\.com|fonts\.gstatic\.com/i);
  });
});
