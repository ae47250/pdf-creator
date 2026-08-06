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
    expect(openapi).toContain('Retry-After:');
    expect(openapi).toContain('renderer_busy` uses Retry-After 1');
    expect(openapi).toContain('$ref: ./pdf-creation.schema.json');
    expect(openapi).not.toContain('renderMode');
    expect(openapi).not.toContain('sourceApp');
    for (const status of ['415', '422', '502', '503', '504']) {
      expect(openapi).toContain(`"${status}": { $ref: "#/components/responses/Error" }`);
    }
  });
});
