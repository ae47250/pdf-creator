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

# Manually run the rate-limited production reliability check
npm.cmd run test:live

# Summarize the newest local and live JSON evidence
npm.cmd run test:report
```

Generated PDFs, PNGs, and JSON measurements are written under `test-artifacts/pdf-regression/`. The directory is intentionally excluded from Git because the files are reproducible and can be bulky.

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

### Controlled live execution only

The live runner reads these environment-variable names without printing their values:

```text
PDF_CREATION_LIVE_URL
PDF_CREATION_LIVE_KEY
PDF_CREATION_ECONPLANNER
PDF_CREATION_LIVE_TIMEOUT_MS
PDF_CREATION_LIVE_MAX_LATENCY_MS
PDF_CREATION_LIVE_STAGE_DELAY_MS
```

`PDF_CREATION_LIVE_KEY` takes priority; `PDF_CREATION_ECONPLANNER` is the approved fallback for this repository's current configured environment. The default URL is the documented production alias.

The runner sends one ordinary unauthorized request and one invalid request, then attempts concurrency 1, 2, 5, and 10. It never exceeds ten concurrent requests. It stops escalation after any 429, 5xx, timeout, corrupt PDF, cross-request contamination, HTTP error, or response over the configured healthy-latency ceiling. After stopping, it sends one single-request recovery probe. All payloads are small, fictional, and use `storeResult: false`.

The live runner does not test production R2, lifecycle deletion, stored view/download links, deliberate renderer crashes, large payload abuse, or sustained capacity. Those checks require separately approved disposable infrastructure or production-data authorization.

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

This repository currently has no continuous-integration workflow. No live or visual test runs automatically. If CI is added later, use `test:fast` by default and run local Chromium tests only on a runner with a pinned browser. Keep `test:live` manual and outside scheduled or pull-request workflows.

## Known limitations

- The CSS parser accepts some browser-recoverable malformed CSS instead of rejecting it.
- The service deliberately allows one Chromium render at a time per function instance and returns `renderer_busy` when a second request reaches the same instance.
- Visual results depend on the installed browser and fonts; pin those components before using screenshots as formal baselines.
- Public stored-report links, R2 lifecycle behavior, Vercel logs, and production memory ceilings are not proven by local tests.
