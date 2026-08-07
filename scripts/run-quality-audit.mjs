import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  collectToolPreflight,
  createHttpTransport,
  executeAuditPlan,
  generateMarkdownReport,
  loadAuditManifest,
  sanitizeForEvidence,
  validatePreviewOrigin
} from './pdf-quality-audit.mjs';
import { runTimestamp, writeJson } from './pdf-test-utils.mjs';

const rootDir = process.cwd();
const artifactRoot = path.join(rootDir, 'test-artifacts', 'pdf-quality-audit');
const { command, options } = parseArguments(process.argv.slice(2));

try {
  if (command === 'preflight') {
    await runPreflight(options.profile ?? 'pr-a-local');
  } else if (command === 'run') {
    await runProfile(options.profile ?? 'pr-a-preview');
  } else if (command === 'report') {
    await rebuildReport(options.input, options.output);
  } else {
    throw new Error('Usage: node scripts/run-quality-audit.mjs <preflight|run|report> [--profile name] [--input path] [--output path]');
  }
} catch (error) {
  const reason = error?.auditStopReason ?? 'genuine-technical-impossibility';
  console.error(JSON.stringify({
    status: 'incomplete',
    reason,
    message: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exitCode = 2;
}

async function runPreflight(profileName) {
  const loaded = await loadAuditManifest({ rootDir });
  if (!loaded.manifest.profiles[profileName]) throw new Error(`Unknown audit profile: ${profileName}`);
  const preflight = await collectToolPreflight({ rootDir });
  const outputDirectory = path.join(artifactRoot, `preflight-${runTimestamp()}`);
  await mkdir(outputDirectory, { recursive: true });
  await writeJson(path.join(outputDirectory, 'preflight.json'), sanitizeForEvidence({
    kind: 'pdf-quality-audit-tool-preflight',
    profileName,
    manifestSha256: loaded.manifestSha256,
    schemaSha256: loaded.schemaSha256,
    immutableSourceFiles: loaded.sourceFiles,
    preflight
  }));
  console.log(JSON.stringify({
    status: 'complete',
    profileName,
    uniqueCases: loaded.manifest.cases.length,
    immutableSourceFiles: loaded.sourceFiles.length,
    coreEvidenceAvailable: preflight.coreEvidenceAvailable,
    unavailableCoreEvidence: preflight.unavailableCoreEvidence,
    outputDirectory
  }, null, 2));
}

async function runProfile(profileName) {
  if (profileName !== 'pr-a-preview') {
    throw new Error('The command-line runner is restricted to pr-a-preview. Use npm run audit:core for the real local route seam.');
  }
  const loaded = await loadAuditManifest({ rootDir });
  const preflight = await collectToolPreflight({ rootDir });
  const outputDirectory = path.join(artifactRoot, `${profileName}-${runTimestamp()}`);
  const baseUrl = process.env.PDF_CREATION_PREVIEW_URL;
  const expectedHostSha256 = process.env.PDF_CREATION_PREVIEW_HOST_SHA256;
  const bearerKey = process.env.PDF_CREATION_PREVIEW_KEY;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  if (!baseUrl || !expectedHostSha256 || !bearerKey) {
    await writeBlockedPreviewSummary({
      outputDirectory,
      profileName,
      reason: 'credential-problem',
      message: 'PDF_CREATION_PREVIEW_URL, PDF_CREATION_PREVIEW_HOST_SHA256, and PDF_CREATION_PREVIEW_KEY are required; no request was sent.',
      preflight
    });
    const error = new Error('Preview credentials are unavailable; local audit evidence remains valid.');
    error.auditStopReason = 'credential-problem';
    throw error;
  }

  let origin;
  try {
    origin = validatePreviewOrigin(baseUrl, expectedHostSha256);
  } catch (error) {
    await writeBlockedPreviewSummary({
      outputDirectory,
      profileName,
      reason: error?.auditStopReason ?? 'authorization-boundary',
      message: error instanceof Error ? error.message : 'Preview origin validation failed.',
      preflight
    });
    throw error;
  }
  const previewChecks = await previewSafetyPreflight({ origin, bearerKey, bypassSecret });
  await writeJson(path.join(outputDirectory, 'preview-preflight.json'), sanitizeForEvidence(previewChecks));
  const stop = previewChecks.find((check) => !check.safeToProceed);
  if (stop) {
    await writeBlockedPreviewSummary({
      outputDirectory,
      profileName,
      reason: stop.stopReason,
      message: stop.message,
      preflight,
      previewChecks
    });
    const error = new Error(stop.message);
    error.auditStopReason = stop.stopReason;
    throw error;
  }

  const transport = createHttpTransport({
    baseUrl: origin,
    expectedHostSha256,
    bearerKey,
    bypassSecret,
    timeoutMs: boundedInteger(process.env.PDF_CREATION_PREVIEW_TIMEOUT_MS, 120_000, 10_000, 120_000),
    maximumInputBytes: 100_000,
    maximumPdfBytes: 4_000_000,
    maximumJsonBytes: 65_536
  });
  const result = await executeAuditPlan({
    manifest: loaded.manifest,
    profileName,
    transport,
    rootDir,
    artifactDir: outputDirectory,
    preflight: {
      ...preflight,
      preview: {
        target: 'protected-vercel-preview',
        getRequests: 2,
        maximumPostRequests: 7,
        maximumTotalRequests: 9,
        maximumConcurrency: 1,
        repeatCount: { 'A-FULL-ACADEMIC-01': 3 },
        startSpacingMs: 2_000,
        retryPolicy: 'none',
        maximumInputRequestBytes: 100_000,
        maximumOutputPdfBytes: 4_000_000,
        estimatedRuntime: 'Approximately 3-15 minutes, bounded by seven sequential 120-second request timeouts plus six 2-second start spacings.',
        coldWarmMethod: 'No platform restart is forced. The first A-FULL-ACADEMIC-01 request is labeled cold-eligible first observation; its next two sequential executions are warm-eligible repeat observations. Actual Vercel instance reuse is not claimed.',
        failedRequestBudget: 'Every initiated POST consumes one of seven slots regardless of HTTP status, timeout, corruption, or quality result; no retry is permitted.',
        authentication: 'Bearer key and optional Deployment Protection bypass are read from environment variables and never persisted or printed.',
        storage: 'storeResult:false and storeHtml:false',
        safetyStopConditions: ['safety-risk', 'authorization-boundary', 'credential-problem', 'cost-limit', 'request-budget-limit', 'platform-protection', 'external-service-restriction', 'genuine-technical-impossibility'],
        evidenceLabel: 'Preview-only; not Production evidence'
      }
    }
  });
  const reportPath = path.join(outputDirectory, 'report.md');
  await writeFile(reportPath, generateMarkdownReport(result), 'utf8');
  console.log(JSON.stringify({
    status: result.completionStatus,
    profileName,
    requestCounts: result.requestCounts,
    supportedBasic: result.metrics.supportedBasic,
    outputDirectory,
    reportPath
  }, null, 2));
}

async function previewSafetyPreflight({ origin, bearerKey, bypassSecret }) {
  const commonHeaders = bypassSecret
    ? { 'x-vercel-protection-bypass': bypassSecret }
    : {};
  const health = await safeGetJson(`${origin}/api/health`, commonHeaders, 'health');
  const healthSafe = health.status === 200 && health.body?.status === 'ok';
  const healthResult = {
    name: 'health',
    status: health.status,
    durationMs: health.durationMs,
    serviceStatus: health.body?.status ?? null,
    safeToProceed: healthSafe,
    stopReason: healthSafe ? null : (health.stopReason ?? 'external-service-restriction'),
    message: healthSafe
      ? 'Preview health endpoint is available.'
      : 'Preview health preflight did not return the expected safe response.'
  };
  if (!healthSafe) return [healthResult];

  const diagnostics = await safeGetJson(
    `${origin}/api/v1/diagnostics`,
    { ...commonHeaders, authorization: `Bearer ${bearerKey}` },
    'diagnostics'
  );

  const diagnosticsSafe = diagnostics.status === 200
    && diagnostics.body?.status === 'ok'
    && diagnostics.body?.caller === 'test'
    && diagnostics.body?.configuration?.storageEnvironment === 'test';
  return [
    healthResult,
    {
      name: 'diagnostics',
      status: diagnostics.status,
      durationMs: diagnostics.durationMs,
      serviceStatus: diagnostics.body?.status ?? null,
      caller: diagnostics.body?.caller ?? null,
      storageEnvironment: diagnostics.body?.configuration?.storageEnvironment ?? null,
      versions: diagnostics.body?.versions ?? null,
      safeToProceed: diagnosticsSafe,
      stopReason: diagnostics.stopReason
        ?? (diagnostics.status === 401 || diagnostics.status === 403
          ? 'credential-problem'
          : 'safety-risk'),
      message: diagnosticsSafe
        ? 'Authenticated synthetic test caller confirmed outside the Production storage environment.'
        : 'Preview diagnostics did not confirm the synthetic test caller and non-Production storage environment.'
    }
  ];
}

async function safeGetJson(url, headers, label) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    });
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > 65_536) {
      return {
        status: response.status,
        body: null,
        durationMs: Math.round(performance.now() - started),
        error: `${label}-response-too-large`,
        stopReason: 'request-budget-limit'
      };
    }
    const bytes = await readBodyWithLimit(response, 65_536);
    const text = bytes.toString('utf8');
    let body = null;
    try { body = JSON.parse(text); } catch { /* unsafe to proceed is recorded by caller */ }
    return { status: response.status, body, durationMs: Math.round(performance.now() - started), error: null };
  } catch (error) {
    return {
      status: null,
      body: null,
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.name : 'request-failed',
      stopReason: error?.auditStopReason ?? 'external-service-restriction'
    };
  }
}

async function readBodyWithLimit(response, maximumBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      const error = new Error(`Response exceeded the ${maximumBytes}-byte safety cap.`);
      error.auditStopReason = 'request-budget-limit';
      throw error;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function writeBlockedPreviewSummary({
  outputDirectory,
  profileName,
  reason,
  message,
  preflight,
  previewChecks = []
}) {
  await mkdir(outputDirectory, { recursive: true });
  const summary = sanitizeForEvidence({
    schemaVersion: 1,
    kind: 'pdf-quality-audit',
    runId: `${profileName}-${runTimestamp()}`,
    profileName,
    lane: 'preview',
    evidenceClassification: 'vercel-preview-evidence-unavailable',
    completionStatus: reason === 'genuine-technical-impossibility'
      ? 'not_run_technical_impossibility'
      : 'incomplete_safety_or_authorization',
    qualityRule: 'metrics-only-nonblocking',
    releaseAssessment: 'not-performed',
    stopReason: reason,
    message,
    requestCounts: { get: previewChecks.length, post: 0, total: previewChecks.length },
    preflight,
    previewChecks,
    executions: [],
    metrics: emptyMetrics()
  });
  await writeJson(path.join(outputDirectory, 'summary.json'), summary);
  await writeFile(path.join(outputDirectory, 'report.md'), [
    '# PDF quality audit — Preview lane unavailable',
    '',
    `Completion: \`${summary.completionStatus}\``,
    '',
    message,
    '',
    'No quality result caused this stop. Local audit evidence and every other authorized lane remain valid.',
    ''
  ].join('\n'), 'utf8');
}

async function rebuildReport(input, output) {
  const inputPath = input
    ? path.resolve(rootDir, input)
    : await newestSummaryPath();
  ensureReportArtifactPath(inputPath, 'audit report input');
  if (path.basename(inputPath) !== 'summary.json') {
    throw new Error('Audit report input must be a summary.json inside the quality-audit artifact root.');
  }
  const result = JSON.parse(await readFile(inputPath, 'utf8'));
  if (result.kind !== 'pdf-quality-audit' || !result.metrics?.supportedBasic) {
    throw new Error(`${inputPath} is not a completed PDF quality-audit summary.`);
  }
  const outputPath = output
    ? path.resolve(rootDir, output)
    : path.join(path.dirname(inputPath), 'report.md');
  ensureReportArtifactPath(outputPath, 'audit report output');
  if (path.basename(outputPath) !== 'report.md' || path.dirname(outputPath) !== path.dirname(inputPath)) {
    throw new Error('Audit report output must be report.md beside the selected summary.json.');
  }
  await writeFile(outputPath, generateMarkdownReport(result), 'utf8');
  console.log(JSON.stringify({ status: 'complete', inputPath, outputPath }, null, 2));
}

function ensureReportArtifactPath(targetPath, label) {
  const relative = path.relative(path.resolve(artifactRoot), path.resolve(targetPath));
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${artifactRoot}.`);
  }
}

async function newestSummaryPath() {
  const entries = await readdir(artifactRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const summaryPath = path.join(artifactRoot, entry.name, 'summary.json');
    try {
      const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
      if (summary.kind === 'pdf-quality-audit' && summary.metrics?.supportedBasic) {
        candidates.push({ summaryPath, completedAt: summary.completedAt ?? summary.runId });
      }
    } catch { /* skip directories without completed audit summaries */ }
  }
  candidates.sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)));
  if (candidates.length === 0) throw new Error('No completed PDF quality-audit summary was found.');
  return candidates[0].summaryPath;
}

function parseArguments(args) {
  const parsed = { command: args[0], options: {} };
  for (let index = 1; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (!name.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid argument near ${name}.`);
    }
    parsed.options[name.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function emptyMetrics() {
  const rate = { numerator: 0, denominator: 0, value: null, percentage: null };
  const category = {
    fixtureCategory: 'supported-basic-pdf',
    uniqueFixturesAttempted: 0,
    uniqueFixturesExecuted: 0,
    uniqueFixturesNotExecuted: 0,
    uniqueFixturesMeetingAllRequiredExpectations: 0,
    uniqueFixturesFailingOneOrMoreRequiredExpectations: 0,
    pdfsProduced: 0,
    structurallyValidPdfs: 0,
    correctlyRenderedPdfs: 0,
    incorrectlyRenderedPdfs: 0,
    failedPdfGenerations: 0,
    unsupportedFixtures: 0,
    intentionallyRejectedFixtures: 0,
    environmentalLimitationFixtures: 0,
    auditToolLimitationFixtures: 0,
    unavailableFixtures: 0,
    productionRate: rate,
    structuralValidityRate: rate,
    correctRenderingRate: rate,
    findingsBySeverity: {},
    findingsByCause: {},
    mainReasons: [],
    uniqueAffectedFixtures: 0,
    affectedFixtures: []
  };
  return {
    uniqueFixtureResults: 0,
    totalExecutions: 0,
    totalRequestAttempts: 0,
    overall: { ...category, fixtureCategory: 'overall' },
    categories: { 'supported-basic-pdf': category },
    supportedBasic: category,
    qualityScore: { label: 'descriptive-only-nonblocking', ...rate },
    capabilityCoverage: { label: 'fixture-input-scope-execution-coverage-nonblocking', ...rate, testedCapabilityIds: [], untestedCapabilityIds: [] },
    evidenceCoverage: {
      label: 'evidence-availability-only-nonblocking',
      ...rate,
      coreRequired: rate,
      optionalToolEvidence: rate,
      collectedUnits: [],
      unavailableUnits: [],
      optionalEvidence: []
    }
  };
}
