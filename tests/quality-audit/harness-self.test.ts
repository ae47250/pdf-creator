import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aggregateMetrics,
  buildExecutionPlan,
  classifyOperationalStop,
  executeAuditPlan,
  formatRate,
  loadAuditManifest,
  sanitizeForEvidence,
  validateAuditResult,
  validatePreviewOrigin
} from '../../scripts/pdf-quality-audit.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryDirectories: string[] = [];

type LoadedManifest = Awaited<ReturnType<typeof loadAuditManifest>>['manifest'];

async function temporaryArtifactDirectory() {
  const parent = path.join(repositoryRoot, 'test-artifacts', 'pdf-quality-audit');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'self-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function manifestWithLocalCases(manifest: LoadedManifest, caseIds: string[]) {
  const copy = structuredClone(manifest);
  copy.profiles['pr-a-local'] = {
    lane: 'local',
    maximumConcurrency: 1,
    maximumGetRequests: 0,
    maximumPostRequests: caseIds.length,
    startSpacingMs: 0,
    groups: [{ caseIds, repetitions: 1 }]
  };
  return copy;
}

async function deliberatelyIncorrectPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([500, 500]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('This deliberately omits all required fixture text.', { x: 24, y: 460, size: 12, font });
  document.setTitle('Incorrect title');
  document.setAuthor('Incorrect author');
  document.setSubject('Incorrect subject');
  document.setKeywords(['incorrect-keyword']);
  return Buffer.from(await document.save());
}

function pdfResponse(body: Uint8Array | Buffer) {
  return {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="audit.pdf"'
    },
    body,
    durationMs: 5,
    requestAttempts: 1
  };
}

function syntheticExecution(overrides: Record<string, unknown> = {}) {
  return {
    executionId: 'execution-1',
    caseId: 'A-BASIC-01',
    canonicalFixtureId: 'A-BASIC-01',
    category: 'supported-basic-pdf',
    expectedClass: 'supported-and-expected-to-pass',
    attempted: true,
    executed: true,
    pdfProduced: true,
    structurallyValid: true,
    correctlyRendered: true,
    intentionalRejection: false,
    unsupported: false,
    unavailable: false,
    failedPdfGeneration: false,
    requestAttempts: 1,
    findings: [],
    ...overrides
  };
}

function metricCategory(metrics: ReturnType<typeof aggregateMetrics>, category: string) {
  return metrics.categories[category];
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('PDF quality audit harness self-tests', () => {
  it('loads the checked manifest and expands the exact PR A execution budgets', async () => {
    const loaded = await loadAuditManifest({ rootDir: repositoryRoot });

    expect(loaded.manifest.schemaVersion).toBe(1);
    expect(loaded.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.sourceFiles).toHaveLength(10);

    const localPlan = buildExecutionPlan(loaded.manifest, 'pr-a-local');
    const previewPlan = buildExecutionPlan(loaded.manifest, 'pr-a-preview');
    const remediationPreviewPlan = buildExecutionPlan(loaded.manifest, 'pr-a-preview-basic-remediation');

    expect(localPlan).toHaveLength(24);
    expect(previewPlan).toHaveLength(7);
    expect(previewPlan.map((execution) => execution.caseId)).toEqual([
      'A-BASIC-01',
      'A-FLOW-01',
      'A-FIXED-01',
      'A-FULL-ACADEMIC-01',
      'A-FULL-ACADEMIC-01',
      'A-FULL-ACADEMIC-01',
      'A-SEC-URL-01'
    ]);
    expect(loaded.manifest.profiles['pr-a-preview-basic-remediation']).toMatchObject({
      lane: 'preview',
      maximumConcurrency: 1,
      maximumGetRequests: 2,
      maximumPostRequests: 4,
      startSpacingMs: 2_000
    });
    expect(remediationPreviewPlan.map((execution) => execution.caseId)).toEqual([
      'A-BASIC-01',
      'A-BASIC-01',
      'A-BASIC-01',
      'A-FLOW-01'
    ]);
  });

  it('records a corrupt PDF as a structural finding and still returns a valid audit result', async () => {
    const loaded = await loadAuditManifest({ rootDir: repositoryRoot });
    const manifest = manifestWithLocalCases(loaded.manifest, ['A-BASIC-01']);
    const artifactDir = await temporaryArtifactDirectory();

    const result = await executeAuditPlan({
      manifest,
      profileName: 'pr-a-local',
      rootDir: repositoryRoot,
      artifactDir,
      transport: async () => pdfResponse(Buffer.from('%PDF-1.7\nthis is deliberately corrupt'))
    });

    expect(result.executions).toHaveLength(1);
    expect(result.executions[0].structurallyValid).toBe(false);
    expect(result.executions[0].correctlyRendered).toBe(false);
    expect(result.executions[0].findings.map((finding) => finding.code).join(' ')).toMatch(/pdf|structur/i);

    expect(validateAuditResult(result, loaded.schema)).toEqual({ valid: true, errors: [] });
  });

  it('reports wrong geometry, text, and metadata as findings instead of throwing', async () => {
    const loaded = await loadAuditManifest({ rootDir: repositoryRoot });
    const manifest = manifestWithLocalCases(loaded.manifest, ['A-BASIC-01']);
    const artifactDir = await temporaryArtifactDirectory();
    const body = await deliberatelyIncorrectPdf();

    const result = await executeAuditPlan({
      manifest,
      profileName: 'pr-a-local',
      rootDir: repositoryRoot,
      artifactDir,
      transport: async () => pdfResponse(body)
    });

    const execution = result.executions[0];
    const findingCodes = execution.findings.map((finding) => finding.code).join(' ');
    expect(execution.structurallyValid).toBe(true);
    expect(execution.correctlyRendered).toBe(false);
    expect(findingCodes).toMatch(/dimension|geometry/i);
    expect(findingCodes).toMatch(/text/i);
    expect(findingCodes).toMatch(/metadata/i);
  });

  it('does not let one failed fixture suppress the next authorized fixture', async () => {
    const loaded = await loadAuditManifest({ rootDir: repositoryRoot });
    const manifest = manifestWithLocalCases(loaded.manifest, ['A-BASIC-01', 'A-FLOW-01']);
    const artifactDir = await temporaryArtifactDirectory();
    const body = await deliberatelyIncorrectPdf();
    const attemptedCaseIds: string[] = [];

    const result = await executeAuditPlan({
      manifest,
      profileName: 'pr-a-local',
      rootDir: repositoryRoot,
      artifactDir,
      transport: async ({ execution }) => {
        attemptedCaseIds.push(execution.caseId);
        if (execution.caseId === 'A-BASIC-01') {
          throw new Error('simulated isolated request failure');
        }
        return pdfResponse(body);
      }
    });

    expect(attemptedCaseIds).toEqual(['A-BASIC-01', 'A-FLOW-01']);
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0].correctlyRendered).toBe(false);
    expect(result.executions[1].attempted).toBe(true);
  });

  it('records a pre-request safety cap as unavailable without consuming a request', async () => {
    const loaded = await loadAuditManifest({ rootDir: repositoryRoot });
    const manifest = manifestWithLocalCases(loaded.manifest, ['A-BASIC-01', 'A-FLOW-01']);
    const artifactDir = await temporaryArtifactDirectory();
    const body = await deliberatelyIncorrectPdf();

    const result = await executeAuditPlan({
      manifest,
      profileName: 'pr-a-local',
      rootDir: repositoryRoot,
      artifactDir,
      transport: async ({ execution }) => {
        if (execution.caseId === 'A-BASIC-01') {
          throw Object.assign(new Error('simulated pre-request input safety cap'), {
            auditStopReason: 'request-budget-limit',
            requestAttempts: 0,
            requestInitiated: false
          });
        }
        return pdfResponse(body);
      }
    });

    expect(result.executions).toHaveLength(2);
    expect(result.executions[0]).toMatchObject({
      executed: false,
      requestAttempts: 0,
      unavailable: true,
      failedPdfGeneration: false
    });
    expect(result.executions[0].findings[0]).toMatchObject({
      code: 'fixture-unavailable-operational-boundary',
      cause: 'request-budget-limit',
      affectsCorrectness: false
    });
    expect(result.executions[1].attempted).toBe(true);
    expect(result.metrics.totalRequestAttempts).toBe(1);
  });

  it('records unexpected acceptance of a policy fixture as a failed expectation', async () => {
    const loaded = await loadAuditManifest({ rootDir: repositoryRoot });
    const manifest = manifestWithLocalCases(loaded.manifest, ['A-SEC-SCRIPT-01']);
    const artifactDir = await temporaryArtifactDirectory();
    const body = await deliberatelyIncorrectPdf();

    const result = await executeAuditPlan({
      manifest,
      profileName: 'pr-a-local',
      rootDir: repositoryRoot,
      artifactDir,
      transport: async () => pdfResponse(body)
    });

    const policy = result.metrics.categories['intentional-policy-rejection'];
    expect(policy.uniqueFixturesExecuted).toBe(1);
    expect(policy.intentionallyRejectedFixtures).toBe(0);
    expect(policy.uniqueFixturesMeetingAllRequiredExpectations).toBe(0);
    expect(policy.uniqueFixturesFailingOneOrMoreRequiredExpectations).toBe(1);
    expect(policy.affectedFixtures[0]).toMatchObject({
      fixtureId: 'A-SEC-SCRIPT-01',
      resultLabels: expect.arrayContaining(['failed-required-expectation'])
    });
  });

  it('keeps known service defects in the denominator and out of the correct-rendering numerator', () => {
    const executions = [
      syntheticExecution({
        executionId: 'known-defect',
        caseId: 'KNOWN-DEFECT-01',
        canonicalFixtureId: 'KNOWN-DEFECT-01',
        expectedClass: 'known-service-defect',
        correctlyRendered: false,
        findings: [{ code: 'known-service-defect-detected', severity: 'high' }]
      }),
      syntheticExecution({ executionId: 'supported-pass', caseId: 'SUPPORTED-01', canonicalFixtureId: 'SUPPORTED-01' })
    ];
    const metrics = aggregateMetrics(executions, {
      cases: [
        { id: 'KNOWN-DEFECT-01', category: 'supported-basic-pdf', expectedClass: 'known-service-defect' },
        { id: 'SUPPORTED-01', category: 'supported-basic-pdf', expectedClass: 'supported-and-expected-to-pass' }
      ]
    } as LoadedManifest);
    const basic = metricCategory(metrics, 'supported-basic-pdf');

    expect(basic.uniqueFixturesExecuted).toBe(2);
    expect(basic.uniqueFixturesMeetingAllRequiredExpectations).toBe(1);
    expect(basic.uniqueFixturesFailingOneOrMoreRequiredExpectations).toBe(1);
    expect(basic.correctRenderingRate).toMatchObject({ numerator: 1, denominator: 2, value: 0.5, percentage: 50 });
  });

  it('counts an observed runtime audit-tool limitation without changing intended classification', () => {
    const executions = [syntheticExecution({
      unavailable: true,
      correctlyRendered: false,
      findings: [{
        code: 'text-evidence-unavailable',
        severity: 'medium',
        cause: 'audit-fixture-or-tool-limitation',
        message: 'synthetic missing text tool',
        affectsCorrectness: false
      }]
    })];
    const metrics = aggregateMetrics(executions, {
      cases: [{
        id: 'A-BASIC-01',
        category: 'supported-basic-pdf',
        expectedClass: 'supported-and-expected-to-pass'
      }]
    } as LoadedManifest);
    const basic = metricCategory(metrics, 'supported-basic-pdf');

    expect(basic.unavailableFixtures).toBe(1);
    expect(basic.auditToolLimitationFixtures).toBe(1);
    expect(basic.environmentalLimitationFixtures).toBe(0);
  });

  it('does not inflate unique fixture metrics with repeat executions', () => {
    const executions = [1, 2, 3].map((repeat) => syntheticExecution({
      executionId: `repeat-${repeat}`,
      caseId: 'A-DET-BASIC-01',
      canonicalFixtureId: 'A-DET-BASIC-01',
      sourceCaseId: 'A-BASIC-01'
    }));
    const metrics = aggregateMetrics(executions, {
      cases: [{ id: 'A-DET-BASIC-01', category: 'supported-basic-pdf', expectedClass: 'supported-and-expected-to-pass' }]
    } as LoadedManifest);
    const basic = metricCategory(metrics, 'supported-basic-pdf');

    expect(metrics.totalExecutions).toBe(3);
    expect(metrics.totalRequestAttempts).toBe(3);
    expect(basic.uniqueFixturesAttempted).toBe(1);
    expect(basic.uniqueFixturesExecuted).toBe(1);
    expect(basic.correctRenderingRate).toMatchObject({ numerator: 1, denominator: 1, value: 1, percentage: 100 });
  });

  it('returns null rather than a misleading percentage when the denominator is zero', () => {
    expect(formatRate(0, 0)).toEqual({ numerator: 0, denominator: 0, value: null, percentage: null });
  });

  it('recognizes only operational stop reasons and rejects quality-derived reasons', () => {
    const permitted = [
      'safety-risk',
      'authorization-boundary',
      'credential-problem',
      'cost-limit',
      'request-budget-limit',
      'platform-protection',
      'external-service-restriction',
      'genuine-technical-impossibility'
    ];
    const nonblocking = [
      'quality-score',
      'low-success-percentage',
      'fixture-failure',
      'http-500',
      'latency-limit',
      'visual-mismatch',
      'structural-invalidity',
      'known-service-defect'
    ];

    expect(permitted.every((reason) => classifyOperationalStop(reason))).toBe(true);
    expect(nonblocking.some((reason) => classifyOperationalStop(reason))).toBe(false);
  });

  it('requires an independently supplied SHA-256 host pin for Preview origins', () => {
    const hostname = 'synthetic-audit-preview.vercel.app';
    const expectedHostSha256 = createHash('sha256').update(hostname).digest('hex');

    expect(validatePreviewOrigin(`https://${hostname}`, expectedHostSha256))
      .toBe(`https://${hostname}`);
    expect(() => validatePreviewOrigin(`https://${hostname}:8443`, expectedHostSha256))
      .toThrow(/credential-free HTTPS origin/i);
    expect(() => validatePreviewOrigin(`https://${hostname}`, '0'.repeat(64)))
      .toThrow(/host pin/i);
    expect(() => validatePreviewOrigin(`https://${hostname}`, 'not-a-hash'))
      .toThrow(/pinned/i);
  });

  it('recursively removes credentials, absolute URLs, and HTML from persisted evidence', () => {
    const sanitized = sanitizeForEvidence({
      safeLabel: 'preview-evidence',
      authorization: 'Bearer top-secret-token',
      apiKey: 'private-api-key',
      targetUrl: 'https://private-preview.example.test/api/v1/pdfs',
      html: '<html><body>private fixture body</body></html>',
      nested: {
        headers: { 'x-vercel-protection-bypass': 'private-bypass-secret' },
        message: 'Request sent to https://private-preview.example.test'
      }
    });
    const serialized = JSON.stringify(sanitized);

    expect(serialized).toContain('preview-evidence');
    expect(serialized).not.toContain('top-secret-token');
    expect(serialized).not.toContain('private-api-key');
    expect(serialized).not.toContain('private-bypass-secret');
    expect(serialized).not.toContain('private-preview.example.test');
    expect(serialized).not.toContain('private fixture body');
    expect(serialized).not.toContain('<html>');
  });
});
