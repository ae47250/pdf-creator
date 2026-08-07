# PDF quality audit — PR A compact baseline

Run `pr-a-local-2026-08-07T04-48-05-399Z` completed all 24 planned local
executions across 17 unique fixtures. This is local worktree evidence from the
verified PR #6 base commit `074b3fdf754b3eca806f13d2fa16e4327b8cc5a1`.

> This is a measurement report, not a release gate. No score, percentage,
> defect count, fixture result, visual mismatch, or performance result can
> block audit completion.

## Direct answer

The service got **10 of 10 executed supported basic PDFs correct (10/10,
100.00%)** in this compact PR A local lane.

All ten returned a PDF, all ten were structurally valid, and all ten satisfied
their required structure, extracted text, page dimensions, machine-checked
page placement/order/nonblank-page expectations, metadata, and any assigned
reviewed visual reference. Four fixtures used approved compact reference
images; the others used explicit structural, textual, and geometric
expectations. This does not establish overall service, accessibility,
competitor, load, Preview, Production, or release quality.

## Raw unique-fixture results

| Fixture category | Unique fixtures attempted | Unique fixtures executed | Not executed | PDFs produced | Structurally valid PDFs | Correctly rendered PDFs | Incorrectly rendered PDFs | Failed PDF generations | Unsupported fixtures | Intentionally rejected fixtures | Environmental limitations | Audit fixture/tool limitations | Unavailable fixtures | PDF-production rate | Structural-validity rate | Correct-rendering rate | Main failure or limitation reasons |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| Supported basic PDF | 10 | 10 | 0 | 10 | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10/10 (100.00%) | 10/10 (100.00%) | 10/10 (100.00%) | None observed in this compact lane |
| Intentional policy rejection | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0/0 (N/A) | 0/0 (N/A) | 0/0 (N/A) | Three synthetic unsafe-HTML cases returned the documented `unsafe_html` rejection |
| Unsupported capability | 1 | 1 | 0 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0/0 (N/A) | 0/0 (N/A) | 0/0 (N/A) | The contract exposes one page format/orientation; a uniform PDF does not establish mixed-orientation support |
| Isolation | 1 | 1 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1/1 (100.00%) | 1/1 (100.00%) | 1/1 (100.00%) | None observed in the four-execution synthetic alternation |
| Repeatability | 2 | 2 | 0 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2/2 (100.00%) | 2/2 (100.00%) | 2/2 (100.00%) | None observed in six repeat executions; repeatability is not correctness proof |
| **Overall** | **17** | **17** | **0** | **14** | **14** | **13** | **0** | **0** | **1** | **3** | **0** | **0** | **0** | **13/13 (100.00%)** | **13/13 (100.00%)** | **13/13 (100.00%)** | Three documented rejections and one unsupported mixed-orientation capability remain separately classified |

Raw PDFs produced include the structurally valid uniform PDF returned by the
unsupported mixed-orientation probe. Rate numerators and denominators include
only executed fixtures whose intended result is a supported usable PDF, so that
unsupported response is visible but cannot inflate supported quality.

Unique fixture counts are separate from 24 logical executions and 24 request
attempts. Repeats did not create additional unique successes.

## Classified fixture reasons

| Fixture | Classification | Concise reason |
|---|---|---|
| `A-SEC-SCRIPT-01` | Intentionally rejected | Returned the documented `unsafe_html` policy rejection |
| `A-SEC-URL-01` | Intentionally rejected | Returned the documented `unsafe_html` policy rejection |
| `A-SEC-LOCAL-01` | Intentionally rejected | Returned the documented `unsafe_html` policy rejection |
| `A-UNSUP-MIXED-01` | Unsupported feature | The contract exposes one format/orientation; the returned uniform PDF does not prove mixed-orientation support |

No supported basic fixture was incorrect, failed, or unavailable in this run.
The report would list every such fixture and its reason if any occurred.

## Findings by category

These are finding events, not unique-fixture counts.

| Fixture category | Findings by severity | Findings by cause |
|---|---|---|
| Supported basic PDF | None | None |
| Intentional policy rejection | Informational: 3 | Documented policy: 3 |
| Unsupported capability | Informational: 1 | Unsupported feature: 1 |
| Isolation | None | None |
| Repeatability | None | None |
| Overall | Informational: 4 | Documented policy: 3; unsupported feature: 1 |

## Repeatability evidence

Both repeat scenarios preserved page geometry and extracted text across all
three executions. PDF byte hashes differed because volatile metadata is
present. The basic-page rasters were equal; the fixed-page scenario did not
request a visual-raster repeat check. These are repeatability observations
only, not proof of visual correctness.

## Evidence and reproducibility

- Node 24.18.0; npm 11.16.0; Windows 10.0.26100 x64.
- Microsoft Edge 151.0.4129.59; Puppeteer 25.1.0; serverless Chromium pin
  149.0.0.
- Poppler `pdfinfo`, `pdftotext`, and `pdftoppm` 25.07.0.
- Arial, Arial Bold, and Times New Roman present.
- Manifest SHA-256:
  `7217f564dd55105cde78bdea9cb58e6de7798fa16b8a41f20eb0dc45ae014d53`.
- Schema SHA-256:
  `49328c09e519d7640d3bc0d9aad1b2548ae11be24c9b7db7eea2dc2db716aa31`.
- Four compact references were manually reviewed at original resolution and
  locked by fixture/image hashes. Comparison used exact 120-DPI Poppler raster
  equality as a provisional nonblocking PR A label.
- All 38 fixture/input capabilities declared by the compact manifest were
  exercised: 38/38 (100.00%). This is input-scope execution coverage, not
  evidence availability or a claim about every service capability.
- Core required evidence was collected for 52/52 units (100.00%). Five optional
  comparison/tool units were unavailable, so combined evidence availability was
  52/57 (91.23%). Missing optional tools reduce coverage; they do not block the
  audit.

The ±1-point page-dimension tolerance is provisional and nonblocking. No visual,
text-similarity, latency, concurrency, quality, or release threshold has been
calibrated or approved. Performance thresholds are absent.

## Findings and limits

There were four informational classifications: three documented policy
rejections and one unsupported-feature classification. No explicit service
defect was confirmed by this compact run. A good compact result does not remove
the need for PR B expansion.

This report does not claim evidence from CI, Vercel Preview, Production,
accessibility tooling, broad international-font coverage, load/capacity tests,
competitor services, or full caller templates. qpdf, veraPDF, MuPDF,
WeasyPrint, and Vivliostyle were optional and unavailable; core PR A continued
without them.

Generated PDFs, complete raster sets, and raw checkpoints remain only in ignored
`test-artifacts/pdf-quality-audit/`. No generated PDF, credential, signed URL,
raw HTML, real user document, or sensitive artifact is committed.

Release assessment was not performed. No minimum quality result blocks audit
completion. Caller activation and any Production-release decision are separate
later decisions.
