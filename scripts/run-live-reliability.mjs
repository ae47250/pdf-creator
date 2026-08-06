import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  busyRetryDelayMs,
  canStartAdmissionRetry,
  extractPdfText,
  latencySummary,
  runTimestamp,
  validatePdfBuffer,
  writeJson
} from './pdf-test-utils.mjs';

const baseUrl = (process.env.PDF_CREATION_PREVIEW_URL || '').replace(/\/$/, '');
const credentialName = 'PDF_CREATION_PREVIEW_KEY';
const bearerKey = process.env[credentialName];
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const timeoutMs = boundedNumber(process.env.PDF_CREATION_PREVIEW_TIMEOUT_MS, 120_000, 10_000, 120_000);
const maxLatencyMs = boundedNumber(process.env.PDF_CREATION_PREVIEW_MAX_LATENCY_MS, 30_000, 5_000, 120_000);
const delayMs = boundedNumber(process.env.PDF_CREATION_PREVIEW_STAGE_DELAY_MS, 1_500, 500, 10_000);
const roundDelayMs = boundedNumber(process.env.PDF_CREATION_PREVIEW_ROUND_DELAY_MS, 61_000, 61_000, 300_000);
const admissionDeadlineMs = 15_000;
const maximumAttempts = 5;
const outputDirectory = join(process.cwd(), 'test-artifacts', 'pdf-regression', `live-${runTimestamp()}`);
await mkdir(outputDirectory, { recursive: true });

const summary = {
  kind: 'controlled-live-reliability',
  target: 'protected-preview',
  testedAt: new Date().toISOString(),
  credentialEnvironmentName: bearerKey ? credentialName : null,
  safety: {
    storeResult: false,
    maximumConcurrency: 10,
    timeoutMs,
    maximumHealthyLatencyMs: maxLatencyMs,
    maximumAttempts,
    admissionDeadlineMs,
    rounds: 3,
    stopOnCorruption: true,
    stopOnContamination: true
  },
  health: null,
  diagnostics: null,
  validationChecks: [],
  stages: [],
  recovery: null,
  stoppedEarly: false,
  stopReason: null,
  storageWorkflow: 'not-tested-production-data-safety-boundary'
};

if (!baseUrl || !bearerKey) {
  summary.stoppedEarly = true;
  summary.stopReason = 'blocked-missing-live-credential';
  await writeJson(join(outputDirectory, 'summary.json'), summary);
  console.error(`Controlled Preview tests are blocked. Set PDF_CREATION_PREVIEW_URL and PDF_CREATION_PREVIEW_KEY; no request was sent. Summary: ${join(outputDirectory, 'summary.json')}`);
  process.exitCode = 2;
} else {
  try {
    summary.health = await healthCheck();
    summary.diagnostics = await diagnosticsCheck();
    summary.validationChecks.push(await ordinaryValidationCheck('unauthorized', undefined, 401, 'unauthorized'));
    summary.validationChecks.push(await ordinaryValidationCheck('invalid-request', bearerKey, 400, 'invalid_request', {}));

    for (let round = 1; round <= 3; round += 1) {
      for (const concurrency of [1, 2, 5, 10]) {
        const stage = await runStage(concurrency, round);
        summary.stages.push(stage);
        const stopReason = stageStopReason(stage);
        if (stopReason) {
          summary.stoppedEarly = true;
          summary.stopReason = stopReason;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          summary.recovery = await liveRequest(1, 99, round);
          break;
        }
        if (concurrency < 10) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (summary.stopReason) break;
      if (round < 3) await new Promise((resolve) => setTimeout(resolve, roundDelayMs));
    }
  } catch (error) {
    summary.stoppedEarly = true;
    summary.stopReason = error instanceof Error ? error.message : 'unexpected-live-runner-error';
    process.exitCode = 1;
  } finally {
    const summaryPath = join(outputDirectory, 'summary.json');
    await writeJson(summaryPath, summary);
    console.log(JSON.stringify({
      summaryPath,
      stages: summary.stages.map(({ concurrency, requestCount, successRate, medianMs, p95Ms, maxMs, httpErrorRate, corruptionRate, contamination }) => ({ concurrency, requestCount, successRate, medianMs, p95Ms, maxMs, httpErrorRate, corruptionRate, contamination })),
      stoppedEarly: summary.stoppedEarly,
      stopReason: summary.stopReason,
      recovery: summary.recovery && {
        status: summary.recovery.status,
        durationMs: summary.recovery.durationMs,
        pdfValid: summary.recovery.pdfValid,
        contamination: summary.recovery.contamination
      }
    }, null, 2));
  }
}

async function healthCheck() {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/health`, { headers: bypassHeaders(), signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json();
  if (response.status !== 200 || body?.status !== 'ok') throw new Error(`health-check-failed-${response.status}`);
  return { status: response.status, durationMs: Math.round(performance.now() - started), body };
}

async function diagnosticsCheck() {
  const response = await fetch(`${baseUrl}/api/v1/diagnostics`, {
    headers: requestHeaders(false),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json();
  if (response.status !== 200 || body?.status !== 'ok') throw new Error(`diagnostics-check-failed-${response.status}`);
  return { status: response.status, body };
}

async function ordinaryValidationCheck(name, key, expectedStatus, expectedCode, payload = livePayload(`validation-${name}`)) {
  const response = await fetch(`${baseUrl}/api/v1/pdfs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? requestHeaders(false, key) : bypassHeaders())
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json();
  if (response.status !== expectedStatus || body?.error?.code !== expectedCode) {
    throw new Error(`${name}-check-unexpected-${response.status}`);
  }
  return { name, status: response.status, code: body.error.code, passed: true };
}

async function runStage(concurrency, round) {
  const results = await Promise.all(Array.from({ length: concurrency }, (_, index) => liveRequest(concurrency, index, round)));
  const latencies = results.map((result) => result.durationMs);
  const successful = results.filter((result) => result.status === 200 && result.pdfValid && !result.contamination);
  const timeouts = results.filter((result) => result.timeout).length;
  const httpErrors = results.filter((result) => result.status !== 200).length;
  const corrupt = results.filter((result) => result.status === 200 && !result.pdfValid).length;
  return {
    concurrency,
    round,
    requestCount: results.length,
    successRate: ratio(successful.length, results.length),
    timeoutRate: ratio(timeouts, results.length),
    httpErrorRate: ratio(httpErrors, results.length),
    corruptionRate: ratio(corrupt, results.length),
    storageLinkFailureRate: null,
    contamination: results.some((result) => result.contamination),
    firstAttemptSuccessRate: ratio(results.filter((result) => result.firstAttemptStatus === 200).length, results.length),
    eventualSuccessRate: ratio(successful.length, results.length),
    busyResponseCount: results.reduce((sum, result) => sum + result.attempts.filter((attempt) => attempt.errorCode === 'renderer_busy').length, 0),
    retryExhaustionCount: results.filter((result) => result.retryExhausted).length,
    ...latencySummary(latencies),
    results
  };
}

async function liveRequest(concurrency, index, round) {
  const sentinel = `PREVIEW-${Date.now()}-N${round}-C${concurrency}-R${index}`;
  const started = performance.now();
  const deadline = started + admissionDeadlineMs;
  const attempts = [];
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (attempt > 1 && performance.now() >= deadline) {
      return retryFailure('admission-deadline-exhausted', started, attempts);
    }
    const result = await singleAttempt(concurrency, index, round, sentinel, attempt);
    attempts.push({
      attempt,
      status: result.status,
      durationMs: result.durationMs,
      errorCode: result.errorCode ?? null,
      retryAfter: result.retryAfter ?? null
    });
    if (result.status === 429 && result.errorCode === 'rate_limited' && result.retryAfter !== '60') {
      return retryFailure('invalid-rate-limit-retry-after', started, attempts, true);
    }
    if (result.status !== 429 || result.errorCode !== 'renderer_busy') {
      return { ...result, durationMs: Math.round(performance.now() - started), attempts, firstAttemptStatus: attempts[0].status, retryExhausted: false };
    }
    if (result.retryAfter !== '1') {
      return retryFailure('invalid-renderer-busy-retry-after', started, attempts, true);
    }
    if (attempt === maximumAttempts) return retryFailure('maximum-attempts-exhausted', started, attempts);
    const delay = busyRetryDelayMs(attempt);
    if (!canStartAdmissionRetry(performance.now(), delay, deadline)) return retryFailure('admission-deadline-exhausted', started, attempts);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return retryFailure('maximum-attempts-exhausted', started, attempts);
}

async function singleAttempt(concurrency, index, round, sentinel, attempt) {
  const attemptStarted = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/v1/pdfs`, {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify(livePayload(sentinel)),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const durationMs = Math.round(performance.now() - attemptStarted);
    if (response.status !== 200) {
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('json') ? await response.json() : null;
      return {
        status: response.status,
        durationMs,
        timeout: false,
        pdfValid: false,
        contamination: false,
        errorCode: body?.error?.code ?? null,
        retryAfter: response.headers.get('retry-after')
      };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const pdfPath = join(outputDirectory, `n${round}-c${concurrency}-r${index}-a${attempt}.pdf`);
    await writeFile(pdfPath, bytes);
    let pdf;
    let text = '';
    try {
      pdf = await validatePdfBuffer(bytes);
      text = await extractPdfText(pdfPath);
    } catch (error) {
      return { status: response.status, durationMs, timeout: false, pdfValid: false, contamination: false, error: error instanceof Error ? error.message : 'pdf-validation-failed' };
    }
    const contamination = !text.includes(sentinel) || /PREVIEW-\d+-N\d+-C\d+-R\d+/.test(text.replace(sentinel, ''));
    return {
      status: response.status,
      durationMs,
      timeout: false,
      pdfValid: true,
      contamination,
      bytes: pdf.bytes,
      pageCount: pdf.pageCount,
      sha256: pdf.sha256,
      requestId: response.headers.get('x-pdf-request-id')
    };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return { status: 0, durationMs: Math.round(performance.now() - attemptStarted), timeout, pdfValid: false, contamination: false, error: timeout ? 'timeout' : 'network-error' };
  }
}

function livePayload(sentinel) {
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;margin:.7in;color:#17201a}h1{color:#245f47}</style></head><body><h1>Controlled Live Reliability Check</h1><p>${sentinel}</p></body></html>`,
    filename: `Controlled_Live_C${sentinel.match(/-C(\d+)/)?.[1] || 0}.pdf`,
    storeResult: false,
    storeHtml: false,
    page: { format: 'Letter', orientation: 'portrait', marginsInches: { top: 0, right: 0, bottom: 0, left: 0 } },
    expectedPageCount: 1,
    correlationId: sentinel.replace(/[^A-Za-z0-9._:-]/g, '-')
  };
}

function stageStopReason(stage) {
  if (stage.results.some((result) => result.contractFailure)) return `retry-contract-failure-at-round-${stage.round}-concurrency-${stage.concurrency}`;
  if (stage.retryExhaustionCount > 0) return `retry-exhaustion-at-round-${stage.round}-concurrency-${stage.concurrency}`;
  if (stage.results.some((result) => result.status === 429)) return `http-429-at-round-${stage.round}-concurrency-${stage.concurrency}`;
  if (stage.results.some((result) => result.status >= 500)) return `http-5xx-at-concurrency-${stage.concurrency}`;
  if (stage.timeoutRate > 0) return `timeout-at-concurrency-${stage.concurrency}`;
  if (stage.corruptionRate > 0) return `pdf-corruption-at-concurrency-${stage.concurrency}`;
  if (stage.contamination) return `cross-request-contamination-at-concurrency-${stage.concurrency}`;
  if (stage.maxMs > maxLatencyMs) return `latency-threshold-at-concurrency-${stage.concurrency}`;
  if (stage.httpErrorRate > 0) return `http-error-at-concurrency-${stage.concurrency}`;
  return null;
}

function retryFailure(reason, started, attempts, contractFailure = false) {
  return {
    status: attempts.at(-1)?.status ?? 0,
    durationMs: Math.round(performance.now() - started),
    timeout: false,
    pdfValid: false,
    contamination: false,
    error: reason,
    errorCode: attempts.at(-1)?.errorCode ?? null,
    attempts,
    firstAttemptStatus: attempts[0]?.status ?? 0,
    retryExhausted: true,
    contractFailure
  };
}

function requestHeaders(includeContentType, key = bearerKey) {
  return {
    ...(includeContentType ? { 'content-type': 'application/json' } : {}),
    authorization: `Bearer ${key}`,
    ...bypassHeaders()
  };
}

function bypassHeaders() {
  return bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {};
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}
