import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile
} from 'node:fs/promises';
import { platform, release } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  extractPdfTextByPage,
  inspectPdfWithPoppler,
  probeExecutable,
  renderPdfPages,
  runTimestamp,
  validatePdfBuffer,
  writeJson
} from './pdf-test-utils.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_MANIFEST = path.join('tests', 'quality-audit', 'manifest.v1.json');
const DEFAULT_SCHEMA = path.join('tests', 'quality-audit', 'schema.v1.json');
const DEFAULT_REFERENCE_LEDGER = path.join('tests', 'quality-audit', 'references', 'review.v1.json');
const PROVISIONAL_DIMENSION_TOLERANCE_POINTS = 1;
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const OPERATIONAL_STOP_REASONS = new Set([
  'safety-risk',
  'authorization-boundary',
  'credential-problem',
  'cost-limit',
  'request-budget-limit',
  'platform-protection',
  'external-service-restriction',
  'genuine-technical-impossibility'
]);
const CATEGORY_ORDER = [
  'supported-basic-pdf',
  'intentional-policy-rejection',
  'unsupported-capability',
  'isolation',
  'repeatability'
];

export async function loadAuditManifest(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const manifestPath = path.resolve(rootDir, options.manifestPath ?? DEFAULT_MANIFEST);
  const schemaPath = path.resolve(rootDir, options.schemaPath ?? DEFAULT_SCHEMA);
  ensureInsideRoot(rootDir, manifestPath, 'manifest');
  ensureInsideRoot(rootDir, schemaPath, 'schema');

  const [manifestText, schemaText] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(schemaPath, 'utf8')
  ]);
  const manifest = JSON.parse(manifestText);
  const schema = JSON.parse(schemaText);
  const validate = createAjv().compile(schema);
  if (!validate(manifest)) {
    throw new Error(`Audit manifest schema validation failed: ${formatAjvErrors(validate.errors)}`);
  }

  validateManifestSemantics(manifest);
  const uniqueSources = new Map();
  for (const auditCase of manifest.cases) {
    if (!auditCase.source) continue;
    const relativePath = normalizeRepositoryPath(auditCase.source.path);
    const absolutePath = path.resolve(rootDir, relativePath);
    ensureInsideRoot(rootDir, absolutePath, `fixture ${auditCase.id}`);
    const bytes = await readFile(absolutePath);
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== auditCase.source.sha256) {
      throw new Error(
        `Fixture ${auditCase.id} is immutable: ${relativePath} has SHA-256 ${actualSha256}, expected ${auditCase.source.sha256}.`
      );
    }
    const prior = uniqueSources.get(relativePath);
    if (prior && prior.sha256 !== actualSha256) {
      throw new Error(`Fixture ${relativePath} has conflicting expected SHA-256 values.`);
    }
    uniqueSources.set(relativePath, {
      path: relativePath,
      sha256: actualSha256,
      bytes: bytes.byteLength
    });
  }

  return {
    manifest,
    schema,
    manifestPath,
    schemaPath,
    manifestSha256: sha256(manifestText),
    schemaSha256: sha256(schemaText),
    sourceFiles: [...uniqueSources.values()].sort((left, right) => left.path.localeCompare(right.path))
  };
}

export function buildExecutionPlan(manifest, profileName) {
  const profile = manifest?.profiles?.[profileName];
  if (!profile) throw new Error(`Unknown audit profile: ${profileName}`);
  const caseById = new Map(manifest.cases.map((auditCase) => [auditCase.id, auditCase]));
  const executions = [];

  for (const group of profile.groups) {
    for (let profileRepetition = 1; profileRepetition <= group.repetitions; profileRepetition += 1) {
      for (const caseId of group.caseIds) {
        const auditCase = caseById.get(caseId);
        if (!auditCase) throw new Error(`Profile ${profileName} references unknown case ${caseId}.`);
        if (profile.lane === 'preview' && !auditCase.previewEligible) {
          throw new Error(`Preview profile includes non-preview case ${caseId}.`);
        }

        if (!auditCase.scenario) {
          executions.push(planItem({
            profileName,
            profile,
            auditCase,
            sourceCaseId: caseId,
            profileRepetition,
            scenarioIndex: null,
            scenarioType: null,
            ordinal: executions.length + 1
          }));
          continue;
        }

        const sourceSequence = auditCase.scenario.type === 'repeat'
          ? Array.from(
              { length: auditCase.scenario.repetitions },
              () => auditCase.scenario.sourceCaseId
            )
          : auditCase.scenario.sequence;
        for (let scenarioIndex = 0; scenarioIndex < sourceSequence.length; scenarioIndex += 1) {
          const sourceCaseId = sourceSequence[scenarioIndex];
          if (!caseById.has(sourceCaseId)) {
            throw new Error(`Scenario ${caseId} references unknown source case ${sourceCaseId}.`);
          }
          executions.push(planItem({
            profileName,
            profile,
            auditCase,
            sourceCaseId,
            profileRepetition,
            scenarioIndex: scenarioIndex + 1,
            scenarioType: auditCase.scenario.type,
            ordinal: executions.length + 1
          }));
        }
      }
    }
  }

  if (executions.length > profile.maximumPostRequests) {
    throw new Error(
      `Profile ${profileName} expands to ${executions.length} POST requests, exceeding its ${profile.maximumPostRequests}-request budget.`
    );
  }
  return executions;
}

export async function executeAuditPlan(options) {
  const {
    manifest,
    profileName,
    transport,
    preflight = null
  } = options;
  if (typeof transport !== 'function') throw new TypeError('executeAuditPlan requires a transport function.');
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const runId = options.runId ?? `${profileName}-${runTimestamp()}`;
  const artifactDir = path.resolve(
    options.artifactDir
      ?? path.join(rootDir, 'test-artifacts', 'pdf-quality-audit', runId)
  );
  const allowedArtifactRoot = path.resolve(rootDir, 'test-artifacts', 'pdf-quality-audit');
  ensureInsideRoot(allowedArtifactRoot, artifactDir, 'audit artifact directory', true);
  await mkdir(artifactDir, { recursive: true });

  const plan = buildExecutionPlan(manifest, profileName);
  const profile = manifest.profiles[profileName];
  const executions = [];
  let requestAttempts = 0;

  for (const execution of plan) {
    if (profile.startSpacingMs > 0 && executions.length > 0) {
      await delay(profile.startSpacingMs);
    }
    const result = await executeOne({
      manifest,
      execution,
      transport,
      rootDir,
      artifactDir
    });
    executions.push(result);
    requestAttempts += result.requestAttempts;
    const checkpoint = buildAuditResult({
      manifest,
      profileName,
      runId,
      artifactDir,
      executions,
      preflight,
      requestAttempts,
      startedAt: options.startedAt,
      isCheckpoint: true
    });
    await writeJson(path.join(artifactDir, 'checkpoint.json'), sanitizeForEvidence(checkpoint));
  }

  applyScenarioEvidence(executions, manifest);
  const result = buildAuditResult({
    manifest,
    profileName,
    runId,
    artifactDir,
    executions,
    preflight,
    requestAttempts,
    startedAt: options.startedAt,
    isCheckpoint: false
  });
  await writeJson(path.join(artifactDir, 'checkpoint.json'), sanitizeForEvidence(result));
  await writeJson(path.join(artifactDir, 'summary.json'), sanitizeForEvidence(result));
  return result;
}

export function aggregateMetrics(executions, manifest) {
  const caseById = new Map((manifest?.cases ?? []).map((auditCase) => [auditCase.id, auditCase]));
  const fixtureGroups = new Map();
  for (const execution of executions) {
    const fixtureId = execution.canonicalFixtureId ?? execution.caseId;
    if (!fixtureGroups.has(fixtureId)) fixtureGroups.set(fixtureId, []);
    fixtureGroups.get(fixtureId).push(execution);
  }

  const fixtureResults = [];
  for (const [fixtureId, runs] of fixtureGroups) {
    const definition = caseById.get(fixtureId) ?? {};
    const expectedClass = definition.expectedClass ?? runs[0]?.expectedClass;
    const category = definition.category ?? runs[0]?.category ?? 'unclassified';
    const attempted = runs.some((run) => run.attempted);
    const executed = runs.some((run) => run.executed);
    const unavailable = runs.some((run) => run.unavailable);
    const pdfEligible = [
      'supported-basic-pdf',
      'isolation',
      'repeatability'
    ].includes(category);
    const allExecutedRuns = runs.filter((run) => run.executed);
    const pdfProduced = allExecutedRuns.length > 0
      && allExecutedRuns.every((run) => run.pdfProduced);
    const structurallyValid = pdfProduced
      && allExecutedRuns.every((run) => run.structurallyValid);
    const correctlyRendered = expectedClass === 'supported-and-expected-to-pass'
      && executed
      && !unavailable
      && allExecutedRuns.every((run) => run.correctlyRendered);
    const explicitFailure = runs.some((run) =>
      run.findings?.some((finding) => finding.affectsCorrectness === true)
    );
    const intentionallyRejected = expectedClass === 'intentionally-rejected-by-documented-policy'
      && executed
      && allExecutedRuns.every((run) => run.intentionalRejection);
    const unsupported = expectedClass === 'unsupported-feature';
    const failedPdfGeneration = pdfEligible && executed && !structurallyValid && !unavailable;
    const incorrectlyRendered = pdfEligible
      && structurallyValid
      && !correctlyRendered
      && !unavailable;
    const failedExpectation = expectedClass === 'intentionally-rejected-by-documented-policy'
      ? executed && !intentionallyRejected
      : pdfEligible
        && !correctlyRendered
        && (explicitFailure || expectedClass === 'known-service-defect');
    const fixtureFindings = runs.flatMap((run) => run.findings ?? []);

    fixtureResults.push({
      fixtureId,
      category,
      expectedClass,
      attempted,
      executed,
      pdfEligible,
      pdfProduced,
      structurallyValid,
      correctlyRendered,
      incorrectlyRendered,
      failedPdfGeneration,
      intentionallyRejected,
      unsupported,
      environmentalLimitation: expectedClass === 'environmental-limitation'
        || fixtureFindings.some((item) => item.cause === 'environmental-limitation'),
      auditToolLimitation: expectedClass === 'audit-fixture-or-tool-limitation'
        || fixtureFindings.some((item) => item.cause === 'audit-fixture-or-tool-limitation'),
      unavailable,
      failedExpectation,
      findings: fixtureFindings
    });
  }

  const categories = {};
  const knownCategories = new Set([
    ...CATEGORY_ORDER,
    ...fixtureResults.map((fixture) => fixture.category)
  ]);
  for (const category of knownCategories) {
    categories[category] = aggregateFixtureRows(
      category,
      fixtureResults.filter((fixture) => fixture.category === category)
    );
  }
  const overall = aggregateFixtureRows('overall', fixtureResults);
  const supportedBasic = categories['supported-basic-pdf']
    ?? aggregateFixtureRows('supported-basic-pdf', []);
  const testedCapabilityIds = new Set();
  for (const fixture of fixtureResults.filter((item) => item.executed)) {
    for (const capabilityId of caseById.get(fixture.fixtureId)?.capabilityIds ?? []) {
      testedCapabilityIds.add(capabilityId);
    }
  }
  const allCapabilityIds = new Set(
    (manifest?.cases ?? []).flatMap((auditCase) => auditCase.capabilityIds ?? [])
  );
  const overallQuality = formatRate(
    fixtureResults.filter((fixture) => fixture.correctlyRendered).length,
    fixtureResults.filter((fixture) => fixture.executed && fixture.pdfEligible).length
  );
  const evidenceCoverage = calculateEvidenceCoverage(executions, manifest);

  return {
    uniqueFixtureResults: fixtureResults.length,
    totalExecutions: executions.length,
    totalRequestAttempts: executions.reduce(
      (sum, execution) => sum + (Number.isInteger(execution.requestAttempts) ? execution.requestAttempts : 0),
      0
    ),
    overall,
    categories,
    supportedBasic,
    qualityScore: {
      label: 'descriptive-only-nonblocking',
      ...overallQuality
    },
    capabilityCoverage: {
      label: 'fixture-input-scope-execution-coverage-nonblocking',
      ...formatRate(testedCapabilityIds.size, allCapabilityIds.size),
      testedCapabilityIds: [...testedCapabilityIds].sort(),
      untestedCapabilityIds: [...allCapabilityIds].filter((id) => !testedCapabilityIds.has(id)).sort()
    },
    evidenceCoverage
  };
}

function calculateEvidenceCoverage(executions, manifest) {
  const executionGroups = new Map();
  for (const execution of executions) {
    const fixtureId = execution.canonicalFixtureId ?? execution.caseId;
    if (!executionGroups.has(fixtureId)) executionGroups.set(fixtureId, []);
    executionGroups.get(fixtureId).push(execution);
  }
  const units = [];
  for (const auditCase of manifest?.cases ?? []) {
    const runs = executionGroups.get(auditCase.id);
    if (!runs?.some((run) => run.attempted)) continue;
    for (const requirement of auditCase.evidenceRequirements ?? []) {
      const collected = runs.length > 0
        && runs.every((run) => evidenceRequirementCollected(requirement, run));
      units.push({ fixtureId: auditCase.id, requirement, collected });
    }
  }
  const numerator = units.filter((unit) => unit.collected).length;
  return {
    label: 'required-evidence-availability-nonblocking',
    ...formatRate(numerator, units.length),
    collectedUnits: units.filter((unit) => unit.collected).map(evidenceUnitLabel),
    unavailableUnits: units.filter((unit) => !unit.collected).map(evidenceUnitLabel),
    optionalEvidence: []
  };
}

function evidenceRequirementCollected(requirement, execution) {
  if (!execution.executed) return false;
  const evidence = execution.evidence ?? {};
  if (requirement === 'structure') return Boolean(evidence.structural);
  if (requirement === 'page-geometry') return Boolean(evidence.structural && evidence.geometry && evidence.text);
  if (requirement === 'text') return Boolean(evidence.text);
  if (requirement === 'metadata') return Boolean(evidence.metadata);
  if (requirement === 'visual-reference') {
    return evidence.visualCorrectness?.approvedReference === true
      && evidence.visualCorrectness?.comparison !== 'not-performed';
  }
  if (requirement === 'policy-response') return Number.isInteger(execution.status);
  if (requirement === 'isolation') return Boolean(evidence.isolation);
  if (requirement === 'repeatability') return Boolean(evidence.repeatability);
  return false;
}

function evidenceUnitLabel(unit) {
  return `${unit.fixtureId}:${unit.requirement}`;
}

export function formatRate(numerator, denominator) {
  if (!Number.isInteger(numerator) || numerator < 0) throw new TypeError('Rate numerator must be a non-negative integer.');
  if (!Number.isInteger(denominator) || denominator < 0) throw new TypeError('Rate denominator must be a non-negative integer.');
  if (numerator > denominator) throw new RangeError('Rate numerator cannot exceed denominator.');
  if (denominator === 0) {
    return { numerator, denominator, value: null, percentage: null };
  }
  const value = numerator / denominator;
  return {
    numerator,
    denominator,
    value,
    percentage: Math.round(value * 10_000) / 100
  };
}

export function classifyOperationalStop(reason) {
  return OPERATIONAL_STOP_REASONS.has(reason);
}

export function sanitizeForEvidence(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (/<!doctype|<html|<body|<script/i.test(value)) return '[REDACTED_HTML]';
    return value
      .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]');
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    const sanitizedArray = value.map((item) => sanitizeForEvidence(item, seen));
    seen.delete(value);
    return sanitizedArray;
  }

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(?:authorization|api[-_]?key|bearer|credential|password|secret|token|signed[-_]?url|target[-_]?url|protection[-_]?bypass|^html$)/i.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeForEvidence(item, seen);
    }
  }
  seen.delete(value);
  return sanitized;
}

export function validateAuditResult(result, schema) {
  try {
    const selectedSchema = schema?.$defs?.result ?? schema;
    if (!selectedSchema) return { valid: false, errors: ['Missing result schema.'] };
    const validate = createAjv().compile(selectedSchema);
    const valid = validate(result);
    return {
      valid: Boolean(valid),
      errors: valid ? [] : (validate.errors ?? []).map((error) =>
        `${error.instancePath || '/'} ${error.message ?? error.keyword}`
      )
    };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

export async function collectToolPreflight(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const browser = await locateBrowser();
  const fonts = await inspectRequiredFonts();
  const [npmProbe, pdfInfo, pdfToText, pdfToPpm, qpdf, veraPdf, mutool, weasyPrint, vivliostyle] = await Promise.all([
    process.platform === 'win32'
      ? Promise.resolve({ name: 'npm', available: Boolean(npmVersionFromEnvironment()), version: npmVersionFromEnvironment() })
      : probeCommand('npm', ['--version']),
    probeExecutable('pdfinfo', { environmentName: 'PDFINFO_PATH', versionArgs: ['-v'] }),
    probeExecutable('pdftotext', { environmentName: 'PDFTOTEXT_PATH', versionArgs: ['-v'] }),
    probeExecutable('pdftoppm', { environmentName: 'PDFTOPPM_PATH', versionArgs: ['-v'] }),
    probeExecutable('qpdf', { versionArgs: ['--version'] }),
    probeExecutable('verapdf', { versionArgs: ['--version'] }),
    probeExecutable('mutool', { versionArgs: ['-v'] }),
    probeExecutable('weasyprint', { versionArgs: ['--version'] }),
    probeExecutable('vivliostyle', { versionArgs: ['--version'] })
  ]);
  const required = [pdfInfo, pdfToText, pdfToPpm];
  const requiredMissing = required.filter((tool) => !tool.available || !tool.probeSucceeded);

  return {
    inspectedAt: new Date().toISOString(),
    readOnly: true,
    operatingSystem: {
      platform: platform(),
      release: release(),
      architecture: process.arch,
      ci: Boolean(process.env.CI)
    },
    runtime: {
      node: process.version,
      requiredNode: packageJson.engines?.node ?? null,
      npm: npmProbe.version,
      packageManagerClassification: npmProbe.available
        ? 'required-and-already-available'
        : 'unsuitable-for-current-environment'
    },
    renderer: {
      browser: browser.label,
      browserVersion: browser.version,
      browserClassification: browser.available
        ? 'required-and-already-available'
        : 'unavailable-without-separate-user-authorization',
      puppeteer: packageJson.dependencies?.['puppeteer-core'] ?? null,
      chromiumRuntime: packageJson.dependencies?.['@sparticuz/chromium'] ?? null,
      vercelConstraints: {
        runtime: 'nodejs',
        maxDurationSeconds: 120,
        note: 'Recorded from the checked service route; Preview evidence is labeled separately.'
      }
    },
    requiredTools: required.map((tool) => ({
      ...tool,
      classification: tool.available && tool.probeSucceeded
        ? 'required-and-already-available'
        : 'unavailable-without-separate-user-authorization',
      licensingCost: 'open-source; no credential or paid service required'
    })),
    fonts,
    imageComparison: {
      method: 'SHA-256 equality of fixed-resolution Poppler PNGs',
      classification: pdfToPpm.available && pdfToPpm.probeSucceeded
        ? 'required-and-already-available'
        : 'unavailable-without-separate-user-authorization',
      threshold: 'exact equality is provisional PR A labeling only; no quality or release gate'
    },
    optionalTools: [qpdf, veraPdf, mutool, weasyPrint, vivliostyle].map((tool) => ({
      ...tool,
      classification: tool.available ? 'optional' : 'unavailable-without-separate-user-authorization',
      implications: optionalToolImplications(tool.name)
    })),
    constraints: {
      continuousIntegration: process.env.CI
        ? 'CI detected; browser and font identity must be recorded per run.'
        : 'No CI runtime detected; repository currently has no workflow.',
      nativeDependencies: 'No operating-system package or large native dependency was installed by this preflight.',
      externalToolAssumptions: 'No paid, proprietary, externally credentialed, or manually installed tool is assumed.'
    },
    coreEvidenceAvailable: browser.available
      && requiredMissing.length === 0
      && fonts.classification === 'required-and-already-available',
    unavailableCoreEvidence: [
      ...(!browser.available ? ['local-browser-rendering'] : []),
      ...requiredMissing.map((tool) => tool.name),
      ...(fonts.classification !== 'required-and-already-available' ? ['required-fonts'] : [])
    ]
  };
}

export function createHttpTransport(options) {
  const {
    baseUrl,
    expectedHostSha256,
    bearerKey,
    bypassSecret,
    timeoutMs = 120_000,
    maximumInputBytes = 100_000,
    maximumPdfBytes = 4_000_000,
    maximumJsonBytes = 65_536
  } = options;
  const origin = validatePreviewOrigin(baseUrl, expectedHostSha256);
  if (!bearerKey) throw operationalError('credential-problem', 'Preview bearer key is missing.');

  return async ({ payload }) => {
    const started = performance.now();
    const serializedPayload = JSON.stringify(payload);
    if (Buffer.byteLength(serializedPayload, 'utf8') > maximumInputBytes) {
      throw operationalError(
        'request-budget-limit',
        `Request exceeds the ${maximumInputBytes}-byte Preview audit cap.`,
        { requestAttempts: 0, requestInitiated: false }
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${origin}/api/v1/pdfs`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${bearerKey}`,
          'content-type': 'application/json',
          ...(bypassSecret
            ? { 'x-vercel-protection-bypass': bypassSecret }
            : {})
        },
        body: serializedPayload,
        signal: controller.signal
      });
      const contentType = response.headers.get('content-type') ?? '';
      const maximumBytes = contentType.toLowerCase().includes('application/pdf')
        ? maximumPdfBytes
        : maximumJsonBytes;
      const body = await readResponseWithLimit(response, maximumBytes);
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        durationMs: Math.round(performance.now() - started),
        requestAttempts: 1
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function generateMarkdownReport(result) {
  const rows = CATEGORY_ORDER
    .filter((category) => result.metrics.categories[category])
    .map((category) => result.metrics.categories[category]);
  if (result.metrics.overall) rows.push(result.metrics.overall);
  const basic = result.metrics.supportedBasic;
  const lines = [
    '# PDF quality audit — PR A compact baseline',
    '',
    `Run: \`${result.runId}\`  `,
    `Profile: \`${result.profileName}\` (${result.lane} evidence)  `,
    `Completion: \`${result.completionStatus}\`  `,
    `Logical executions: ${result.metrics.totalExecutions}; request attempts: ${result.metrics.totalRequestAttempts}.`,
    '',
    '> This is a measurement report, not a release gate. No score, percentage, defect count, fixture result, visual mismatch, or performance result can block audit completion.',
    '',
    '## Direct answer',
    '',
    `The service got **${basic.correctlyRenderedPdfs} of ${basic.uniqueFixturesExecuted} executed supported basic PDFs correct (${formatRateLabel(basic.correctRenderingRate)})** in this compact PR A lane. ${basic.unavailableFixtures} supported basic fixture(s) had unavailable required evidence.`,
    '',
    '## Raw results by unique fixture',
    '',
    '| Fixture category | Unique fixtures attempted | Unique fixtures executed | Not executed | PDFs produced | Structurally valid PDFs | Correctly rendered PDFs | Incorrectly rendered PDFs | Failed PDF generations | Unsupported fixtures | Intentionally rejected fixtures | Environmental limitations | Audit fixture/tool limitations | Unavailable fixtures | PDF-production rate | Structural-validity rate | Correct-rendering rate | Main failure or limitation reasons |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|',
    ...rows.map((row) => `| ${row.fixtureCategory} | ${row.uniqueFixturesAttempted} | ${row.uniqueFixturesExecuted} | ${row.uniqueFixturesNotExecuted} | ${row.pdfsProduced} | ${row.structurallyValidPdfs} | ${row.correctlyRenderedPdfs} | ${row.incorrectlyRenderedPdfs} | ${row.failedPdfGenerations} | ${row.unsupportedFixtures} | ${row.intentionallyRejectedFixtures} | ${row.environmentalLimitationFixtures} | ${row.auditToolLimitationFixtures} | ${row.unavailableFixtures} | ${formatRateLabel(row.productionRate)} | ${formatRateLabel(row.structuralValidityRate)} | ${formatRateLabel(row.correctRenderingRate)} | ${escapeTableCell(row.mainReasons.join('; ') || 'None observed')} |`),
    '',
    'Rates use unique fixtures, never repeated executions. For supported basic PDFs, all three denominators are executed fixtures whose intended result is a usable PDF. Unsupported, intentionally rejected, and unavailable fixtures remain visible and are not counted as supported successes.',
    '',
    '## Fixture-specific reasons',
    '',
    '| Fixture category | Fixture | Result labels | Concise reasons |',
    '|---|---|---|---|',
    ...rows.flatMap((row) => row.affectedFixtures.map((fixture) =>
      `| ${row.fixtureCategory} | ${fixture.fixtureId} | ${escapeTableCell(fixture.resultLabels.join(', '))} | ${escapeTableCell(fixture.reasons.join('; '))} |`
    )),
    ...(rows.every((row) => row.affectedFixtures.length === 0)
      ? ['| None | None | None | No incorrect, failed, rejected, unsupported, or unavailable fixture was recorded. |']
      : []),
    '',
    '## Evidence interpretation',
    '',
    `- Quality score: ${formatRateLabel(result.metrics.qualityScore)} (descriptive only).`,
    `- Fixture/input-scope execution coverage: ${formatRateLabel(result.metrics.capabilityCoverage)}. This shows which compact manifest inputs ran, not whether their evidence passed.`,
    `- Evidence availability: ${formatRateLabel(result.metrics.evidenceCoverage)}; core required evidence ${formatRateLabel(result.metrics.evidenceCoverage.coreRequired)}, optional tool evidence ${formatRateLabel(result.metrics.evidenceCoverage.optionalToolEvidence)}. Missing evidence lowers this descriptive coverage measurement without stopping the audit.`,
    '- Exact assertions cover status, PDF signature/parseability, page count, metadata, and required text.',
    `- Page-dimension comparisons use a provisional ±${PROVISIONAL_DIMENSION_TOLERANCE_POINTS}-point PR A tolerance. It labels findings only.`,
    '- Visual references are valid correctness evidence only when their committed review ledger says `approved`; otherwise the visual lane is unavailable. Raster repeatability is always labeled separately from correctness.',
    '- Latency is informational. PR A defines no performance, quality, or percentage release threshold.',
    '',
    '## Boundaries',
    '',
    '- Evidence contains synthetic fixtures only; no real user documents.',
    '- Requests use `storeResult:false` and `storeHtml:false`; Production R2 is not written.',
    '- Generated PDFs, full rasters, and raw checkpoints remain in ignored `test-artifacts/pdf-quality-audit/`.',
    '- Release assessment: not performed. Caller activation and any Production-release decision are separate, later decisions.',
    ''
  ];
  return `${lines.join('\n')}\n`;
}

export async function writeMarkdownReport(reportPath, result) {
  await writeFile(reportPath, generateMarkdownReport(result), 'utf8');
}

export function validatePreviewOrigin(value, expectedHostSha256) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw operationalError('authorization-boundary', 'Preview URL must be a valid absolute URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
    throw operationalError('authorization-boundary', 'Preview URL must be a credential-free HTTPS origin.');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw operationalError('authorization-boundary', 'Preview URL must not include an API path.');
  }
  if (!url.hostname.toLowerCase().endsWith('.vercel.app')) {
    throw operationalError('authorization-boundary', 'Preview target must use a vercel.app deployment hostname.');
  }
  if (!/^[0-9a-f]{64}$/i.test(expectedHostSha256 ?? '')) {
    throw operationalError(
      'authorization-boundary',
      'Preview host must be pinned by SHA-256 after independent Vercel deployment verification.'
    );
  }
  if (sha256(url.hostname.toLowerCase()) !== expectedHostSha256.toLowerCase()) {
    throw operationalError('authorization-boundary', 'Preview URL does not match the independently verified host pin.');
  }
  return url.origin;
}

async function executeOne({ manifest, execution, transport, rootDir, artifactDir }) {
  const caseById = new Map(manifest.cases.map((auditCase) => [auditCase.id, auditCase]));
  const canonicalCase = caseById.get(execution.caseId);
  const sourceCase = caseById.get(execution.sourceCaseId);
  const result = {
    ...execution,
    category: canonicalCase.category,
    expectedClass: canonicalCase.expectedClass,
    attempted: true,
    executed: false,
    requestAttempts: 0,
    status: null,
    responseContentType: null,
    durationMs: null,
    pdfProduced: false,
    structurallyValid: false,
    correctlyRendered: false,
    incorrectlyRendered: false,
    failedPdfGeneration: false,
    intentionalRejection: false,
    unsupported: canonicalCase.expectedClass === 'unsupported-feature',
    unavailable: false,
    expectationsMet: false,
    findings: [],
    evidence: {
      structural: null,
      text: null,
      geometry: null,
      metadata: null,
      visualCorrectness: null,
      repeatability: null
    }
  };

  let payload;
  try {
    payload = await buildPayload(sourceCase, rootDir);
  } catch (error) {
    result.unavailable = true;
    result.findings.push(finding(
      'fixture-unavailable',
      'high',
      'audit-fixture-or-tool-limitation',
      errorMessage(error),
      false
    ));
    return result;
  }

  let response;
  try {
    response = await transport({ execution, payload });
    result.executed = true;
    result.requestAttempts = normalizeRequestAttempts(response?.requestAttempts, 1);
  } catch (error) {
    if (classifyOperationalStop(error?.auditStopReason)) {
      const requestAttempts = Number.isInteger(error?.requestAttempts) && error.requestAttempts >= 0
        ? error.requestAttempts
        : 1;
      const requestInitiated = typeof error?.requestInitiated === 'boolean'
        ? error.requestInitiated
        : requestAttempts > 0;
      result.executed = requestInitiated;
      result.requestAttempts = requestAttempts;
      result.unavailable = true;
      result.evidence.operationalBoundary = {
        reason: error.auditStopReason,
        requestInitiated,
        requestAttempts
      };
      result.findings.push(finding(
        'fixture-unavailable-operational-boundary',
        'medium',
        error.auditStopReason,
        errorMessage(error),
        false
      ));
      return finalizeExecutionResult(result, canonicalCase.expectedClass);
    }
    result.executed = true;
    result.requestAttempts = normalizeRequestAttempts(error?.requestAttempts, 1);
    result.failedPdfGeneration = isPdfEligible(canonicalCase.expectedClass);
    result.findings.push(finding(
      'request-execution-failed',
      'high',
      'request-or-environment',
      errorMessage(error),
      true
    ));
    return result;
  }

  const headers = normalizeHeaders(response.headers);
  const body = Buffer.from(response.body ?? []);
  const contentType = headers['content-type'] ?? '';
  result.status = response.status;
  result.responseContentType = contentType.split(';', 1)[0].trim().toLowerCase() || null;
  result.durationMs = Number.isFinite(response.durationMs) ? Math.round(response.durationMs) : null;
  result.pdfProduced = response.status === 200
    && result.responseContentType === 'application/pdf'
    && body.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);

  const sourceExpected = sourceCase.expected;
  const expectedStatuses = Array.isArray(sourceExpected.httpStatus)
    ? sourceExpected.httpStatus
    : [sourceExpected.httpStatus];
  if (!expectedStatuses.includes(response.status)) {
    result.findings.push(finding(
      'unexpected-http-status',
      'high',
      'service-response',
      `Observed HTTP ${response.status}; expected ${expectedStatuses.join(' or ')}.`,
      true
    ));
  }

  if (canonicalCase.expectedClass === 'intentionally-rejected-by-documented-policy') {
    const errorCode = parseErrorCode(body, contentType);
    const expectedCode = sourceExpected.serviceErrorCode;
    result.intentionalRejection = expectedStatuses.includes(response.status)
      && (!expectedCode || errorCode === expectedCode);
    result.expectationsMet = result.intentionalRejection;
    if (result.intentionalRejection) {
      result.findings.push(finding(
        'documented-policy-rejection-observed',
        'informational',
        'documented-policy',
        `The service returned the documented ${expectedCode ?? 'controlled'} rejection for this intentionally rejected input.`,
        false
      ));
    }
    if (!result.intentionalRejection) {
      result.findings.push(finding(
        'policy-rejection-mismatch',
        'high',
        'documented-policy',
        `Expected documented rejection ${expectedCode ?? '(status only)'}; observed ${errorCode ?? 'no controlled error code'}.`,
        true
      ));
    }
    return finalizeExecutionResult(result, canonicalCase.expectedClass);
  }

  if (sourceExpected.contentType && result.responseContentType !== sourceExpected.contentType) {
    result.findings.push(finding(
      'content-type-mismatch',
      'high',
      'service-response',
      `Observed ${result.responseContentType ?? 'no content type'}; expected ${sourceExpected.contentType}.`,
      true
    ));
  }

  if (canonicalCase.expectedClass === 'unsupported-feature') {
    result.findings.push(finding(
      'unsupported-capability-classification',
      'informational',
      'unsupported-feature',
      sourceExpected.geometricExpectations?.informationalNotes?.join('; ')
        || 'The service contract does not document this capability as supported.',
      false
    ));
  }

  if (!result.pdfProduced) {
    result.failedPdfGeneration = isPdfEligible(canonicalCase.expectedClass);
    if (canonicalCase.expectedClass !== 'unsupported-feature') {
      result.findings.push(finding(
        'usable-pdf-not-produced',
        'critical',
        'pdf-production',
        `The executed request did not return a 200 application/pdf response with a PDF signature.`,
        true
      ));
    } else {
      result.findings.push(finding(
        'unsupported-capability-observed',
        'informational',
        'unsupported-feature',
        'The current request contract does not claim mixed page orientation support.',
        false
      ));
    }
    return finalizeExecutionResult(result, canonicalCase.expectedClass);
  }

  const fileStem = safeFileStem(execution.executionId);
  const pdfPath = path.join(artifactDir, `${fileStem}.pdf`);
  try {
    await writeFile(pdfPath, body);
  } catch (error) {
    result.unavailable = true;
    result.findings.push(finding(
      'fixture-artifact-write-unavailable',
      'high',
      'audit-fixture-or-tool-limitation',
      errorMessage(error),
      false
    ));
    return finalizeExecutionResult(result, canonicalCase.expectedClass);
  }

  try {
    result.evidence.structural = await validatePdfBuffer(body);
    result.structurallyValid = true;
  } catch (error) {
    result.findings.push(finding(
      'pdf-structural-invalidity',
      'critical',
      'pdf-structure',
      errorMessage(error),
      true
    ));
    result.failedPdfGeneration = isPdfEligible(canonicalCase.expectedClass);
    return finalizeExecutionResult(result, canonicalCase.expectedClass);
  }

  evaluateGeometry(result, sourceExpected);
  evaluateMetadata(result, sourceExpected);

  if (
    sourceExpected.requiredText.length > 0
    || sourceExpected.forbiddenText.length > 0
    || sourceExpected.geometricExpectations
  ) {
    try {
      const pages = await extractPdfTextByPage(pdfPath, result.evidence.structural.pageCount);
      const text = pages.map((page) => page.text).join('\n\f\n');
      result.evidence.text = {
        sha256: sha256(normalizeText(text)),
        characters: text.length,
        pages: pages.map((page) => ({
          pageNumber: page.pageNumber,
          sha256: sha256(normalizeText(page.text)),
          characters: page.text.length,
          nonblank: normalizeText(page.text).length > 0
        })),
        requiredTextFound: sourceExpected.requiredText.filter((expected) => text.includes(expected)),
        forbiddenTextFound: sourceExpected.forbiddenText.filter((expected) => text.includes(expected))
      };
      for (const expectedText of sourceExpected.requiredText) {
        if (!text.includes(expectedText)) {
          result.findings.push(finding(
            'required-text-missing',
            'high',
            'text-extraction',
            `Required text was not extracted: ${expectedText}`,
            true
          ));
        }
      }
      for (const forbiddenText of sourceExpected.forbiddenText) {
        if (text.includes(forbiddenText)) {
          result.findings.push(finding(
            'forbidden-text-present',
            'critical',
            'cross-request-contamination',
            `Forbidden sentinel was extracted: ${forbiddenText}`,
            true
          ));
        }
      }
      evaluateTextGeometry(result, sourceExpected.geometricExpectations, pages, text);
    } catch (error) {
      result.unavailable = true;
      result.findings.push(finding(
        'text-evidence-unavailable',
        'medium',
        'audit-fixture-or-tool-limitation',
        errorMessage(error),
        false
      ));
    }
  }

  try {
    const poppler = await inspectPdfWithPoppler(pdfPath);
    result.evidence.geometry = {
      pageCount: poppler.pageCount,
      pageDimensions: poppler.pageDimensions,
      encrypted: poppler.encrypted,
      tagged: poppler.tagged,
      pdfVersion: poppler.pdfVersion
    };
    if (poppler.pageCount !== result.evidence.structural.pageCount) {
      result.findings.push(finding(
        'parser-page-count-disagreement',
        'high',
        'pdf-structure',
        `pdf-lib reported ${result.evidence.structural.pageCount} pages; Poppler reported ${poppler.pageCount}.`,
        true
      ));
    }
  } catch (error) {
    result.unavailable = true;
    result.findings.push(finding(
      'poppler-geometry-unavailable',
      'medium',
      'audit-fixture-or-tool-limitation',
      errorMessage(error),
      false
    ));
  }

  if (sourceExpected.visualReferenceId) {
    try {
      await evaluateVisualReference({
        result,
        referenceId: sourceExpected.visualReferenceId,
        fixtureSha256: sourceCase.source.sha256,
        pdfPath,
        artifactDir,
        rootDir
      });
    } catch (error) {
      result.unavailable = true;
      result.findings.push(finding(
        'visual-reference-evidence-unavailable',
        'medium',
        'audit-fixture-or-tool-limitation',
        errorMessage(error),
        false
      ));
    }
  }

  return finalizeExecutionResult(result, canonicalCase.expectedClass);
}

function finalizeExecutionResult(result, expectedClass) {
  const correctnessFailure = result.findings.some((item) => item.affectsCorrectness);
  result.correctlyRendered = expectedClass === 'supported-and-expected-to-pass'
    && result.executed
    && result.pdfProduced
    && result.structurallyValid
    && !result.unavailable
    && !correctnessFailure;
  result.incorrectlyRendered = isPdfEligible(expectedClass)
    && result.structurallyValid
    && !result.correctlyRendered
    && !result.unavailable;
  result.failedPdfGeneration = isPdfEligible(expectedClass)
    && result.executed
    && !result.structurallyValid
    && !result.unavailable;
  result.expectationsMet = expectedClass === 'intentionally-rejected-by-documented-policy'
    ? result.intentionalRejection
    : result.correctlyRendered;
  if (expectedClass === 'known-service-defect') {
    if (!result.findings.some((item) => item.affectsCorrectness)) {
      result.findings.push(finding(
        'known-service-defect-classification',
        'high',
        'known-service-defect',
        `The fixture remains a known service defect: ${result.caseId}. Matching the expected observation is not a quality pass.`,
        true
      ));
    }
    result.correctlyRendered = false;
    result.expectationsMet = false;
  }
  if (['environmental-limitation', 'audit-fixture-or-tool-limitation'].includes(expectedClass)) {
    result.unavailable = true;
    result.correctlyRendered = false;
    result.incorrectlyRendered = false;
    result.expectationsMet = false;
    result.findings.push(finding(
      'classified-evidence-limitation',
      'medium',
      expectedClass,
      `Fixture ${result.caseId} is classified as ${expectedClass}; it cannot become a supported quality pass.`,
      false
    ));
  }
  if (expectedClass === 'unsupported-feature') {
    result.correctlyRendered = false;
    result.expectationsMet = false;
    result.unsupported = true;
  }
  return result;
}

function evaluateGeometry(result, expected) {
  const structural = result.evidence.structural;
  if (expected.pageCount) {
    if (
      structural.pageCount < expected.pageCount.minimum
      || structural.pageCount > expected.pageCount.maximum
    ) {
      result.findings.push(finding(
        'page-count-mismatch',
        'high',
        'page-geometry',
        `Observed ${structural.pageCount} pages; expected ${expected.pageCount.minimum}-${expected.pageCount.maximum}.`,
        true
      ));
    }
  }
  if (expected.pageDimensions?.length) {
    const expectedDimensions = expected.pageDimensions;
    structural.pageDimensions.forEach((actual, index) => {
      const target = expectedDimensions[Math.min(index, expectedDimensions.length - 1)];
      const widthDifference = Math.abs(actual.widthPoints - target.widthPoints);
      const heightDifference = Math.abs(actual.heightPoints - target.heightPoints);
      if (
        widthDifference > PROVISIONAL_DIMENSION_TOLERANCE_POINTS
        || heightDifference > PROVISIONAL_DIMENSION_TOLERANCE_POINTS
      ) {
        result.findings.push(finding(
          'page-dimension-geometry-mismatch',
          'high',
          'page-geometry',
          `Page ${index + 1} measured ${actual.widthPoints}x${actual.heightPoints} points; expected ${target.widthPoints}x${target.heightPoints} within the provisional ±${PROVISIONAL_DIMENSION_TOLERANCE_POINTS}-point reporting tolerance.`,
          true
        ));
      }
    });
  }
}

function evaluateTextGeometry(result, expectations, pages, fullText) {
  if (!expectations) return;
  if (expectations.allPagesNonblank) {
    for (const page of pages) {
      if (normalizeText(page.text).length === 0) {
        result.findings.push(finding(
          'blank-page-detected',
          'high',
          'page-geometry',
          `Page ${page.pageNumber} has no extractable content.`,
          true
        ));
      }
    }
  }

  for (const placement of expectations.perPageRequiredText ?? []) {
    const pageText = pages[placement.pageNumber - 1]?.text ?? '';
    for (const expectedText of placement.text) {
      if (!pageText.includes(expectedText)) {
        result.findings.push(finding(
          'required-page-placement-mismatch',
          'high',
          'page-geometry',
          `Page ${placement.pageNumber} did not contain required placement text: ${expectedText}`,
          true
        ));
      }
    }
  }

  for (const repeatedText of expectations.repeatTextOnEveryPage ?? []) {
    for (const page of pages) {
      if (!page.text.includes(repeatedText)) {
        result.findings.push(finding(
          'repeated-page-text-missing',
          'high',
          'page-geometry',
          `Page ${page.pageNumber} did not repeat required text: ${repeatedText}`,
          true
        ));
      }
    }
  }

  let priorIndex = -1;
  for (const orderedText of expectations.requiredTextOrder ?? []) {
    const currentIndex = fullText.indexOf(orderedText, priorIndex + 1);
    if (currentIndex === -1) {
      result.findings.push(finding(
        'required-text-order-mismatch',
        'high',
        'page-geometry',
        `Ordered text was absent or out of sequence: ${orderedText}`,
        true
      ));
      break;
    }
    priorIndex = currentIndex;
  }
}

function evaluateMetadata(result, expected) {
  if (!expected.metadata) return;
  const actual = result.evidence.structural;
  const fields = ['title', 'author', 'subject'];
  const mismatches = [];
  for (const field of fields) {
    if (actual[field] !== expected.metadata[field]) {
      mismatches.push(`${field}: expected ${expected.metadata[field]}, observed ${actual[field] ?? '(missing)'}`);
    }
  }
  const actualKeywords = Array.isArray(actual.keywords)
    ? actual.keywords.join(' ')
    : String(actual.keywords ?? '');
  for (const keyword of expected.metadata.keywords) {
    if (!actualKeywords.includes(keyword)) mismatches.push(`keyword missing: ${keyword}`);
  }
  result.evidence.metadata = {
    title: actual.title,
    author: actual.author,
    subject: actual.subject,
    keywords: actual.keywords,
    creator: actual.creator,
    producer: actual.producer,
    volatileDatesExcludedFromCorrectness: true
  };
  if (mismatches.length > 0) {
    result.findings.push(finding(
      'metadata-mismatch',
      'medium',
      'pdf-metadata',
      mismatches.join('; '),
      true
    ));
  }
}

async function evaluateVisualReference({ result, referenceId, fixtureSha256, pdfPath, artifactDir, rootDir }) {
  let renderedPages;
  try {
    const visualDir = path.join(artifactDir, 'visual');
    await mkdir(visualDir, { recursive: true });
    renderedPages = await renderPdfPages(pdfPath, path.join(visualDir, safeFileStem(result.executionId)));
  } catch (error) {
    result.unavailable = true;
    result.findings.push(finding(
      'visual-rendering-tool-unavailable',
      'medium',
      'audit-fixture-or-tool-limitation',
      errorMessage(error),
      false
    ));
    return;
  }

  const pageNumber = referencePageNumber(referenceId);
  const renderedPath = renderedPages[pageNumber - 1];
  if (!renderedPath) {
    result.findings.push(finding(
      'visual-reference-page-missing',
      'high',
      'visual-correctness',
      `Reference ${referenceId} requires page ${pageNumber}, but only ${renderedPages.length} page raster(s) were produced.`,
      true
    ));
    return;
  }
  const candidateName = `${safeFileStem(referenceId)}.png`;
  const candidatePath = path.join(artifactDir, 'visual', candidateName);
  if (path.resolve(renderedPath) !== path.resolve(candidatePath)) await copyFile(renderedPath, candidatePath);
  const candidateBytes = await readFile(candidatePath);
  const candidateSha256 = sha256(candidateBytes);

  let ledger;
  try {
    ledger = JSON.parse(await readFile(path.join(rootDir, DEFAULT_REFERENCE_LEDGER), 'utf8'));
  } catch {
    ledger = null;
  }
  const reference = ledger?.references?.find((item) => item.id === referenceId);
  if (!reference || reference.status !== 'approved' || ledger.status !== 'approved') {
    result.unavailable = true;
    result.evidence.visualCorrectness = {
      referenceId,
      candidateSha256,
      approvedReference: false,
      comparison: 'not-performed'
    };
    result.findings.push(finding(
      'visual-reference-unavailable',
      'medium',
      'audit-fixture-or-tool-limitation',
      `Reference ${referenceId} is absent or not approved in the immutable review ledger.`,
      false
    ));
    return;
  }

  const referencePath = path.resolve(rootDir, normalizeRepositoryPath(reference.path));
  ensureInsideRoot(path.resolve(rootDir, 'tests', 'quality-audit', 'references'), referencePath, 'visual reference');
  const referenceBytes = await readFile(referencePath);
  const actualReferenceSha256 = sha256(referenceBytes);
  const maximumBytes = ledger.updatePolicy?.maximumBytesPerImage ?? 262_144;
  const declaredTotalBytes = ledger.references.reduce((sum, item) => sum + item.bytes, 0);
  const maximumTotalBytes = ledger.updatePolicy?.maximumTotalReferenceBytes ?? 1_048_576;
  if (
    actualReferenceSha256 !== reference.sha256
    || referenceBytes.byteLength !== reference.bytes
    || referenceBytes.byteLength > maximumBytes
    || declaredTotalBytes > maximumTotalBytes
    || reference.fixtureSha256 !== fixtureSha256
  ) {
    result.unavailable = true;
    result.findings.push(finding(
      'visual-reference-integrity-failure',
      'high',
      'audit-fixture-or-tool-limitation',
      `Reference ${referenceId} violates its immutable source, hash, size, or total-artifact policy.`,
      false
    ));
    return;
  }
  const exactMatch = candidateSha256 === actualReferenceSha256;
  result.evidence.visualCorrectness = {
    referenceId,
    candidateSha256,
    referenceSha256: actualReferenceSha256,
    approvedReference: true,
    comparison: 'exact-raster-equality-provisional',
    exactMatch,
    distinctFromRepeatability: true
  };
  if (!exactMatch) {
    result.findings.push(finding(
      'visual-reference-mismatch',
      'high',
      'visual-correctness',
      `Rendered page does not exactly match approved compact reference ${referenceId}. This provisional PR A label is nonblocking.`,
      true
    ));
  }
}

function applyScenarioEvidence(executions, manifest) {
  const caseById = new Map(manifest.cases.map((auditCase) => [auditCase.id, auditCase]));
  const scenarioGroups = new Map();
  for (const execution of executions.filter((item) => item.scenarioType)) {
    if (!scenarioGroups.has(execution.canonicalFixtureId)) scenarioGroups.set(execution.canonicalFixtureId, []);
    scenarioGroups.get(execution.canonicalFixtureId).push(execution);
  }

  for (const [scenarioId, runs] of scenarioGroups) {
    const scenario = caseById.get(scenarioId)?.scenario;
    if (!scenario) continue;
    if (scenario.type === 'repeat') {
      const structuralSignatures = new Set(runs.map((run) => JSON.stringify({
        pageCount: run.evidence.structural?.pageCount ?? null,
        dimensions: run.evidence.structural?.pageDimensions ?? null
      })));
      const textSignatures = new Set(runs.map((run) => run.evidence.text?.sha256 ?? null));
      const pdfSignatures = new Set(runs.map((run) => run.evidence.structural?.sha256 ?? null));
      const visualSignatures = new Set(runs.map((run) => run.evidence.visualCorrectness?.candidateSha256 ?? null));
      const repeatability = {
        semanticStructureEqual: structuralSignatures.size === 1,
        extractedTextEqual: textSignatures.has(null) ? null : textSignatures.size === 1,
        pdfBytesEqual: pdfSignatures.has(null) ? null : pdfSignatures.size === 1,
        visualRasterEqual: visualSignatures.has(null) ? null : visualSignatures.size === 1,
        label: 'repeatability-only-not-visual-correctness'
      };
      const semanticRepeatable = repeatability.semanticStructureEqual && repeatability.extractedTextEqual;
      for (const run of runs) {
        run.evidence.repeatability = repeatability;
        if (!semanticRepeatable) {
          run.findings.push(finding(
            'semantic-repeatability-mismatch',
            'medium',
            'repeatability',
            'Repeated output changed in page geometry or extracted text. This is repeatability evidence, not a correctness baseline.',
            true
          ));
          run.correctlyRendered = false;
          run.incorrectlyRendered = run.structurallyValid && !run.unavailable;
        }
      }
      continue;
    }

    const alternatingPairs = [];
    for (let index = 1; index < runs.length; index += 1) {
      if (runs[index - 1].sourceCaseId === runs[index].sourceCaseId) continue;
      alternatingPairs.push({
        left: runs[index - 1].sourceCaseId,
        right: runs[index].sourceCaseId,
        distinctPdfSha256: runs[index - 1].evidence.structural?.sha256
          !== runs[index].evidence.structural?.sha256
      });
    }
    const isolationPassed = alternatingPairs.length > 0
      && alternatingPairs.every((pair) => pair.distinctPdfSha256)
      && runs.every((run) => !run.findings.some((item) => item.cause === 'cross-request-contamination'));
    for (const run of runs) {
      run.evidence.isolation = {
        syntheticCallerIdentity: 'PDF_CREATION_TEST',
        alternatingPairs,
        passed: isolationPassed
      };
      if (!isolationPassed) {
        run.findings.push(finding(
          'cross-request-isolation-mismatch',
          'critical',
          'cross-request-contamination',
          'The alternating synthetic application sequence did not establish distinct, uncontaminated outputs.',
          true
        ));
        run.correctlyRendered = false;
        run.incorrectlyRendered = run.structurallyValid && !run.unavailable;
      }
    }
  }
}

function buildAuditResult({
  manifest,
  profileName,
  runId,
  artifactDir,
  executions,
  preflight,
  requestAttempts,
  startedAt,
  isCheckpoint
}) {
  const metrics = aggregateMetrics(executions, manifest);
  metrics.evidenceCoverage = includeOptionalToolEvidence(metrics.evidenceCoverage, preflight);
  const hasUnavailable = executions.some((execution) => execution.unavailable);
  const profile = manifest.profiles[profileName];
  return {
    schemaVersion: 1,
    kind: 'pdf-quality-audit',
    runId,
    profileName,
    lane: profile.lane,
    evidenceClassification: profile.lane === 'preview'
      ? 'vercel-preview-evidence'
      : 'local-worktree-evidence',
    startedAt: startedAt ?? null,
    completedAt: isCheckpoint ? null : new Date().toISOString(),
    completionStatus: hasUnavailable
      ? 'complete_with_unavailable_evidence'
      : 'complete',
    qualityRule: 'metrics-only-nonblocking',
    releaseAssessment: 'not-performed',
    manifest: {
      schemaVersion: manifest.schemaVersion,
      fixtureVersion: manifest.fixtureVersion,
      title: manifest.title,
      uniqueCaseCount: manifest.cases.length,
      profileName
    },
    reproducibility: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      provisionalDimensionTolerancePoints: PROVISIONAL_DIMENSION_TOLERANCE_POINTS,
      exactDeterministicAssertions: ['HTTP status', 'PDF signature', 'PDF parseability', 'page count', 'required text', 'metadata'],
      calibratedVisualTolerances: 'not-yet-calibrated',
      performanceThresholds: 'none; measurements are informational',
      artifactDirectoryLabel: path.basename(artifactDir)
    },
    preflight,
    requestCounts: {
      get: profile.lane === 'preview' ? Math.min(profile.maximumGetRequests, 2) : 0,
      post: requestAttempts,
      total: requestAttempts + (profile.lane === 'preview' ? Math.min(profile.maximumGetRequests, 2) : 0)
    },
    executions,
    metrics
  };
}

function includeOptionalToolEvidence(coreEvidence, preflight) {
  const optionalTools = Array.isArray(preflight?.optionalTools) ? preflight.optionalTools : [];
  const optionalUnits = optionalTools.map((tool) => ({
    id: `optional-tool:${tool.name ?? 'unnamed'}`,
    collected: false,
    reason: tool.available
      ? 'available-but-not-used-by-pr-a'
      : 'tool-unavailable-without-separate-authorization'
  }));
  const coreRequired = formatRate(coreEvidence.numerator, coreEvidence.denominator);
  const optionalToolEvidence = formatRate(0, optionalUnits.length);
  return {
    label: 'evidence-availability-only-nonblocking',
    ...formatRate(coreEvidence.numerator, coreEvidence.denominator + optionalUnits.length),
    coreRequired,
    optionalToolEvidence,
    collectedUnits: coreEvidence.collectedUnits,
    unavailableUnits: [
      ...coreEvidence.unavailableUnits,
      ...optionalUnits.map((unit) => unit.id)
    ],
    optionalEvidence: optionalUnits
  };
}

function aggregateFixtureRows(category, rows) {
  const attempted = rows.filter((row) => row.attempted);
  const executed = rows.filter((row) => row.executed);
  const pdfEligible = executed.filter((row) => row.pdfEligible);
  const findings = rows.flatMap((row) => row.findings);
  const reasonCounts = new Map();
  const severityCounts = {};
  const causeCounts = {};
  for (const item of findings) {
    const label = `${item.code}: ${item.message}`;
    reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
    severityCounts[item.severity] = (severityCounts[item.severity] ?? 0) + 1;
    causeCounts[item.cause] = (causeCounts[item.cause] ?? 0) + 1;
  }
  const mainReasons = [...reasonCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([label, count]) => `${label}${count > 1 ? ` (${count})` : ''}`);
  const pdfsProduced = rows.filter((row) => row.pdfProduced).length;
  const structurallyValidPdfs = rows.filter((row) => row.structurallyValid).length;
  const correctlyRenderedPdfs = rows.filter((row) => row.correctlyRendered).length;
  const eligiblePdfsProduced = pdfEligible.filter((row) => row.pdfProduced).length;
  const eligibleStructurallyValidPdfs = pdfEligible.filter((row) => row.structurallyValid).length;
  const eligibleCorrectlyRenderedPdfs = pdfEligible.filter((row) => row.correctlyRendered).length;
  const affectedFixtures = rows
    .filter((row) =>
      row.failedExpectation
      || row.incorrectlyRendered
      || row.failedPdfGeneration
      || row.unsupported
      || row.intentionallyRejected
      || row.unavailable
    )
    .map((row) => ({
      fixtureId: row.fixtureId,
      resultLabels: fixtureResultLabels(row),
      reasons: fixtureReasons(row)
    }));
  return {
    fixtureCategory: category,
    uniqueFixturesAttempted: attempted.length,
    uniqueFixturesExecuted: executed.length,
    uniqueFixturesNotExecuted: attempted.filter((row) => !row.executed).length,
    uniqueFixturesMeetingAllRequiredExpectations: rows.filter((row) =>
      row.correctlyRendered || row.intentionallyRejected
    ).length,
    uniqueFixturesFailingOneOrMoreRequiredExpectations: rows.filter((row) => row.failedExpectation).length,
    pdfsProduced,
    structurallyValidPdfs,
    correctlyRenderedPdfs,
    incorrectlyRenderedPdfs: pdfEligible.filter((row) => row.incorrectlyRendered).length,
    failedPdfGenerations: pdfEligible.filter((row) => row.failedPdfGeneration).length,
    unsupportedFixtures: rows.filter((row) => row.unsupported).length,
    intentionallyRejectedFixtures: rows.filter((row) => row.intentionallyRejected).length,
    environmentalLimitationFixtures: rows.filter((row) => row.environmentalLimitation).length,
    auditToolLimitationFixtures: rows.filter((row) => row.auditToolLimitation).length,
    unavailableFixtures: rows.filter((row) => row.unavailable).length,
    productionRate: formatRate(eligiblePdfsProduced, pdfEligible.length),
    structuralValidityRate: formatRate(eligibleStructurallyValidPdfs, pdfEligible.length),
    correctRenderingRate: formatRate(eligibleCorrectlyRenderedPdfs, pdfEligible.length),
    findingsBySeverity: severityCounts,
    findingsByCause: causeCounts,
    mainReasons,
    uniqueAffectedFixtures: affectedFixtures.length,
    affectedFixtures
  };
}

function fixtureResultLabels(row) {
  return [
    row.incorrectlyRendered ? 'incorrect-rendering' : null,
    row.failedPdfGeneration ? 'failed-pdf-generation' : null,
    row.unsupported ? 'unsupported-feature' : null,
    row.intentionallyRejected ? 'intentionally-rejected' : null,
    row.environmentalLimitation ? 'environmental-limitation' : null,
    row.auditToolLimitation ? 'audit-fixture-or-tool-limitation' : null,
    row.unavailable ? 'unavailable' : null,
    row.failedExpectation ? 'failed-required-expectation' : null
  ].filter(Boolean);
}

function fixtureReasons(row) {
  const reasons = [...new Set((row.findings ?? []).map((item) => `${item.code}: ${item.message}`))];
  if (reasons.length > 0) return reasons;
  if (row.unsupported) return ['The fixture is classified as an unsupported feature under the documented contract.'];
  if (row.intentionallyRejected) return ['The fixture received its documented intentional policy rejection.'];
  if (row.unavailable) return ['Required environment or audit-tool evidence was unavailable.'];
  if (row.failedPdfGeneration) return ['The executed fixture did not produce a structurally valid usable PDF.'];
  if (row.incorrectlyRendered) return ['The PDF failed one or more required correctness expectations.'];
  return ['The fixture failed one or more required expectations.'];
}

function planItem({
  profileName,
  profile,
  auditCase,
  sourceCaseId,
  profileRepetition,
  scenarioIndex,
  scenarioType,
  ordinal
}) {
  return {
    executionId: `${profileName}-${String(ordinal).padStart(2, '0')}-${auditCase.id}`,
    ordinal,
    profileName,
    lane: profile.lane,
    caseId: auditCase.id,
    canonicalFixtureId: auditCase.id,
    sourceCaseId,
    category: auditCase.category,
    expectedClass: auditCase.expectedClass,
    profileRepetition,
    scenarioIndex,
    scenarioType
  };
}

async function buildPayload(sourceCase, rootDir) {
  if (!sourceCase?.source || !sourceCase?.request) {
    throw new Error(`Source case ${sourceCase?.id ?? '(unknown)'} has no request fixture.`);
  }
  const sourcePath = path.resolve(rootDir, normalizeRepositoryPath(sourceCase.source.path));
  ensureInsideRoot(rootDir, sourcePath, `fixture ${sourceCase.id}`);
  const sourceBytes = await readFile(sourcePath);
  if (sha256(sourceBytes) !== sourceCase.source.sha256) {
    throw new Error(`Fixture ${sourceCase.id} changed after manifest validation.`);
  }
  const html = applyMutation(sourceBytes.toString('utf8'), sourceCase.source.mutation);
  return {
    html,
    ...structuredClone(sourceCase.request)
  };
}

function applyMutation(html, mutation) {
  if (!mutation) return html;
  const injected = {
    script: '<script>window.__pdfAuditSyntheticScript = true;</script>',
    'external-url': '<img src="https://example.invalid/pdf-audit.png" alt="synthetic external resource">',
    'local-file-url': '<img src="file:///pdf-audit-denied" alt="synthetic local resource">',
    'mixed-orientation-css': '<style>@page auditLandscape { size: Letter landscape; } section[data-pdf-page]:nth-of-type(2){page:auditLandscape}</style>'
  }[mutation];
  if (!injected) throw new Error(`Unknown fixture mutation: ${mutation}`);
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${injected}</body>`)
    : `${html}${injected}`;
}

function validateManifestSemantics(manifest) {
  const ids = new Set();
  const expectedClassByCategory = {
    'supported-basic-pdf': new Set([
      'supported-and-expected-to-pass',
      'known-service-defect',
      'environmental-limitation',
      'audit-fixture-or-tool-limitation'
    ]),
    'intentional-policy-rejection': new Set(['intentionally-rejected-by-documented-policy']),
    'unsupported-capability': new Set(['unsupported-feature']),
    isolation: new Set([
      'supported-and-expected-to-pass',
      'known-service-defect',
      'environmental-limitation',
      'audit-fixture-or-tool-limitation'
    ]),
    repeatability: new Set([
      'supported-and-expected-to-pass',
      'known-service-defect',
      'environmental-limitation',
      'audit-fixture-or-tool-limitation'
    ])
  };
  for (const auditCase of manifest.cases) {
    if (ids.has(auditCase.id)) throw new Error(`Duplicate audit case ID: ${auditCase.id}`);
    ids.add(auditCase.id);
    if (!expectedClassByCategory[auditCase.category]?.has(auditCase.expectedClass)) {
      throw new Error(`Case ${auditCase.id} has an invalid category/classification pairing.`);
    }
    if (auditCase.request && (auditCase.request.storeResult !== false || auditCase.request.storeHtml !== false)) {
      throw new Error(`Case ${auditCase.id} violates the no-storage audit boundary.`);
    }
    if (auditCase.scenario?.type === 'repeat') {
      if (!auditCase.scenario.sourceCaseId || !Number.isInteger(auditCase.scenario.repetitions)) {
        throw new Error(`Repeat scenario ${auditCase.id} is incomplete.`);
      }
    }
    if (auditCase.scenario?.type === 'alternating-isolation') {
      if (!Array.isArray(auditCase.scenario.sequence) || auditCase.scenario.sequence.length < 2) {
        throw new Error(`Isolation scenario ${auditCase.id} is incomplete.`);
      }
    }
  }
  for (const auditCase of manifest.cases) {
    const references = [
      auditCase.scenario?.sourceCaseId,
      ...(auditCase.scenario?.sourceCaseIds ?? []),
      ...(auditCase.scenario?.sequence ?? [])
    ].filter(Boolean);
    for (const reference of references) {
      if (!ids.has(reference)) throw new Error(`Case ${auditCase.id} references unknown case ${reference}.`);
    }
  }
  for (const profileName of Object.keys(manifest.profiles)) buildExecutionPlan(manifest, profileName);
}

function finding(code, severity, cause, message, affectsCorrectness) {
  return { code, severity, cause, message, affectsCorrectness };
}

function createAjv() {
  return new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
}

function normalizeHeaders(headers) {
  if (!headers) return {};
  const entries = headers instanceof Headers
    ? headers.entries()
    : Object.entries(headers);
  return Object.fromEntries(
    [...entries].map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
}

function parseErrorCode(body, contentType) {
  if (!contentType.toLowerCase().includes('json') || body.length > 65_536) return null;
  try {
    return JSON.parse(body.toString('utf8'))?.error?.code ?? null;
  } catch {
    return null;
  }
}

function normalizeRequestAttempts(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

function isPdfEligible(expectedClass) {
  return ['supported-and-expected-to-pass', 'known-service-defect'].includes(expectedClass);
}

function formatAjvErrors(errors) {
  return (errors ?? []).map((error) =>
    `${error.instancePath || '/'} ${error.message ?? error.keyword}`
  ).join('; ');
}

function normalizeRepositoryPath(value) {
  return value.split('/').join(path.sep);
}

function ensureInsideRoot(rootDir, target, label, allowEqual = false) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(target));
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (outside || (!allowEqual && relative === '')) {
    throw new Error(`${label} must stay inside ${rootDir}.`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeText(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function safeFileStem(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
}

function referencePageNumber(referenceId) {
  const match = /-p(\d+)$/i.exec(referenceId);
  return match ? Number(match[1]) : 1;
}

function errorMessage(error) {
  const value = error instanceof Error ? error.message : String(error);
  return sanitizeForEvidence(value).slice(0, 1_000);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function operationalError(reason, message, details = {}) {
  const error = new Error(message);
  error.auditStopReason = reason;
  Object.assign(error, details);
  return error;
}

async function readResponseWithLimit(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw operationalError(
      'request-budget-limit',
      `Response exceeds the ${limit}-byte audit cap.`,
      { requestAttempts: 1, requestInitiated: true }
    );
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw operationalError(
        'request-budget-limit',
        `Response exceeded the ${limit}-byte audit cap.`,
        { requestAttempts: 1, requestInitiated: true }
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function probeCommand(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 1_000_000,
      timeout: 5_000,
      windowsHide: true
    });
    return {
      name: command,
      available: true,
      version: `${stdout ?? ''}\n${stderr ?? ''}`.trim().split(/\r?\n/, 1)[0] || null
    };
  } catch {
    return { name: command, available: false, version: null };
  }
}

async function locateBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    ...(process.platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'])
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const version = process.platform === 'win32'
        ? await readWindowsFileVersion(candidate)
        : await probeCommand(candidate, ['--version']);
      return {
        available: true,
        label: path.basename(candidate),
        version: version.version
      };
    } catch { /* try next read-only candidate */ }
  }
  return { available: false, label: null, version: null };
}

async function readWindowsFileVersion(filePath) {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-Item -LiteralPath $env:PDF_AUDIT_VERSION_PATH).VersionInfo.ProductVersion'
    ], {
      encoding: 'utf8',
      env: { ...process.env, PDF_AUDIT_VERSION_PATH: filePath },
      maxBuffer: 100_000,
      timeout: 5_000,
      windowsHide: true
    });
    return { available: true, version: stdout.trim() || null };
  } catch {
    return { available: true, version: null };
  }
}

function npmVersionFromEnvironment() {
  const match = /(?:^|\s)npm\/([^\s]+)/.exec(process.env.npm_config_user_agent ?? '');
  return match?.[1] ?? null;
}

async function inspectRequiredFonts() {
  const candidates = process.platform === 'win32'
    ? [
        ['Arial', 'C:\\Windows\\Fonts\\arial.ttf'],
        ['Arial Bold', 'C:\\Windows\\Fonts\\arialbd.ttf'],
        ['Times New Roman', 'C:\\Windows\\Fonts\\times.ttf']
      ]
    : process.platform === 'darwin'
      ? [
          ['Arial', '/System/Library/Fonts/Supplemental/Arial.ttf'],
          ['Arial Bold', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
          ['Times New Roman', '/System/Library/Fonts/Supplemental/Times New Roman.ttf']
        ]
      : [];
  if (candidates.length === 0) {
    return {
      classification: 'unsuitable-for-current-environment',
      checked: [],
      note: 'Required font identity must be supplied by the CI or local runner.'
    };
  }
  const checked = [];
  for (const [name, fontPath] of candidates) {
    try {
      const details = await stat(fontPath);
      checked.push({ name, available: details.isFile(), bytes: details.size });
    } catch {
      checked.push({ name, available: false, bytes: null });
    }
  }
  return {
    classification: checked.every((item) => item.available)
      ? 'required-and-already-available'
      : 'unavailable-without-separate-user-authorization',
    checked,
    note: 'Font presence is recorded; visual thresholds remain environment-specific and provisional.'
  };
}

function optionalToolImplications(name) {
  const notes = {
    qpdf: 'Open-source native executable; optional secondary structural evidence.',
    verapdf: 'Open-source Java/native tooling; optional PDF/A and accessibility evidence.',
    mutool: 'Open-source native executable; optional alternate parser/rasterizer.',
    weasyprint: 'Open-source Python/native stack; optional comparison engine and not a service oracle.',
    vivliostyle: 'Open-source Node/browser stack; optional comparison engine and not a service oracle.'
  };
  return notes[name] ?? 'Optional tool; installation or external use requires deliberate approval.';
}

function formatRateLabel(rate) {
  return rate.denominator === 0
    ? `${rate.numerator}/${rate.denominator} (N/A)`
    : `${rate.numerator}/${rate.denominator} (${rate.percentage.toFixed(2)}%)`;
}

function escapeTableCell(value) {
  return String(value).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
}
