import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractPdfText,
  latencySummary,
  runTimestamp,
  validatePdfBuffer,
  writeJson
} from './pdf-test-utils.mjs';

const baseUrl = (process.env.PDF_CREATION_LIVE_URL || 'https://a-three-coral-41.vercel.app').replace(/\/$/, '');
const credentialName = process.env.PDF_CREATION_LIVE_KEY ? 'PDF_CREATION_LIVE_KEY' : 'PDF_CREATION_ECONPLANNER';
const bearerKey = process.env[credentialName];
const timeoutMs = boundedNumber(process.env.PDF_CREATION_LIVE_TIMEOUT_MS, 120_000, 10_000, 120_000);
const maxLatencyMs = boundedNumber(process.env.PDF_CREATION_LIVE_MAX_LATENCY_MS, 45_000, 5_000, 120_000);
const delayMs = boundedNumber(process.env.PDF_CREATION_LIVE_STAGE_DELAY_MS, 1_500, 500, 10_000);
const outputDirectory = join(process.cwd(), 'test-artifacts', 'pdf-regression', `live-${runTimestamp()}`);
await mkdir(outputDirectory, { recursive: true });

const summary = {
  kind: 'controlled-live-reliability',
  liveUrl: baseUrl,
  testedAt: new Date().toISOString(),
  credentialEnvironmentName: bearerKey ? credentialName : null,
  safety: {
    storeResult: false,
    maximumConcurrency: 10,
    timeoutMs,
    maximumHealthyLatencyMs: maxLatencyMs,
    stopOnAnyHttpError: true,
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

if (!bearerKey) {
  summary.stoppedEarly = true;
  summary.stopReason = 'blocked-missing-live-credential';
  await writeJson(join(outputDirectory, 'summary.json'), summary);
  console.error(`Controlled live tests are blocked. Set PDF_CREATION_LIVE_KEY or PDF_CREATION_ECONPLANNER; no request was sent. Summary: ${join(outputDirectory, 'summary.json')}`);
  process.exitCode = 2;
} else {
  try {
    summary.health = await healthCheck();
    summary.diagnostics = await diagnosticsCheck();
    summary.validationChecks.push(await ordinaryValidationCheck('unauthorized', undefined, 401, 'unauthorized'));
    summary.validationChecks.push(await ordinaryValidationCheck('invalid-request', bearerKey, 400, 'invalid_request', {}));

    for (const concurrency of [1, 2, 5, 10]) {
      const stage = await runStage(concurrency);
      summary.stages.push(stage);
      const stopReason = stageStopReason(stage);
      if (stopReason) {
        summary.stoppedEarly = concurrency < 10;
        summary.stopReason = stopReason;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        summary.recovery = await liveRequest(1, 99);
        break;
      }
      if (concurrency < 10) await new Promise((resolve) => setTimeout(resolve, delayMs));
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
  const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json();
  if (response.status !== 200 || body?.status !== 'ok') throw new Error(`health-check-failed-${response.status}`);
  return { status: response.status, durationMs: Math.round(performance.now() - started), body };
}

async function diagnosticsCheck() {
  const response = await fetch(`${baseUrl}/api/v1/diagnostics`, {
    headers: { authorization: `Bearer ${bearerKey}` },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json();
  if (response.status !== 200 || body?.status !== 'ok') throw new Error(`diagnostics-check-failed-${response.status}`);
  return { status: response.status, body };
}

async function ordinaryValidationCheck(name, key, expectedStatus, expectedCode, payload = livePayload(`validation-${name}`)) {
  const response = await fetch(`${baseUrl}/api/v1/pdfs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json();
  if (response.status !== expectedStatus || body?.error?.code !== expectedCode) {
    throw new Error(`${name}-check-unexpected-${response.status}`);
  }
  return { name, status: response.status, code: body.error.code, passed: true };
}

async function runStage(concurrency) {
  const results = await Promise.all(Array.from({ length: concurrency }, (_, index) => liveRequest(concurrency, index)));
  const latencies = results.map((result) => result.durationMs);
  const successful = results.filter((result) => result.status === 200 && result.pdfValid && !result.contamination);
  const timeouts = results.filter((result) => result.timeout).length;
  const httpErrors = results.filter((result) => result.status !== 200).length;
  const corrupt = results.filter((result) => result.status === 200 && !result.pdfValid).length;
  return {
    concurrency,
    requestCount: results.length,
    successRate: ratio(successful.length, results.length),
    timeoutRate: ratio(timeouts, results.length),
    httpErrorRate: ratio(httpErrors, results.length),
    corruptionRate: ratio(corrupt, results.length),
    storageLinkFailureRate: null,
    contamination: results.some((result) => result.contamination),
    ...latencySummary(latencies),
    results
  };
}

async function liveRequest(concurrency, index) {
  const sentinel = `LIVE-${Date.now()}-C${concurrency}-R${index}`;
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/v1/pdfs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearerKey}` },
      body: JSON.stringify(livePayload(sentinel)),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const durationMs = Math.round(performance.now() - started);
    if (response.status !== 200) {
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('json') ? await response.json() : null;
      return { status: response.status, durationMs, timeout: false, pdfValid: false, contamination: false, errorCode: body?.error?.code ?? null };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const pdfPath = join(outputDirectory, `c${concurrency}-r${index}.pdf`);
    await writeFile(pdfPath, bytes);
    let pdf;
    let text = '';
    try {
      pdf = await validatePdfBuffer(bytes);
      text = await extractPdfText(pdfPath);
    } catch (error) {
      return { status: response.status, durationMs, timeout: false, pdfValid: false, contamination: false, error: error instanceof Error ? error.message : 'pdf-validation-failed' };
    }
    const contamination = !text.includes(sentinel) || /LIVE-\d+-C\d+-R\d+/.test(text.replace(sentinel, ''));
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
    return { status: 0, durationMs: Math.round(performance.now() - started), timeout, pdfValid: false, contamination: false, error: timeout ? 'timeout' : 'network-error' };
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
  if (stage.results.some((result) => result.status === 429)) return `http-429-at-concurrency-${stage.concurrency}`;
  if (stage.results.some((result) => result.status >= 500)) return `http-5xx-at-concurrency-${stage.concurrency}`;
  if (stage.timeoutRate > 0) return `timeout-at-concurrency-${stage.concurrency}`;
  if (stage.corruptionRate > 0) return `pdf-corruption-at-concurrency-${stage.concurrency}`;
  if (stage.contamination) return `cross-request-contamination-at-concurrency-${stage.concurrency}`;
  if (stage.maxMs > maxLatencyMs) return `latency-threshold-at-concurrency-${stage.concurrency}`;
  if (stage.httpErrorRate > 0) return `http-error-at-concurrency-${stage.concurrency}`;
  return null;
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}
