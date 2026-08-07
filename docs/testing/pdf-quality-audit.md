# PDF quality audit (PR A)

## Purpose and nonblocking rule

This audit measures the PDF service. It does not decide whether a caller may be
activated or whether a Production release may proceed. Every authorized fixture
runs even when earlier fixtures return errors, corrupt PDFs, visual mismatches,
poor performance, or a 0% correctness result. Those outcomes create findings
and remediation priorities; they never suppress the remaining fixtures, the
raw-count report, or completion of the audit.

Only a safety risk, authorization boundary, credential problem, cost or request-
budget limit, platform protection, external-service restriction, or genuine
technical impossibility can stop the affected lane. When a single test cannot
proceed safely, it is labeled unavailable or incomplete and every other safe,
authorized test continues.

## Test lanes

| Lane | Command | Exact PR A scope | Automatic? |
|---|---|---|---|
| Relevant local audit change | `npm.cmd run audit:self-test` | 13 harness tests with deliberately corrupt, incorrect, failed, safety-limited, policy-mismatched, repeated, host-pinning, limitation-counting, and sensitive mock evidence | Run for every harness/schema/reporting change |
| Local real route | `npm.cmd run audit:core` | All 17 unique compact cases expanded to 24 sequential POST executions through the real route handler | Run before PR A review and after relevant changes |
| Continuous integration | `npm.cmd run test:fast` plus `npm.cmd run audit:self-test` | Deterministic contract/regression and harness checks; no Preview, storage, or reference updates | Recommended if CI is later added; this repository currently has no workflow |
| Vercel Preview | `npm.cmd run audit:preview` | Exactly 2 safety GETs and at most 7 sequential POST attempts described below | Manual, credentialed, Preview-only |
| PR B only | Not part of PR A | Expanded corpus, sanitized caller templates if approved, broader concurrency, controlled performance, optional comparison engines, expanded fonts/pagination/charts/accessibility/security | Only after PR A review and merge |
| Separately authorized | No PR A command | Production-like/load tests, paid or credentialed competitors, external document transmission, Production checks or settings | Never implied by this audit |

All existing regression suites remain independent commands. Run them separately
so a failure in one command cannot prevent later authorized suites from running.

## Compact immutable corpus

The manifest is `tests/quality-audit/manifest.v1.json`; its schema is
`tests/quality-audit/schema.v1.json`. Every source has a committed SHA-256 and
the loader rejects an accidental source change before execution.

| Category | Unique IDs | Local executions |
|---|---|---:|
| Supported basic PDF | `A-BASIC-01`, `A-FLOW-01`, `A-FIXED-01`, `A-TABLE-01`, `A-ASSET-01`, `A-TEXT-01`, `A-FULL-ACADEMIC-01`, `A-FULL-SERVICE-01`, `A-FULL-JOB-01`, `A-FULL-PATHWAY-01` | 10 |
| Documented policy rejection | `A-SEC-SCRIPT-01`, `A-SEC-URL-01`, `A-SEC-LOCAL-01` | 3 |
| Unsupported capability | `A-UNSUP-MIXED-01` | 1 |
| Cross-request isolation | `A-ISO-PAIR-01` | 4 (service/job/service/job) |
| Repeatability | `A-DET-BASIC-01`, `A-DET-FIXED-01` | 3 + 3 |
| **Total** | **17 unique fixtures** | **24 executions** |

The application-style cases and caller identity are synthetic. No PathFinder,
EconPlanner, Job Search, Tree Service, or real user document is accessed in PR A.

## Expected-outcome classifications

Every fixture uses exactly one intended-result classification:

- `supported-and-expected-to-pass`
- `intentionally-rejected-by-documented-policy`
- `unsupported-feature`
- `known-service-defect`
- `environmental-limitation`
- `audit-fixture-or-tool-limitation`

A known defect cannot become a quality pass because its observed error matched
the fixture. The harness may pass its own detection test, but the service result
stays failed or degraded in service-quality metrics. Likewise, unsupported and
documented rejection cases remain separate from successful supported PDFs. The
audit does not invent error classes for fonts, assets, pagination, or media.

## Correctness, repeatability, and thresholds

Exact deterministic assertions cover HTTP status, PDF signature and parseability,
page count, per-page text placement, required/forbidden extracted text, repeated
table headers, text order, nonblank pages, and declared metadata. Page sizes use
a provisional ±1-point comparison to accommodate representation rounding. That
tolerance only labels a PR A finding and is not authoritative.

Four essential pages use compact approved visual references under
`tests/quality-audit/references/`. Approval requires an immutable synthetic
fixture, original-resolution visual review, explicit geometry/text checks, a
review record, fixed source/image hashes, and a deliberate pull-request diff.
The runner only writes candidates to ignored artifacts and cannot approve or
update a reference. This prevents accidental baseline acceptance.

When a fixture or caller requires visually repeatable typography across local
and Vercel environments, it must embed or otherwise supply its own pinned font
files. `A-BASIC-01` demonstrates this with a compact, open-licensed Open Sans
v44 Latin WOFF2 `data:` font. The service does not set a service-wide default
font and does not rewrite caller HTML; external font URLs remain disallowed.

Comparing two new outputs from the service establishes repeatability only. It
does not establish correctness. The result labels byte, structural, text, and
raster repeatability separately from comparison with a reviewed reference.

Threshold development follows this later sequence:

1. Run repeated controlled baselines.
2. Measure normal variation by operating system, browser/font stack, Poppler
   version, and fixture type.
3. Propose tolerances supported by those measurements.
4. Review and document the proposed tolerances.
5. Freeze them in a later deliberate change as interpretation/reporting
   thresholds only.

No SSIM, pixel, text-similarity, latency, concurrency, score, or correctness
percentage is a release gate or audit stop condition. Performance is
informational in PR A.

## Tool-availability preflight

`npm.cmd run audit:preflight` performs read-only discovery before rendering. It
records Node.js and npm, the browser, Puppeteer/Chromium pins, Poppler tools,
required fonts, exact-raster comparison capability, operating-system/CI facts,
and Vercel runtime constraints. It also probes qpdf, veraPDF, MuPDF,
WeasyPrint, and Vivliostyle as optional tools.

Each tool is classified as required and available, required and repository-
installable, optional, unavailable without separate authorization, or unsuitable
for the environment. Missing optional tools reduce evidence coverage; they do
not block the core PR A audit. The preflight does not install operating-system
packages, large native dependencies, paid/proprietary tools, credentials, or
external services. Adobe Acrobat is not assumed.

## Exact PR A Preview budget

The Preview lane is manual and uses an explicit `.vercel.app` HTTPS origin with
no custom port, user information, path, query, or fragment. It has no Production
URL or credential fallback. Before any credential is sent,
the operator independently verifies the branch deployment through Vercel and
sets `PDF_CREATION_PREVIEW_HOST_SHA256` to the SHA-256 of that verified lowercase
hostname. The runner recomputes and compares the host pin; the URL and pin are
ephemeral and are not persisted in evidence.

- Safety preflight: one `GET /api/health` and one authenticated
  `GET /api/v1/diagnostics` (2 GETs maximum). If health is unsafe, the lane
  stops after that first GET and does not send the bearer credential.
- POST fixtures in order: `A-BASIC-01`, `A-FLOW-01`, `A-FIXED-01`,
  `A-FULL-ACADEMIC-01` three times, and `A-SEC-URL-01` (7 POSTs maximum).
- Total request ceiling: 9 requests (2 GETs + 7 POSTs). A successful safety
  preflight uses both GETs; a health-preflight stop uses only one.
- Concurrency: 1. Start spacing: 2 seconds. Retries: none.
- Cold/warm method: no restart is forced. The first academic request is labeled
  cold-eligible; the next two are warm-eligible. Actual Vercel instance reuse is
  not claimed.
- Maximum serialized request: 100,000 bytes. Maximum PDF response: 4,000,000
  bytes. Maximum JSON response: 65,536 bytes. Per-request timeout: 120 seconds.
- Estimated runtime: approximately 3–15 minutes, bounded by seven sequential
  timeouts plus six start spacings.
- Every initiated POST consumes one slot, including a failed, timed-out,
  incorrect, corrupt, or rejected response. No result earns a retry.
- The bearer key and optional Deployment Protection bypass are read from
  environment variables and never printed or persisted.
- Diagnostics must identify the synthetic `test` caller and exactly the `test`
  storage environment before POSTs begin.
- Every body fixes `storeResult:false` and `storeHtml:false`; the storage test
  command is never invoked, so the lane performs no Production R2 write.
- Evidence is labeled `vercel-preview-evidence`, never Production evidence.

Missing credentials, a non-Preview target, failed platform protection, unsafe
diagnostics, or a request-size budget violation may stop the affected Preview
lane. A low score, fixture failure, HTTP 500, visual mismatch, corruption, or
latency observation never stops the remaining POSTs once the safe POST lane has
begun.

## Metrics and report interpretation

Unique fixture results are reported separately from total logical executions
and actual request attempts. Repeating one fixture never creates extra unique
PDF successes.

For supported basic PDFs:

- **PDF-production rate** = unique fixtures returning HTTP 200,
  `application/pdf`, and a PDF signature / unique executed supported basic
  fixtures.
- **Structural-validity rate** = unique fixtures producing a PDF parseable with
  at least one page / unique executed supported basic fixtures.
- **Correct-rendering rate** = unique fixtures satisfying every required
  structural, textual, geometric, metadata, and approved visual expectation /
  unique executed supported basic fixtures.

Every report includes raw counts and exact numerator, denominator, and percentage
for those rates. It also reports attempted, executed, incorrect, failed,
unsupported, intentionally rejected, unavailable, severity, cause, and concise
reasons. A composite descriptive score can accompany those rows but never
replace them. The supported-basic row directly answers: “How many basic PDFs did
the service get right?”

Fixture/input-scope execution coverage is reported separately from actual
evidence availability. The first only says which declared compact inputs ran.
The second counts collected core evidence and unavailable optional tool evidence;
missing optional tools lower that descriptive fraction without blocking the run.

## Artifacts, privacy, and Production boundaries

Generated PDFs, full raster sets, raw checkpoints, and logs stay under ignored
`test-artifacts/pdf-quality-audit/<run-id>/`. Do not clean the broader
`test-artifacts/` tree; it contains independent lifecycle evidence. Git may
contain only the compact synthetic fixtures, reviewed size-limited references,
schema, harness/tests, documentation, and sanitized aggregate baseline.

Never commit credentials, authorization headers, signed URLs, target URLs, raw
HTML payloads, real documents, generated PDFs, oversized screenshots, or
sensitive artifacts. The runner recursively redacts credential/URL/HTML fields
before persisting evidence.

PR A does not change Production R2, environment variables, credentials, buckets,
lifecycle rules, domains, Firewall, deployment settings, or caller activation.
It does not disturb retention-1, retention-7, or retention-30 canaries and does
not wait for their future observations. It does not claim that current
Production lifecycle configuration is fully qualified or that future lifecycle
observations passed.

## Adding or changing a fixture

1. Use fictional, inline-only HTML and keep the case compact.
2. Add the source under `tests/quality-audit/fixtures/` and calculate SHA-256.
3. Add one manifest case with its real intended-result classification, explicit
   request, structural/text/metadata/geometry expectations, and no storage.
4. Add it to only the approved profiles; expanded profile size must remain at or
   below its request budget.
5. If a visual reference is materially necessary, follow the separate reviewed
   reference policy. Do not let the runner accept its own candidate.
6. Run preflight, self-tests, the full compact audit, and every existing
   regression suite. Inspect the final diff and artifact boundary.

Representative caller templates, access to other repositories, optional native
or comparison tools, competitor services, paid credentials, external document
transmission, provisional tolerance approval, and Production-like/load tests all
remain explicit later decisions. PR B begins only after PR A is reviewed and
merged from then-current `origin/main`. Confirmed service defects belong in
focused later remediation pull requests; after remediation, rerun the complete
benchmark before making broader quality claims.

No minimum quality result blocks this audit. Caller activation and Production
release are separate decisions made from the evidence later.
