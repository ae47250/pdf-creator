import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { POST } from '@/app/api/v1/pdfs/route';
import { nativeFixedReportHtml } from '../helpers/native-fixed-report';
import { TEST_BEARER_KEY } from '../regression/fixtures';
// @ts-expect-error The runtime helper is deliberately plain ESM for Node and Playwright.
import { extractTextFromBytes } from '../../scripts/pdf-test-utils.mjs';

const maximumAttempts = 5;
const admissionDeadlineMs = 15_000;
const retryDelayMs = 1_000;
const originalTestKey = process.env.PDF_CREATION_TEST;
const routeEvents: Array<Record<string, unknown>> = [];

interface AttemptEvidence {
  attempt: number;
  status: number;
  errorCode: string | null;
  retryAfter: string | null;
  durationMs: number;
}

interface LogicalResult {
  sentinel: string;
  initialStatus: number;
  attempts: AttemptEvidence[];
  elapsedMs: number;
  finalStatus: number;
  finalError: string | null;
  pdf?: Uint8Array;
  pageCount?: number;
  pageDimensions?: string;
  sha256?: string;
  text?: string;
}

describe.sequential('same-process concurrent render qualification', () => {
  beforeAll(() => {
    process.env.PDF_CREATION_TEST = TEST_BEARER_KEY;
    vi.spyOn(console, 'info').mockImplementation((message) => {
      if (typeof message === 'string') routeEvents.push(JSON.parse(message) as Record<string, unknown>);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (originalTestKey === undefined) delete process.env.PDF_CREATION_TEST;
    else process.env.PDF_CREATION_TEST = originalTestKey;
  });

  it('characterizes two simultaneous eight-page logical operations under the caller retry contract', async () => {
    const sentinels = ['CONCURRENT-ALPHA', 'CONCURRENT-BRAVO'];
    const results = await Promise.all(sentinels.map(runLogicalOperation));
    const successful = results.filter((result) => result.finalStatus === 200);
    const failed = results.filter((result) => result.finalStatus !== 200);

    expect(results.map((result) => result.initialStatus).sort()).toEqual([200, 429]);
    expect(results.reduce((total, result) => total + result.attempts.length, 0)).toBeLessThanOrEqual(10);
    expect(successful.length).toBeGreaterThanOrEqual(1);

    for (const result of successful) {
      const pdf = await PDFDocument.load(result.pdf!, { updateMetadata: false });
      expect(result.pageCount).toBe(8);
      expect(pdf.getPageCount()).toBe(8);
      expect(result.pageDimensions).toBe('612x792');
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.text).toContain(result.sentinel);
      for (const other of sentinels.filter((sentinel) => sentinel !== result.sentinel)) {
        expect(result.text).not.toContain(other);
      }
    }

    for (const result of failed) {
      expect(result.finalError).toBe('maximum-attempts-exhausted');
      expect(result.attempts).toHaveLength(maximumAttempts);
      expect(result.attempts.every((attempt) => attempt.status === 429 && attempt.errorCode === 'renderer_busy')).toBe(true);
    }

    const completedRender = routeEvents.find((event) => event.event === 'pdf_complete');
    expect(completedRender).toMatchObject({
      rendererSource: 'installed',
      layoutObservationCount: 0
    });
    expect(completedRender?.rendererProduct).toMatch(/Chrome|Chromium|Edg/i);
    expect(completedRender?.rendererVersion).toMatch(/^\d+(?:\.\d+)+$/);

    console.log(`CONCURRENCY_EVIDENCE ${JSON.stringify({
      renderer: {
        source: completedRender?.rendererSource,
        product: completedRender?.rendererProduct,
        version: completedRender?.rendererVersion
      },
      results: results.map(withoutPdf)
    })}`);
  }, 90_000);
});

async function runLogicalOperation(sentinel: string): Promise<LogicalResult> {
  const started = performance.now();
  const deadline = started + admissionDeadlineMs;
  const attempts: AttemptEvidence[] = [];

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (attempt > 1 && performance.now() >= deadline) {
      return failure('admission-deadline-exhausted', sentinel, started, attempts);
    }
    const attemptStarted = performance.now();
    const response = await POST(await routeRequest(sentinel));
    const durationMs = Math.round(performance.now() - attemptStarted);
    const contentType = response.headers.get('content-type') ?? '';

    if (response.status === 200 && contentType.includes('application/pdf')) {
      const pdf = new Uint8Array(await response.arrayBuffer());
      return {
        sentinel,
        initialStatus: attempts[0]?.status ?? 200,
        attempts: [...attempts, { attempt, status: 200, errorCode: null, retryAfter: null, durationMs }],
        elapsedMs: Math.round(performance.now() - started),
        finalStatus: 200,
        finalError: null,
        pdf,
        pageCount: Number(response.headers.get('x-pdf-page-count')),
        pageDimensions: response.headers.get('x-pdf-page-dimensions') ?? undefined,
        sha256: response.headers.get('x-pdf-sha256') ?? undefined,
        text: await extractTextFromBytes(pdf)
      };
    }

    const body = contentType.includes('json') ? await response.json() as { error?: { code?: string } } : {};
    const evidence = {
      attempt,
      status: response.status,
      errorCode: body.error?.code ?? null,
      retryAfter: response.headers.get('retry-after'),
      durationMs
    };
    attempts.push(evidence);
    if (response.status !== 429 || evidence.errorCode !== 'renderer_busy') {
      return failure(evidence.errorCode ?? 'unexpected-error', sentinel, started, attempts);
    }
    expect(evidence.retryAfter).toBe('1');
    if (attempt === maximumAttempts) return failure('maximum-attempts-exhausted', sentinel, started, attempts);
    if (performance.now() + retryDelayMs >= deadline) {
      return failure('admission-deadline-exhausted', sentinel, started, attempts);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return failure('maximum-attempts-exhausted', sentinel, started, attempts);
}

async function routeRequest(sentinel: string): Promise<Request> {
  return new Request('http://127.0.0.1:3202/api/v1/pdfs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TEST_BEARER_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      html: await nativeFixedReportHtml(sentinel),
      filename: `${sentinel}.pdf`,
      storeResult: false,
      storeHtml: false,
      page: {
        format: 'Letter',
        orientation: 'portrait',
        marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      expectedPageCount: 8,
      correlationId: sentinel
    })
  });
}

function failure(
  finalError: string,
  sentinel: string,
  started: number,
  attempts: AttemptEvidence[]
): LogicalResult {
  return {
    sentinel,
    initialStatus: attempts[0]?.status ?? 0,
    attempts,
    elapsedMs: Math.round(performance.now() - started),
    finalStatus: attempts.at(-1)?.status ?? 0,
    finalError
  };
}

function withoutPdf(result: LogicalResult): Omit<LogicalResult, 'pdf' | 'text'> & { textContainsOwnSentinel: boolean } {
  const { pdf: _pdf, text, ...evidence } = result;
  void _pdf;
  return { ...evidence, textContainsOwnSentinel: Boolean(text?.includes(result.sentinel)) };
}
