# PDF service regression testing

This test system separates safe local checks, mocked failure checks, visual artifact generation, and controlled live checks. Nothing in the repository schedules production traffic. The live command must be started manually.

## Required software

- Node.js 24.x
- Dependencies installed with `npm ci`
- Local Chrome or Edge for renderer and browser tests
- Poppler commands `pdftotext` and `pdftoppm` for text extraction and page rendering

Set `CHROME_PATH`, `PDFTOTEXT_PATH`, or `PDFTOPPM_PATH` only when the commands are not discoverable automatically.

## Commands

```powershell
# Unit and contract checks without Chromium rendering
npm.cmd run test:fast

# Mocked storage, timeout, rate-limit, and cleanup failures
npm.cmd run test:mocks

# Type checking, lint, all Vitest checks, console browser check, and visual generation
npm.cmd run test:full

# Generate local PDFs and render selected PDFs page-by-page to PNG
npm.cmd run test:visual

# Manually run the protected Preview reliability check
npm.cmd run test:preview

# Manually run the isolated test-R2 workflow
npm.cmd run test:preview:storage

# Summarize the newest local and live JSON evidence
npm.cmd run test:report

# Inspect audit tools and immutable fixture inputs without rendering
npm.cmd run audit:preflight

# Prove that the quality-audit harness detects deliberately bad evidence
npm.cmd run audit:self-test

# Run the compact PR A audit locally and write a raw-count baseline
npm.cmd run audit:core

# Rebuild the compact Markdown report from the latest audit evidence
npm.cmd run audit:report
```

## Metrics-only quality audit

The complete PR A corpus, evidence, reference, tool-preflight, Preview-budget,
and artifact rules are documented in [pdf-quality-audit.md](./pdf-quality-audit.md).

The PR A quality audit is a measurement tool, not a release gate. A bad PDF, a
visual mismatch, a low percentage, or even zero correct fixtures is recorded as
evidence and never stops the remaining authorized cases. The runner stops only
for safety, authorization, credential, cost/request-budget, external-service,
or genuine technical-impossibility reasons.

The report keeps these units separate:

- unique fixture IDs;
- logical executions, including repeatability runs;
- actual request attempts.

For the supported basic-PDF category it reports raw counts and exact fractions
for PDF production, structural validity, and correct rendering. Unsupported
features, documented policy rejections, known defects, environmental limits,
and audit-tool limits remain separate and cannot be counted as successful
supported PDFs.

Generated evidence is written only under
`test-artifacts/pdf-quality-audit/<run-id>/`. The directory is ignored. Do not
clean the broader `test-artifacts/` tree because it also contains independent
lifecycle evidence.

The manual PR A Preview command is `npm.cmd run audit:preview`. It is limited to
at most two preflight GETs and seven sequential POST attempts (nine requests
total), uses only
`storeResult:false` and `storeHtml:false`, performs no retry, and never invokes
the storage workflow. It requires an independently verified branch-deployment
hostname pin in `PDF_CREATION_PREVIEW_HOST_SHA256` before any bearer credential
is sent. Missing Preview credentials make that evidence lane unavailable; they
do not invalidate the local audit.

The older regression and reliability suites use the separate
`test-artifacts/pdf-regression/` artifact tree. That directory is also excluded
from Git because its reproducible PDFs, PNGs, and JSON measurements can be bulky.

## Test tiers

### Safe for every local run

- Request-schema and payload-limit checks
- Authentication and authorization checks with fictional keys
- HTML, CSS, URL, SVG, and embedded-resource safety checks
- PDF signature, parsing, page size, page count, metadata, and SHA-256 checks
- Local Chromium conversion of all successful fixtures
- Separate application CSS/content/filename checks

### Requires local environment variables

- The development console uses the fictional `PDF_CREATION_TEST` value supplied by Playwright.
- Stored-result tests need local or disposable R2 configuration. The current automated storage suite uses mocks and does not write to production R2.

### Mock or failure-injection only

- Renderer launch timeout and late-browser cleanup
- Outbound request interception
- Storage write failures, partial uploads, cleanup errors, and conditional-write races
- Missing or invalid Firewall fail-closed behavior
- High concurrency, browser crashes, local-file attempts, internal-network attempts, and repeated intentional failures

### Controlled Preview execution only

The live runner reads these environment-variable names without printing their values:

```text
PDF_CREATION_PREVIEW_URL
PDF_CREATION_PREVIEW_HOST_SHA256
PDF_CREATION_PREVIEW_KEY
PDF_CREATION_PREVIEW_TIMEOUT_MS
PDF_CREATION_PREVIEW_MAX_LATENCY_MS
PDF_CREATION_PREVIEW_STAGE_DELAY_MS
PDF_CREATION_PREVIEW_ROUND_DELAY_MS
VERCEL_AUTOMATION_BYPASS_SECRET
```

The runners have no Production URL or credential fallback. They block unless the explicit Preview URL and key are present. The PR A quality-audit runner also requires the independently verified hostname pin. The bypass secret is used only to pass Preview Deployment Protection and is never printed.

The runner sends one ordinary unauthorized request and one invalid request, then runs concurrency 1, 2, 5, and 10 three times with at least 61 seconds between complete rounds. All payloads are small and fictional and use `storeResult: false`. A request retries only `429 renderer_busy`, requires `Retry-After: 1`, uses at most five attempts and a 15-second admission deadline, and applies the documented full-jitter delay. It never retries `rate_limited`, a timeout, or an ambiguous 5xx. Acceptance requires 100% eventual success, no corruption/contamination/timeouts, warm eventual p95 at most 15 seconds, maximum eventual completion at most 30 seconds, and successful recovery.

### Isolated storage harness

The storage runner additionally requires the R2 service variables plus `PDF_CREATION_R2_EXPECTED_TEST_BUCKET_NAME`, `PDF_CREATION_R2_PRODUCTION_BUCKET_NAME`, and the local-only `PDF_CREATION_R2_LIFECYCLE_READ_TOKEN`. The lifecycle token must be a Cloudflare `Workers R2 Storage Read` token and must never be added to Vercel, the Preview runtime, Production, or the PDF service. It requires `PDF_CREATION_R2_ENVIRONMENT=test` and exact configured/approved test-bucket identity. Using the existing bucket-scoped Object Read & Write S3 credentials and endpoint, it first requires `HeadBucket` test = HTTP 200 and then `HeadBucket` Production = exactly HTTP 403. Any other result stops before writes. It never sends a modifying Production request.

After isolation, the runner performs one read-only Cloudflare API `GET` for the approved test bucket’s lifecycle configuration. It validates the required retention and idempotency rules, then exercises stored requests with and without HTML, replay, conflict, an identical-request race, view/download disposition and integrity, conditional collision preservation, exact 410 expiry, and interrupted cleanup; then removes exact run-owned reports/manifests/artifacts/idempotency mappings. It leaves only three test-bucket lifecycle canaries. Their private local ledger contains exact prefixes, creation timestamps, expected expirations, and scheduled observations. The ledger lives under ignored `test-artifacts`; summaries and committed reports contain only redacted counts. The lifecycle API request is never sent to the Production bucket, and no lifecycle-modifying request is issued.

All canaries are test-bucket-only. Observe retention-1 on day 3, retention-7 on day 9, and retention-30 on day 32. Day 3 is the Production-readiness gate for test-bucket retention-1 deletion only. Day 32 qualifies the complete test-bucket lifecycle. Production deletion remains unverified until a later separately authorized Production observation.

## Adding an application-specific fixture

1. Add a `SuccessFixture` entry in `tests/regression/fixtures.ts`.
2. Keep the application's CSS inside that fixture's completed HTML. Do not add application business logic to the service.
3. Use fictional content and embedded data URLs only.
4. Add unique expected-text sentinels and an honest page-count range.
5. Set `visual: true` when the fixture should be rendered page-by-page for manual review.
6. Run `npm.cmd run test:full` and inspect every generated PNG for that fixture.

## Interpreting results

- A passing fast or mock suite proves only local deterministic behavior.
- A passing visual generator proves that Poppler could parse and render the selected PDFs; a person must still inspect the page images.
- A passing controlled live stage proves only that small batch at that time. It is not a capacity test.
- A blocked test stays blocked. Do not convert missing credentials, missing production configuration, or intentionally excluded production-data checks into passes.

## Continuous integration

This repository currently has no continuous-integration workflow. No Preview, storage, or visual test runs automatically. If CI is added later, use `test:fast` by default and run local Chromium tests only on a runner with a pinned browser. Keep both Preview commands manual and outside scheduled or pull-request workflows.

## Known limitations

- The CSS parser accepts some browser-recoverable malformed CSS instead of rejecting it.
- The service deliberately allows one Chromium render at a time per function instance and returns `renderer_busy` when a second request reaches the same instance.
- Visual results depend on the installed browser and fonts; pin those components before using screenshots as formal baselines.
- Production lifecycle deletion, Vercel logs, and production memory ceilings are not proven by local tests or test-bucket canaries.
