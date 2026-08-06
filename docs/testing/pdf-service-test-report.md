# PDF Creation Service production test report

## 1. Executive conclusion

**Not production ready for uncoordinated use by multiple applications.**

The service is reliable for small direct requests at low concurrency and has strong local controls for authentication, request validation, static HTML safety, blocked outbound resources, PDF parsing, caller-specific storage prefixes, and mocked failure cleanup. The checked-out source exactly matches the live production deployment.

The no-go reason is observed live concurrency behavior: the first controlled run returned `renderer_busy` for one of two simultaneous requests, and the final controlled run returned `renderer_busy` for two of ten simultaneous requests. The final run therefore had an 80% success rate at concurrency 10. The service recovered immediately after the stopped stage, but a shared service for multiple applications needs either reliable queuing or a documented and tested retry contract before callers can assume requests will complete.

Production stored-result behavior is also not cleared for release. The live diagnostic endpoint says storage variables are present, but production R2 writes, partial-write cleanup, recipient view/download links, expiration, and lifecycle deletion were not exercised because this task prohibited modifying production data. Those items remain blocked, not passed.

## 2. Repository, branch, and tested commit

- Repository: `https://github.com/ae47250/pdf-creator.git`
- Local checkout: `C:\Users\eiriksson\Documents\pdf-creator`
- Test branch: `codex/pdf-service-production-testing`
- Default branch: `main`
- Service source tested: `9e4858731276e49bc9db819ce4d85d7d96db3986` (`Fall back to local PDF rate limiting`)
- Baseline worktree: clean and exactly equal to `origin/main` before the test-only changes
- Live deployment commit: `9e4858731276e49bc9db819ce4d85d7d96db3986`

The regression files in this branch do not change the deployed renderer, API, authentication, storage, console, or Vercel configuration.

## 3. Live URL and test date

- Stable public alias: `https://a-three-coral-41.vercel.app/`
- Test date: 2026-08-05 EDT (2026-08-06 UTC)
- Vercel deployment: `dpl_kXEqXwJ51Xhf67kUztQr4L7usSnT`
- Deployment state and target: Ready, production
- Deployment-created time: 2026-08-02T17:17:38.048Z
- Deployment source: `ae47250/pdf-creator`, branch `main`, commit `9e4858731276e49bc9db819ce4d85d7d96db3986`

## 4. Architecture summary

The service is a Next.js 16.2.11 App Router application running Node.js 24.18.0. It uses npm with `package-lock.json`. `POST /api/v1/pdfs` accepts authenticated JSON containing completed self-contained HTML, a safe PDF filename, page settings, optional metadata, and optional storage/idempotency fields.

The renderer uses `puppeteer-core` 25.1.0 and `@sparticuz/chromium` 149.0.0. Local tests used Microsoft Edge 151.0.4129.59. The service statically parses HTML and CSS, inserts a restrictive content security policy, disables JavaScript, and intercepts non-`data:` browser requests. Normal documents use Chromium pagination. Documents containing non-nested `data-pdf-page` markers render each marked page separately and merge the PDFs with `pdf-lib` 1.17.1.

Bearer authentication maps server-only keys to five callers. Current and `_PREVIOUS` keys are accepted, short keys fail closed, and one key mapped to multiple caller identities fails closed. The manual console has separate password/session-cookie authentication and then invokes the configured `test` caller on the server. Stored results use private Cloudflare R2 through the S3 API. PDFs and optional rendered HTML are written before the manifest; report IDs use UUIDs; application artifact prefixes are caller-specific; recipient view/download routes use possession of an unguessable report URL rather than bearer authentication.

Hard implementation limits are 4,000,000 request bytes, 3,500,000 HTML bytes, 4,000,000 PDF bytes, 25 pages, 10,000 DOM elements, DOM depth 64, 2,000 CSS rules, 100 images, 20-second asset readiness, 30-second browser start, 90-second render, 15-second storage operation, and 120-second Vercel function duration. One renderer is allowed at a time in each function instance.

## 5. Test environment and limitations

Local environment:

- Windows, Node.js 24.18.0, npm 11.16.0
- Microsoft Edge 151.0.4129.59
- Poppler 25.07.0 (`pdfinfo`, `pdftotext`, and `pdftoppm`)
- Vitest 4.1.10 and Playwright 1.62.1
- No CI workflow exists in the repository
- `npm audit --omit=dev --audit-level=moderate`: zero known vulnerabilities
- Production build: pass; traced `/api/v1/pdfs` dependency set was 597 files and 138.51 MiB uncompressed, below the repository's documented 230 MiB fallback threshold

Live diagnostics confirmed Linux x64, Node.js 24.18.0, Next.js 16.2.11, Puppeteer 25.1.0, Chromium 149.0.0, storage variables present, console enabled, and no `CHROME_PATH` override.

Limitations:

- No production R2 write, stored recipient link, expiration, or lifecycle deletion was tested.
- No production settings, environment variables, firewall rules, domains, data, or deployments were changed.
- Vercel log redaction and production memory ceilings were not directly observable.
- Malicious URLs, local-file attempts, injected renderer/storage failures, large-payload abuse, and repeated failures ran locally or with mocks only.
- The reliability run was a small controlled check, not a capacity test.
- Visual results depend on the local browser and fonts. Screenshots are evidence for this pinned environment, not universal pixel baselines.

## 6. Results table

`Pass` means the stated observation passed in the named environment. `Blocked` is never treated as pass. Response times are wall-clock measurements from the newest successful local visual run or the final controlled live run.

| Test name | Environment | Expected | Actual | Result | HTTP | Time | Size | Pages | PDF validity | Download link | Visual | Notes |
|---|---|---|---|---|---:|---:|---:|---:|---|---|---|---|
| Fast regression | Local | Unit and contract suite passes | 71/71 passed | Pass | N/A | 13.07 s suite | N/A | N/A | N/A | N/A | N/A | Safe default local tier |
| Full Vitest regression | Local | Unit, integration, and real Chromium tests pass | 90/90 passed | Pass | Mixed | 24.86 s final suite | Mixed | 1-25 | Pass | Mock only | Selected PDFs separate | 15 test files |
| Failure injection | Mock | Controlled storage, timeout, cleanup, rate-limit behavior | 14/14 passed | Pass | N/A | 1.29 s suite | N/A | N/A | N/A | N/A | N/A | R2, renderer, idempotency, rate-limit mocks |
| Console browser flow | Local browser | Console renders and creates 3-page PDF | 1/1 passed | Pass | 200 | 8.5 s test | Nonzero | 3 | Pass | N/A | Pass | No key exposed to browser text |
| Production build and trace | Local build | Build succeeds and route trace remains under 230 MiB | Build passed; 138.51 MiB, 597 files | Pass | N/A | 13.7 s compile | 138.51 MiB trace | N/A | N/A | N/A | N/A | Next.js type/page generation also passed |
| Minimal report | Local API | 1 valid page with expected text | As expected | Pass | 200 | 1,972 ms | 28,367 B | 1 | Pass | N/A | Pass | Clean margins; no clipping |
| Academic report | Local API | 3 pages, text, tables, links, headers/footers | As expected | Pass | 200 | 1,974 ms | 109,596 B | 3 | Pass | N/A | Pass | All three pages inspected |
| Long flowing report | Local API | 5-15 pages and final sentinel | 9 pages, text found | Pass | 200 | 1,260 ms | 53,026 B | 9 | Pass | N/A | Not selected | Structural/text regression only |
| Table-heavy report | Local API | Repeated headers, no split rows, readable margins | 4 pages, rows 1-85 | Pass | 200 | 2,175 ms | 57,091 B | 4 | Pass | N/A | Pass | All pages inspected after using 0.5-inch PDF margins |
| Image/chart report | Local API | Embedded chart, list, and link render | As expected | Pass | 200 | 1,475 ms | 38,505 B | 1 | Pass | N/A | Pass | No broken image |
| Header/footer/page-break report | Local API | Exactly 2 fixed pages | 2 pages, text found | Pass | 200 | 1,295 ms | 65,704 B | 2 | Pass | N/A | Covered by academic visual | Fixed-page structure passed |
| Unicode/international report | Local API | International text and notation extract/render | As expected | Pass | 200 | 1,716 ms | 63,498 B | 1 | Pass | N/A | Pass | No black squares or visibly missing glyphs |
| Accented characters | Local API | Accented glyphs extract | Glyph sentinel found | Pass | 200 | 1,196 ms | 29,574 B | 1 | Pass | N/A | Not selected | Poppler concatenates adjacent glyphs during extraction |
| Economics notation | Local API | Greek letters, operators, subscripts render | Text sentinel found | Pass | 200 | 1,194 ms | 39,664 B | 1 | Pass | N/A | Covered by Unicode visual | Structural/text regression |
| Very short report | Local API | 1 valid page | As expected | Pass | 200 | 1,120 ms | 10,430 B | 1 | Pass | N/A | Not selected | Smallest successful fixture |
| Large permitted HTML | Local API | Under 3.5 MB HTML limit and renders | 1 valid page | Pass | 200 | 1,628 ms | 29,291 B | 1 | Pass | N/A | Not selected | Large inert CSS comment avoids repository bloat |
| Application Blue CSS | Local API | Only Blue content/style present | Distinct text, SHA, color, filename | Pass | 200 | 1,449 ms | 37,669 B | 1 | Pass | N/A | Pass | No Gold text/style |
| Application Gold CSS | Local API | Only Gold content/style present | Distinct text, SHA, color, filename | Pass | 200 | 1,493 ms | 37,243 B | 1 | Pass | N/A | Pass | No Blue text/style |
| Browser-recoverable malformed CSS | Local API | Behavior is deterministic | Accepted and rendered | Partial | 200 | Included in suite | Nonzero | 1 | Pass | N/A | Not selected | CSS parser does not surface recoverable parse errors |
| Malformed HTML | Local API | Controlled rejection | `unsafe_html` | Pass | 400 | Included in suite | N/A | N/A | N/A | N/A | N/A | Missing required complete-document structure |
| Empty/missing/invalid request | Local and live | Controlled validation errors | `invalid_request` | Pass | 400 | Not recorded | N/A | N/A | N/A | N/A | N/A | Error includes request ID, not HTML/key |
| Unauthorized request | Local and live | Controlled auth failure | `unauthorized` | Pass | 401 | Not recorded | N/A | N/A | N/A | N/A | N/A | No credential echoed |
| External/dangerous input | Local/mock | Fail closed | `unsafe_html`; outbound request aborted | Pass | 400 | Included in suite | N/A | N/A | N/A | N/A | N/A | Includes script, HTTPS image, internal URL interception |
| HTML over limit | Local API | Reject before rendering | `request_too_large` | Pass | 413 | Included in suite | >3,500,000 HTML B | N/A | N/A | N/A | N/A | Body and HTML limits tested |
| Production health | Live | Healthy JSON response | `status: ok` | Pass | 200 | 382 ms | 39 B | N/A | N/A | N/A | N/A | Stable alias |
| Production diagnostics | Live | Authenticated, redacted readiness | Versions and readiness returned | Pass | 200 | Not recorded | Small JSON | N/A | N/A | N/A | N/A | `storageReady: true`, `consoleEnabled: true` |
| Live concurrency 1 | Live | 100% valid direct PDF | 1/1 success | Pass | 200 | median/p95/max 578 ms | 12,133 B | 1 | Pass | N/A | Text checked | No contamination |
| Live concurrency 2 | Live | 100% valid direct PDFs | 2/2 success | Pass | 200 | median 3,083; p95/max 5,705 ms | 12,289-12,290 B | 1 each | Pass | N/A | Text checked | First earlier run had 1/2 success, showing variability |
| Live concurrency 5 | Live | 100% valid direct PDFs | 5/5 success | Pass | 200 | median 5,416; p95/max 5,878 ms | 12,302-12,448 B | 1 each | Pass | N/A | Text checked | No corruption/contamination |
| Live concurrency 10 | Live | 100% or safe automatic stop | 8/10 success; two `renderer_busy` | Fail | 200/429 | median 626; p95/max 5,526 ms | 12,182-12,387 B for successes | 1 each success | Pass for successes | N/A | Text checked | 20% HTTP error rate; escalation stopped |
| Post-429 recovery | Live | Service recovers for one request | 1/1 success | Pass | 200 | 687 ms | 12,280 B | 1 | Pass | N/A | Text checked | No contamination |
| Stored view/download workflow | Mock/live config | Upload, link, fetch, headers, expiry, cleanup | Mock logic passed; live data path not exercised | Blocked | N/A | N/A | N/A | N/A | Mock pass | Blocked live | N/A | Production-data safety boundary |

## 7. Reliability measurements

Final controlled live run:

| Concurrency | Requests | Success | Median | P95 | Maximum | Timeout rate | HTTP error rate | Corruption rate | Storage-link failures | Contamination |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 100% | 578 ms | 578 ms | 578 ms | 0% | 0% | 0% | Not tested | No |
| 2 | 2 | 100% | 3,083 ms | 5,705 ms | 5,705 ms | 0% | 0% | 0% | Not tested | No |
| 5 | 5 | 100% | 5,416 ms | 5,878 ms | 5,878 ms | 0% | 0% | 0% | Not tested | No |
| 10 | 10 | 80% | 626 ms | 5,526 ms | 5,526 ms | 0% | 20% | 0% | Not tested | No |

The low median at concurrency 10 includes two fast 429 responses and therefore must not be read as improved successful-render latency. The earlier controlled run stopped at concurrency 2 after one of two requests returned `renderer_busy`, while the final run passed concurrency 2 and 5. This variability is evidence that Vercel sometimes spreads work across instances but does not guarantee that simultaneous requests avoid the per-instance single-render guard.

No production capacity inference is justified from 18 final-stage render requests. The only supported conclusion is that the service can succeed at small batches but does not presently guarantee completion at concurrency 10.

## 8. Visual inspection findings

Every page selected for visual review was rendered to PNG with Poppler and inspected. The reviewed set contained 12 pages: minimal (1), academic (3), table-heavy (4), image/chart (1), Unicode/economics (1), Application Blue (1), and Application Gold (1).

- No cut-off or overlapping text was observed.
- No blank or duplicate pages were observed.
- The academic headers, footers, page numbers, and deliberate page divisions were consistent.
- The four-page table repeated its header row, kept rows readable, and used consistent 0.5-inch PDF margins after the fixture was corrected to request margins explicitly.
- The embedded SVG chart rendered sharply with the intended colors and no broken image indicator.
- International text, accents, Greek letters, operators, and subscripts were legible. The local fallback fonts handled the tested glyphs.
- Blue and Gold application fixtures had clearly different borders, backgrounds, labels, text, filenames, and PDF hashes. Neither contained the other application's text.
- HTTPS citation text rendered as links. Existing PDF-quality tests separately cover URI annotations.
- No unexpected scaling or substituted branding was observed.

The service does not promise automatic orphan-heading prevention beyond browser CSS. Calling applications remain responsible for appropriate `break-*`, `orphans`, `widows`, and margin rules.

## 9. Security and privacy findings

### Focused implementation review

| Area | Classification | Evidence and limitation |
|---|---|---|
| Request schema validation | Pass | JSON Schema rejects unknown fields, unsafe filenames, invalid types, and unsupported page settings; byte limits are enforced before render. |
| Bearer authentication | Pass | Current/previous keys, constant-time digest comparison, short-key failure, and duplicate-caller failure are tested. |
| API versus console separation | Pass | Browser receives no bearer key; console uses an HTTP-only signed session and server-side `test` caller. |
| Console authentication | Partial | Password comparison and same-origin checks pass, but production console is enabled and no login-attempt rate limit was identified. |
| HTML validation | Pass | Complete document required; active/form/media/embed elements and event handlers are rejected. |
| CSS validation | Partial | Imports and external URLs are rejected, but browser-recoverable malformed CSS is accepted without a parse-error finding. |
| Multi-application CSS isolation | Pass | Requests are self-contained and rendered in fresh pages; distinct Blue/Gold local results showed no content/style contamination. |
| JavaScript execution | Pass | Scripts/event handlers are rejected and Puppeteer JavaScript is disabled. |
| Remote images/fonts/stylesheets | Pass | External and relative resources are rejected; only validated embedded image/WOFF2 data URLs are allowed. HTTPS anchors remain inert PDF links. |
| SSRF and internal-network protection | Pass | Static URL checks plus browser request interception block outbound/internal requests; live malicious probes were intentionally not sent. |
| Local-file and path traversal | Pass | `file:` resources fail URL policy; filenames are ASCII-pattern restricted and cannot contain `..` or path separators. |
| Browser sandbox configuration | Partial | Chromium is launched with `--no-sandbox` and `--disable-setuid-sandbox`; other isolation layers reduce risk but do not replace the browser sandbox. |
| Payload/page/PDF limits | Pass | 4 MB request, 3.5 MB HTML, 4 MB PDF, 25 pages, DOM/CSS/image ceilings are enforced and tested. |
| Timeout controls | Pass | Browser start, asset readiness, render, storage, and close timeouts exist; late browser cleanup is tested. |
| Memory controls | Requires production configuration verification | No application memory ceiling was identified beyond Vercel runtime configuration and payload limits. |
| Concurrency controls | Fail | Per-instance guard returns `renderer_busy`; live 10-request stage produced 20% 429 errors. |
| Temporary resource cleanup | Partial | Browser/page close is tested. There are no application-created local temp files, but failed R2 cleanup is swallowed to preserve the original error and is not independently observable. |
| Unique object names/overwrite prevention | Pass | UUID report IDs, caller prefixes, manifest-last writes, conditional idempotency claims, and race tests passed locally/mocked. |
| Storage upload/failure handling | Partial | Partial-write cleanup and conditional races pass with mocks; production storage was not written. |
| Stored download/expiration/lifecycle | Requires production configuration verification | Routes and manifest deadlines exist; live links, 410 expiry, bucket privacy, and R2 lifecycle rules remain unverified. |
| Content-Type and Content-Disposition | Pass | Direct and stored routes set PDF type, safe inline/attachment filenames, no-store, and nosniff headers. |
| Error messages/status codes | Pass | Controlled 400/401/413/415/422/429/5xx mappings and opaque unexpected errors are covered. |
| Log privacy | Partial | Source logging excludes keys, HTML, filename, metadata, and stack traces; production log output was not directly inspected. |
| Dependency/runtime compatibility | Pass | Exact versions are pinned, local build/test runtime matches live Node/Next/Puppeteer/Chromium versions, and production dependency audit found zero known vulnerabilities. |
| Console accessibility/usability | Pass | Semantic labels/headings, live status, desktop layout, and 390-pixel mobile layout passed; no horizontal overflow or browser errors were observed. |
| Failed-request reproducibility/observability | Partial | Request IDs, correlation IDs, status/error codes, timing, byte/page headers, diagnostics, and structured logs exist; no durable metrics/tracing or live log review was confirmed. |

This is a focused security and failure review, not a professional penetration test.

## 10. Multi-application CSS-isolation result

**Pass locally; not proven for stored production artifacts.**

Application Blue and Application Gold submitted separate completed HTML documents with intentionally different CSS, content sentinels, filenames, background colors, border colors, and labels. Both returned HTTP 200, one valid page, distinct request IDs, distinct hashes, expected extracted text, and visually distinct PDFs. Blue contained no Gold sentinel and Gold contained no Blue sentinel.

Live concurrency sent a unique text sentinel in every request and extracted each successful PDF. No successful PDF contained another request's sentinel. Two requests at concurrency 10 failed with 429 before PDF creation, so there was no corrupt or contaminated success response.

## 11. Ranked findings

### Critical

None observed.

### High

1. **Concurrent completion is not reliable.** The final live concurrency-10 stage returned two `renderer_busy` 429 errors, and an earlier concurrency-2 stage returned one. This blocks a general multi-application production recommendation.
2. **The production stored-result workflow is not acceptance-tested.** R2 variables are present, but live writes, returned links, download headers, expiry, cleanup, bucket privacy, and lifecycle deletion remain unverified under the task's production-data prohibition.

### Medium

1. **Production console is enabled.** It is password gated and functionally separated, but the operations guide says to keep it disabled by default. No login brute-force control was found.
2. **Distributed rate-limit protection is unverified.** The code falls back to per-instance in-memory limits when the Vercel Firewall rule is unavailable. That is not a global caller limit.
3. **Chromium runs without its OS sandbox.** Static sanitization, disabled JavaScript, and network interception help, but this remains defense-in-depth loss.
4. **Malformed CSS validation is tolerant.** Some syntactically incomplete declarations render instead of returning a validation error, reducing predictability.
5. **Failed artifact cleanup is not independently observable.** Cleanup failures are swallowed so the original storage error wins, potentially leaving orphaned objects without a dedicated log/metric.

### Low

1. Operations documentation says the console cookie lasts eight hours; code uses two minutes.
2. Operations documentation lists five per-caller Firewall rule IDs; code uses one shared `pdf-creation` rule with caller identity as the key.
3. The repository has no CI workflow, so fast regressions are not automatically enforced on pull requests.

### Informational

1. Dependencies are exact-pinned and the production dependency audit found zero known vulnerabilities.
2. The deployed commit exactly matches the tested service source.
3. Local visual and structural coverage is broad and reproducible without byte-for-byte PDF comparisons.

## 12. Blocked or untestable items

- Production R2 upload and recipient link workflow
- Production R2 partial-write cleanup and orphan detection
- Exact one-, seven-, and 30-day recipient expiry behavior
- R2 lifecycle deletion and bucket-public-access configuration
- Vercel Firewall rule existence, global rate-limit behavior, and plan enforcement
- Production log redaction, retention, alerts, and traces
- Production memory ceiling and out-of-memory behavior
- Browser crash and dependency-outage behavior in Vercel
- High concurrency, sustained load, and capacity
- Large-payload abuse or repeated intentional production failures
- Professional penetration testing

## 13. Recommended fixes in priority order

1. Make concurrent completion reliable. Add a bounded queue or platform configuration that guarantees one render per isolated worker, return `Retry-After` on transient busy responses, and publish a tested exponential-backoff/idempotency contract for every caller.
2. Create separately approved disposable R2 acceptance infrastructure. Test write, manifest-last behavior, returned view/download links, integrity, 410 expiry, lifecycle deletion, partial upload cleanup, and cleanup-failure observability without touching production data.
3. Verify the Vercel Firewall rule in production and prove that rate limits are global per caller. Do not describe the in-memory fallback as a distributed limit.
4. Disable the production console unless there is a current operational need. If it remains enabled, add rate limiting for login attempts and document the actual two-minute session lifetime.
5. Treat CSS parser recovery events as controlled validation errors, or document explicitly which recoverable CSS is supported and add deterministic tests for it.
6. Evaluate restoring the Chromium sandbox or moving rendering into a stronger isolated execution boundary. Preserve JavaScript disablement and outbound interception either way.
7. Emit a redacted cleanup-failure event/metric without masking the original storage failure.
8. Correct the operations documentation and add a non-production CI workflow for `npm.cmd run test:fast` plus pinned-browser local integration where available.

## 14. Go/no-go recommendation

**No-go for production use by multiple independent applications today.**

The service may remain available for controlled low-volume direct rendering with caller retries and close monitoring, but it should not be presented as reliably production ready for multiple applications until concurrency completion and the stored-result workflow pass acceptance. No deployment or merge was performed as part of this task.

## 15. Reproduction commands

```powershell
cd C:\Users\eiriksson\Documents\pdf-creator

git fetch --prune origin
git status --short --branch
git rev-parse HEAD

npm.cmd ci
npm.cmd run test:fast
npm.cmd run test:mocks
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:browser
npm.cmd run test:visual

# Manual only. Uses configured environment variables and storeResult=false.
npm.cmd run test:live

npm.cmd run test:report
```

If Poppler is not on `PATH`, set `PDFTOTEXT_PATH` and `PDFTOPPM_PATH` to the installed executables. If Chrome or Edge is not auto-detected, set `CHROME_PATH`. Never place secret values in commands, fixtures, reports, screenshots, or commits.
