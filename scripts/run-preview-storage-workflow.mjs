import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { runTimestamp, validatePdfBuffer, writeJson } from './pdf-test-utils.mjs';

const REQUIRED_ENVIRONMENT_NAMES = [
  'PDF_CREATION_PREVIEW_URL',
  'PDF_CREATION_PREVIEW_KEY',
  'PDF_CREATION_R2_ACCOUNT_ID',
  'PDF_CREATION_R2_BUCKET_NAME',
  'PDF_CREATION_R2_ACCESS_KEY_ID',
  'PDF_CREATION_R2_SECRET_ACCESS_KEY',
  'PDF_CREATION_R2_ENVIRONMENT',
  'PDF_CREATION_R2_EXPECTED_TEST_BUCKET_NAME',
  'PDF_CREATION_R2_PRODUCTION_BUCKET_NAME',
  'PDF_CREATION_R2_LIFECYCLE_READ_TOKEN',
  'VERCEL_AUTOMATION_BYPASS_SECRET'
];

const EXPECTED_LIFECYCLE_RULES = [
  ['reports/retention-1/', 2 * 24 * 60 * 60],
  ['reports/retention-7/', 8 * 24 * 60 * 60],
  ['reports/retention-30/', 31 * 24 * 60 * 60],
  ['Test/idempotency/', 31 * 24 * 60 * 60]
];

export function assertHeadBucketIsolation(testStatus, productionStatus) {
  if (testStatus !== 200) throw new Error('blocked-test-head-bucket-not-200');
  if (productionStatus !== 403) throw new Error('blocked-production-head-bucket-not-403');
}

export function validateCanaryLedger(remainingKeys, canaries) {
  const entries = canaries.map((canary) => {
    if (!canary.prefix || !isIsoDate(canary.createdAt) || !isIsoDate(canary.expectedExpiration) || !isIsoDate(canary.scheduledObservation)) {
      throw new Error('invalid-lifecycle-canary-ledger-entry');
    }
    return canary.prefix;
  });
  if (new Set(entries).size !== entries.length) throw new Error('duplicate-lifecycle-canary-ledger-entry');
  if (remainingKeys.length !== entries.length || remainingKeys.some((key) => !entries.includes(key))) {
    throw new Error('unidentified-object-remains-after-cleanup');
  }
  return true;
}

export function parseRetryAfterSeconds(value) {
  if (!/^\d+$/.test(value ?? '')) throw new Error('invalid-retry-after');
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('invalid-retry-after');
  return seconds;
}

async function main() {
  const missing = REQUIRED_ENVIRONMENT_NAMES.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(JSON.stringify({ event: 'preview_storage_blocked', reason: 'missing-environment', names: missing }));
    process.exitCode = 2;
    return;
  }
  if (process.env.PDF_CREATION_R2_ENVIRONMENT !== 'test') stop('blocked-storage-environment-not-test');
  if (process.env.PDF_CREATION_R2_BUCKET_NAME !== process.env.PDF_CREATION_R2_EXPECTED_TEST_BUCKET_NAME) {
    stop('blocked-test-bucket-identity-mismatch');
  }

  const endpoint = r2Endpoint();
  const storage = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.PDF_CREATION_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.PDF_CREATION_R2_SECRET_ACCESS_KEY
    },
    maxAttempts: 1
  });
  const testBucket = process.env.PDF_CREATION_R2_EXPECTED_TEST_BUCKET_NAME;
  const productionBucket = process.env.PDF_CREATION_R2_PRODUCTION_BUCKET_NAME;
  const previewUrl = process.env.PDF_CREATION_PREVIEW_URL.replace(/\/$/, '');
  const previewKey = process.env.PDF_CREATION_PREVIEW_KEY;
  const runId = randomUUID();
  const outputDirectory = join(process.cwd(), 'test-artifacts', 'pdf-regression', `preview-storage-${runTimestamp()}`);
  const ledgerPath = join(outputDirectory, 'private-ledger.json');
  await mkdir(outputDirectory, { recursive: true });

  const immediateKeys = new Set();
  const canaries = [];
  const summary = {
    kind: 'isolated-preview-storage-workflow',
    testedAt: new Date().toISOString(),
    isolation: { testHeadBucket: null, productionHeadBucket: null },
    workflow: {},
    cleanup: { immediateKeys: 0, remainingImmediateKeys: null, lifecycleCanaries: 0 },
    passed: false,
    stopReason: null
  };

  const persistLedger = async () => writeJson(ledgerPath, {
    runId,
    bucketRole: 'dedicated-test-only',
    immediateKeys: [...immediateKeys],
    canaries
  });

  try {
    const testStatus = await headBucketStatus(storage, testBucket);
    summary.isolation.testHeadBucket = testStatus;
    if (testStatus !== 200) stop('blocked-test-head-bucket-not-200');
    const productionStatus = await headBucketStatus(storage, productionBucket);
    summary.isolation.productionHeadBucket = productionStatus;
    assertHeadBucketIsolation(testStatus, productionStatus);

    await verifyTestLifecycleConfiguration(testBucket);
    if ((await listRelevantTestKeys(storage, testBucket)).length) stop('test-prefixes-not-empty-before-run');

    const withoutHtmlKey = `preview-${runId}-without-html`;
    const withHtmlKey = `preview-${runId}-with-html`;
    const raceKey = `preview-${runId}-race`;
    for (const key of [withoutHtmlKey, withHtmlKey, raceKey]) immediateKeys.add(idempotencyObjectKey(key));
    const withoutHtml = await submitStored(previewUrl, previewKey, withoutHtmlKey, false);
    const firstManifest = await inspectStoredReceipt(storage, testBucket, withoutHtml, false, immediateKeys);
    await verifyReportRoutes(previewUrl, withoutHtml, firstManifest);

    const withHtml = await submitStored(previewUrl, previewKey, withHtmlKey, true);
    const secondManifest = await inspectStoredReceipt(storage, testBucket, withHtml, true, immediateKeys);
    await verifyReportRoutes(previewUrl, withHtml, secondManifest);
    if (firstManifest.reportId === secondManifest.reportId) stop('duplicate-report-id');

    const replay = await submitStored(previewUrl, previewKey, withHtmlKey, true);
    if (replay.reportId !== withHtml.reportId || replay.storage?.idempotentReplay !== true) stop('idempotent-replay-failed');
    const beforeConflict = await listKeys(storage, testBucket, 'reports/');
    const conflict = await submitStored(previewUrl, previewKey, withHtmlKey, true, { subject: 'Changed fictional verification payload' }, 409);
    if (conflict?.error?.code !== 'idempotency_conflict') stop('idempotency-conflict-failed');
    const afterConflict = await listKeys(storage, testBucket, 'reports/');
    if (!sameStrings(beforeConflict, afterConflict)) stop('idempotency-conflict-changed-objects');

    const race = await Promise.all([
      submitStored(previewUrl, previewKey, raceKey, false),
      submitStored(previewUrl, previewKey, raceKey, false)
    ]);
    if (race[0].reportId !== race[1].reportId) stop('idempotency-race-created-multiple-reports');
    await inspectStoredReceipt(storage, testBucket, race[0], false, immediateKeys);

    await verifyConditionalCollision(storage, testBucket, runId, immediateKeys);
    await verifyInterruptedCleanup(storage, testBucket, runId);

    await expireTestManifest(storage, testBucket, firstManifest);
    const expiredView = await fetch(`${previewUrl}/reports/${withoutHtml.reportId}`, { headers: previewBypassHeaders(), signal: AbortSignal.timeout(30_000) });
    const expiredDownload = await fetch(`${previewUrl}/reports/${withoutHtml.reportId}/download`, { headers: previewBypassHeaders(), signal: AbortSignal.timeout(30_000) });
    if (expiredView.status !== 410 || expiredDownload.status !== 410) stop('expired-report-route-not-410');

    summary.workflow = {
      storedWithoutHtml: true,
      storedWithHtml: true,
      distinctReports: true,
      idempotentReplay: true,
      idempotencyConflict: true,
      concurrentRace: true,
      conditionalCollision: true,
      routeDispositionAndIntegrity: true,
      expiredRoutes410: true,
      interruptedCleanup: true
    };

    await persistLedger();
    await deleteExactKeys(storage, testBucket, [...immediateKeys]);
    const remainingImmediate = await listRelevantTestKeys(storage, testBucket);
    summary.cleanup.immediateKeys = immediateKeys.size;
    summary.cleanup.remainingImmediateKeys = remainingImmediate.length;
    if (remainingImmediate.length) stop('immediate-cleanup-left-run-owned-objects');

    await createLifecycleCanaries(storage, testBucket, runId, canaries, persistLedger);
    const remainingCanaries = await listRelevantTestKeys(storage, testBucket);
    validateCanaryLedger(remainingCanaries, canaries);
    summary.cleanup.lifecycleCanaries = canaries.length;
    summary.passed = true;
  } catch (error) {
    summary.stopReason = error instanceof Error ? error.message : 'unexpected-preview-storage-error';
    process.exitCode = 1;
  } finally {
    try {
      await deleteExactKeys(storage, testBucket, [...immediateKeys]);
      await persistLedger();
    } catch {
      summary.stopReason ??= 'final-cleanup-failed';
      summary.passed = false;
      process.exitCode = 1;
    }
    await writeJson(join(outputDirectory, 'summary.json'), summary);
    console.log(JSON.stringify({
      event: 'preview_storage_complete',
      passed: summary.passed,
      stopReason: summary.stopReason,
      isolation: summary.isolation,
      workflow: summary.workflow,
      cleanup: summary.cleanup
    }));
  }
}

async function headBucketStatus(storage, bucket) {
  try {
    const response = await storage.send(new HeadBucketCommand({ Bucket: bucket }));
    return response.$metadata?.httpStatusCode ?? 200;
  } catch (error) {
    return error?.$metadata?.httpStatusCode ?? 0;
  }
}

export function validateLifecycleApiResponse(payload) {
  if (!payload || payload.success !== true || !payload.result || !Array.isArray(payload.result.rules)) {
    throw new Error('test-lifecycle-response-invalid');
  }

  for (const [prefix, maxAge] of EXPECTED_LIFECYCLE_RULES) {
    const match = payload.result.rules.find((rule) => (
      rule?.enabled === true &&
      rule?.conditions?.prefix === prefix &&
      rule?.deleteObjectsTransition?.condition?.type === 'Age'
    ));
    if (!match || match.deleteObjectsTransition.condition.maxAge !== maxAge) {
      throw new Error('test-lifecycle-rule-mismatch');
    }
  }
  return true;
}

export function lifecycleInspectionRequest(bucket, environment = process.env) {
  const expectedTestBucket = environment.PDF_CREATION_R2_EXPECTED_TEST_BUCKET_NAME;
  if (!bucket || !expectedTestBucket || bucket !== expectedTestBucket) {
    throw new Error('blocked-lifecycle-bucket-not-approved-test-bucket');
  }
  const accountId = environment.PDF_CREATION_R2_ACCOUNT_ID;
  const token = environment.PDF_CREATION_R2_LIFECYCLE_READ_TOKEN;
  if (!accountId || !token) throw new Error('missing-lifecycle-read-configuration');

  const jurisdiction = environment.PDF_CREATION_R2_JURISDICTION;
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${token}`
  };
  if (jurisdiction) headers['cf-r2-jurisdiction'] = jurisdiction;

  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/lifecycle`,
    options: { method: 'GET', headers }
  };
}

export function parseLifecycleApiResponse(status, rawBody) {
  if (status !== 200) throw new Error('test-lifecycle-read-failed');
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error('test-lifecycle-response-invalid');
  }
  return validateLifecycleApiResponse(payload);
}

async function verifyTestLifecycleConfiguration(bucket) {
  const request = lifecycleInspectionRequest(bucket);
  let response;
  try {
    response = await fetch(request.url, { ...request.options, signal: AbortSignal.timeout(30_000) });
  } catch {
    stop('test-lifecycle-read-failed');
  }
  parseLifecycleApiResponse(response.status, await response.text());
}

async function submitStored(baseUrl, key, idempotencyKey, storeHtml, metadata = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}/api/v1/pdfs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...previewBypassHeaders() },
    body: JSON.stringify({
      html: '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;margin:.7in}</style></head><body><h1>Fictional Preview Storage Verification</h1><p>No personal or production data.</p></body></html>',
      filename: 'Fictional_Preview_Verification.pdf',
      storeResult: true,
      storeHtml,
      retentionDays: 1,
      idempotencyKey,
      metadata,
      page: { format: 'Letter', orientation: 'portrait', marginsInches: { top: 0, right: 0, bottom: 0, left: 0 } },
      expectedPageCount: 1
    }),
    signal: AbortSignal.timeout(120_000)
  });
  const body = await response.json();
  if (response.status !== expectedStatus) {
    const code = typeof body?.error?.code === 'string' ? body.error.code : 'unknown';
    const path = typeof body?.error?.details?.[0]?.path === 'string'
      ? body.error.details[0].path.replace(/[^A-Za-z0-9/_-]/g, '') || 'root'
      : 'none';
    stop(`stored-request-unexpected-status-${response.status}-${code}-${path}`);
  }
  return body;
}

async function inspectStoredReceipt(storage, bucket, receipt, expectHtml, immediateKeys) {
  const prefix = reportPrefix(receipt.reportId);
  const keys = await listKeys(storage, bucket, `${prefix}/`);
  const manifestKey = `${prefix}/manifest.json`;
  if (!keys.includes(manifestKey)) stop('stored-manifest-missing');
  const manifestObject = await getObject(storage, bucket, manifestKey);
  const manifest = JSON.parse(manifestObject.bytes.toString('utf8'));
  const expectedKeys = [manifest.pdf?.key, ...(expectHtml ? [manifest.html?.key] : [])];
  if (expectedKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) stop('stored-artifact-missing');
  if (!manifest.pdf.key.startsWith(`${prefix}/Test/`) || (manifest.html && !manifest.html.key.startsWith(`${prefix}/Test/`))) {
    stop('stored-object-layout-mismatch');
  }
  if (!expectHtml && (manifest.html || keys.some((key) => key.endsWith('/rendered.html')))) stop('unexpected-stored-html');
  if (expectHtml) {
    const html = await getObject(storage, bucket, manifest.html.key);
    const htmlHash = createHash('sha256').update(html.bytes).digest('hex');
    if (html.bytes.byteLength !== manifest.html.bytes || htmlHash !== manifest.html.sha256) stop('stored-html-integrity-failed');
  }
  const listed = await listObjects(storage, bucket, `${prefix}/`);
  const manifestTime = listed.find((object) => object.Key === manifestKey)?.LastModified?.getTime();
  const artifactsBeforeManifest = expectedKeys.every((key) => {
    const time = listed.find((object) => object.Key === key)?.LastModified?.getTime();
    return typeof time === 'number' && typeof manifestTime === 'number' && time <= manifestTime;
  });
  if (!artifactsBeforeManifest) stop('artifact-manifest-order-not-observed');
  for (const key of [manifestKey, ...expectedKeys]) immediateKeys.add(key);
  return { ...manifest, manifestKey, manifestETag: manifestObject.eTag };
}

async function verifyReportRoutes(baseUrl, receipt, manifest) {
  const view = await fetch(`${baseUrl}/reports/${receipt.reportId}`, { headers: previewBypassHeaders(), signal: AbortSignal.timeout(30_000) });
  const download = await fetch(`${baseUrl}/reports/${receipt.reportId}/download`, { headers: previewBypassHeaders(), signal: AbortSignal.timeout(30_000) });
  if (view.status !== 200 || !/^inline/i.test(view.headers.get('content-disposition') ?? '')) stop('stored-view-route-failed');
  if (download.status !== 200 || !/^attachment/i.test(download.headers.get('content-disposition') ?? '')) stop('stored-download-route-failed');
  const viewBytes = Buffer.from(await view.arrayBuffer());
  const downloadBytes = Buffer.from(await download.arrayBuffer());
  const pdf = await validatePdfBuffer(viewBytes);
  if (!viewBytes.equals(downloadBytes) || pdf.sha256 !== manifest.pdf.sha256 || pdf.sha256 !== receipt.sha256) stop('stored-pdf-integrity-failed');
  if (view.headers.get('x-pdf-sha256') !== receipt.sha256 || download.headers.get('x-pdf-sha256') !== receipt.sha256) {
    stop('stored-route-hash-header-failed');
  }
  if (pdf.pageCount !== receipt.pageCount || JSON.stringify(pdf.pageDimensions) !== JSON.stringify(receipt.pageDimensions)) {
    stop('stored-pdf-page-contract-failed');
  }
}

async function verifyConditionalCollision(storage, bucket, runId, immediateKeys) {
  const key = `reports/retention-1/${runId}/collision.bin`;
  const original = Buffer.from('original-test-bytes');
  await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: original, IfNoneMatch: '*' }));
  immediateKeys.add(key);
  let status = 0;
  try {
    await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from('replacement'), IfNoneMatch: '*' }));
  } catch (error) {
    status = error?.$metadata?.httpStatusCode ?? 0;
  }
  if (status !== 412) stop('conditional-collision-not-412');
  const stored = await getObject(storage, bucket, key);
  if (!stored.bytes.equals(original)) stop('conditional-collision-overwrote-bytes');
}

async function verifyInterruptedCleanup(storage, bucket, runId) {
  const keys = [
    `reports/retention-1/${runId}/interrupted/report.pdf`,
    `reports/retention-1/${runId}/interrupted/rendered.html`
  ];
  for (const key of keys) await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from('fictional-test') }));
  await deleteExactKeys(storage, bucket, keys);
  if ((await existingExactKeys(storage, bucket, keys)).length) stop('interrupted-cleanup-failed');
}

async function expireTestManifest(storage, bucket, manifest) {
  const expired = { ...manifest, expiresAt: new Date(Date.now() - 60_000).toISOString() };
  delete expired.manifestKey;
  delete expired.manifestETag;
  await storage.send(new PutObjectCommand({
    Bucket: bucket,
    Key: manifest.manifestKey,
    Body: JSON.stringify(expired),
    ContentType: 'application/json',
    IfMatch: manifest.manifestETag
  }));
}

async function createLifecycleCanaries(storage, bucket, runId, canaries, persistLedger) {
  const created = new Date();
  for (const [retention, expirationDays, observationDays] of [[1, 2, 3], [7, 8, 9], [30, 31, 32]]) {
    const prefix = `reports/retention-${retention}/lifecycle-canary-${runId}.json`;
    const entry = {
      prefix,
      createdAt: created.toISOString(),
      expectedExpiration: new Date(created.getTime() + expirationDays * 86_400_000).toISOString(),
      scheduledObservation: new Date(created.getTime() + observationDays * 86_400_000).toISOString()
    };
    canaries.push(entry);
    await persistLedger();
    await storage.send(new PutObjectCommand({ Bucket: bucket, Key: prefix, Body: JSON.stringify({ kind: 'lifecycle-canary' }), IfNoneMatch: '*' }));
    const head = await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: prefix }));
    if (!head.Expiration) stop('lifecycle-canary-missing-expiration-metadata');
  }
}

async function getObject(storage, bucket, key) {
  const response = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) stop('storage-object-body-missing');
  return { bytes: Buffer.from(await response.Body.transformToByteArray()), eTag: response.ETag };
}

async function listObjects(storage, bucket, prefix) {
  const objects = [];
  let token;
  do {
    const response = await storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    objects.push(...(response.Contents ?? []));
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function listKeys(storage, bucket, prefix) {
  return (await listObjects(storage, bucket, prefix)).map((object) => object.Key).filter(Boolean).sort();
}

async function listRelevantTestKeys(storage, bucket) {
  return [
    ...(await listKeys(storage, bucket, 'reports/')),
    ...(await listKeys(storage, bucket, 'Test/idempotency/'))
  ].sort();
}

async function existingExactKeys(storage, bucket, keys) {
  const remaining = [];
  for (const key of keys) {
    try {
      await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      remaining.push(key);
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404) throw error;
    }
  }
  return remaining;
}

async function deleteExactKeys(storage, bucket, keys) {
  if (!keys.length) return;
  for (let index = 0; index < keys.length; index += 1000) {
    const response = await storage.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })), Quiet: true }
    }));
    if (response.Errors?.length) stop('test-bucket-cleanup-failed');
  }
}

function reportPrefix(reportId) {
  const match = /^r(1|7|30)_([0-9a-f-]{36})$/i.exec(reportId ?? '');
  if (!match) stop('invalid-report-id');
  return `reports/retention-${match[1]}/${match[2].toLowerCase()}`;
}

function idempotencyObjectKey(key) {
  const hash = createHash('sha256').update(`test\0${key}`).digest('hex');
  return `Test/idempotency/${hash}.json`;
}

function r2Endpoint() {
  const suffix = process.env.PDF_CREATION_R2_JURISDICTION ? `.${process.env.PDF_CREATION_R2_JURISDICTION}` : '';
  return `https://${process.env.PDF_CREATION_R2_ACCOUNT_ID}${suffix}.r2.cloudflarestorage.com`;
}

function previewBypassHeaders() {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function stop(reason) {
  throw new Error(reason);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
