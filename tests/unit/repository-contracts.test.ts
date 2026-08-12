import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import packageJson from '@/package.json';

describe('repository contracts', () => {
  it('pins every declared dependency exactly', () => {
    for (const version of Object.values({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
      expect(version).not.toMatch(/^[~^]|latest/);
    }
  });

  it('keeps OpenAPI connected to the authoritative JSON Schema', async () => {
    const openapi = await readFile(new URL('../../contracts/openapi.yaml', import.meta.url), 'utf8');
    expect(openapi).toContain('openapi: 3.1.2');
    expect(openapi).toContain('/api/v1/pdfs:');
    expect(openapi).toContain('/reports/{reportId}:');
    expect(openapi).toContain('/reports/{reportId}/download:');
    expect(openapi).toContain('Retry-After:');
    expect(openapi).toContain('renderer_busy` uses Retry-After 1');
    expect(openapi).toContain('requests require a caller-generated idempotencyKey');
    expect(openapi).toContain('different semantic request');
    expect(openapi).toContain('natural-flow callers normally omit it');
    expect(openapi).toContain('$ref: ./pdf-creation.schema.json');
    expect(openapi).not.toContain('renderMode');
    expect(openapi).not.toContain('sourceApp');
    for (const status of ['415', '422', '503', '504']) {
      expect(openapi).toContain(`"${status}": { $ref: "#/components/responses/Error" }`);
    }
  });

  it('keeps the shared caller contract application-neutral and explicit', async () => {
    const contract = await readFile(new URL('../../docs/CALLER_CONTRACT.md', import.meta.url), 'utf8');
    expect(contract).toContain('Mixed page orientation is unsupported');
    expect(contract).toContain('must embed and pin');
    expect(contract).toContain('must not contain HTML, credentials, personal information');
    expect(contract).toContain('Application-specific CSS stays in the caller');
    expect(contract).toContain('No caller is activated by this contract');
    expect(contract).toContain('optional exact assertion, not a pagination instruction');
    expect(contract).toContain('Ordinary natural-flow documents should normally omit it');
    expect(contract).toContain('fixed-page marker/count validation is unchanged');
  });
});
