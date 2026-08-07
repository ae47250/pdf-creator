import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/v1/pdfs/route';
import {
  buildExecutionPlan,
  collectToolPreflight,
  executeAuditPlan,
  loadAuditManifest
} from '../../scripts/pdf-quality-audit.mjs';

const TEST_BEARER_KEY = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const originalTestKey = process.env.PDF_CREATION_TEST;
const rootDir = process.cwd();
const artifactDir = join(
  rootDir,
  'test-artifacts',
  'pdf-quality-audit',
  `pr-a-local-vitest-${process.pid}-${Date.now()}`
);

interface LocalTransportInput {
  execution: unknown;
  payload: Record<string, unknown>;
}

interface Rate {
  numerator: number;
  denominator: number;
  value: number | null;
}

async function localTransport({ payload }: LocalTransportInput) {
  const started = performance.now();
  const response = await POST(new Request('http://127.0.0.1:3202/api/v1/pdfs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TEST_BEARER_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  }));
  const body = new Uint8Array(await response.arrayBuffer());

  // The harness receives bytes for both PDFs and controlled JSON errors. It
  // decides how to inspect them from the response status and content type.
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    durationMs: Math.round(performance.now() - started),
    requestAttempts: 1
  };
}

function assertRate(rate: Rate, numerator: number, denominator: number) {
  expect(rate.numerator).toBe(numerator);
  expect(rate.denominator).toBe(denominator);
  if (denominator === 0) {
    expect(rate.value).toBeNull();
  } else {
    expect(rate.value).toBeCloseTo(numerator / denominator, 12);
  }
}

describe.sequential('PR A local quality-audit path', () => {
  beforeAll(() => {
    process.env.PDF_CREATION_TEST = TEST_BEARER_KEY;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (originalTestKey === undefined) delete process.env.PDF_CREATION_TEST;
    else process.env.PDF_CREATION_TEST = originalTestKey;
  });

  it('executes every planned request and records internally consistent evidence', async () => {
    expect(relative(rootDir, artifactDir).replaceAll('\\', '/')).toMatch(
      /^test-artifacts\/pdf-quality-audit\//
    );

    const loaded = await loadAuditManifest({ rootDir });
    const { manifest } = loaded;
    const plan = buildExecutionPlan(manifest, 'pr-a-local');
    expect(plan).toHaveLength(24);

    const result = await executeAuditPlan({
      manifest,
      profileName: 'pr-a-local',
      transport: localTransport,
      rootDir,
      artifactDir,
      preflight: {
        ...(await collectToolPreflight({ rootDir })),
        manifestSha256: loaded.manifestSha256,
        schemaSha256: loaded.schemaSha256,
        immutableSourceFiles: loaded.sourceFiles
      }
    });

    // Low quality, controlled rejection, unsupported behavior, and unavailable
    // optional evidence are recorded outcomes; none may truncate this plan.
    expect(result.completionStatus).toMatch(/^complete(?:_with_unavailable_evidence)?$/);
    expect(result.executions).toHaveLength(plan.length);
    expect(result.executions.map((item: { executionId: string }) => item.executionId))
      .toEqual(plan.map((item: { executionId: string }) => item.executionId));
    expect(result.requestCounts).toEqual({ get: 0, post: 24, total: 24 });
    expect(result.releaseAssessment).toBe('not-performed');

    expect(result.metrics.totalExecutions).toBe(24);
    expect(result.metrics.totalRequestAttempts).toBe(24);
    expect(result.metrics.categories['supported-basic-pdf']).toEqual(result.metrics.supportedBasic);
    expect(result.metrics.supportedBasic.uniqueFixturesAttempted).toBe(10);
    const categoryRows = Object.values(result.metrics.categories) as Array<{
      uniqueFixturesAttempted: number;
    }>;
    expect(
      categoryRows.reduce(
        (sum, row) => sum + row.uniqueFixturesAttempted,
        0
      )
    ).toBe(17);

    const basic = result.metrics.supportedBasic;
    expect(basic.uniqueFixturesExecuted).toBe(10);
    expect(basic.pdfsProduced).toBeLessThanOrEqual(basic.uniqueFixturesExecuted);
    expect(basic.structurallyValidPdfs).toBeLessThanOrEqual(basic.pdfsProduced);
    expect(basic.correctlyRenderedPdfs).toBeLessThanOrEqual(basic.structurallyValidPdfs);
    expect(
      basic.correctlyRenderedPdfs + basic.incorrectlyRenderedPdfs
    ).toBeLessThanOrEqual(basic.uniqueFixturesExecuted);
    expect(basic.failedPdfGenerations).toBeLessThanOrEqual(basic.uniqueFixturesExecuted);
    expect(basic.unavailableFixtures).toBeLessThanOrEqual(basic.uniqueFixturesAttempted);
    assertRate(basic.productionRate, basic.pdfsProduced, basic.uniqueFixturesExecuted);
    assertRate(
      basic.structuralValidityRate,
      basic.structurallyValidPdfs,
      basic.uniqueFixturesExecuted
    );
    assertRate(
      basic.correctRenderingRate,
      basic.correctlyRenderedPdfs,
      basic.uniqueFixturesExecuted
    );

    const schema = JSON.parse(
      await readFile(join(rootDir, 'tests', 'quality-audit', 'schema.v1.json'), 'utf8')
    );
    const validateResult = new Ajv2020({ allErrors: true, strict: true })
      .compile(schema.$defs.result);
    const serializedResult = JSON.parse(JSON.stringify(result));
    expect(validateResult(serializedResult), JSON.stringify(validateResult.errors)).toBe(true);

    const checkpoint = JSON.parse(await readFile(join(artifactDir, 'checkpoint.json'), 'utf8'));
    const summary = JSON.parse(await readFile(join(artifactDir, 'summary.json'), 'utf8'));
    expect(checkpoint.runId).toBe(result.runId);
    expect(checkpoint.executions).toHaveLength(24);
    expect(summary.runId).toBe(result.runId);
    expect(summary.executions).toHaveLength(24);
    expect(summary.metrics).toEqual(serializedResult.metrics);
  }, 900_000);
});
