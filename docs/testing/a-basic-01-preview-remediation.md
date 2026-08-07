# A-BASIC-01 Preview visual-reference investigation

## Scope and boundary

This note records the focused remediation investigation that began from merged
`main` commit `a6f8d1e`. It uses synthetic, ignored local artifacts and the
existing PR A Preview artifact only. It does not change the approved visual
reference, its hash, visual tolerance, a caller, Production configuration, or
any R2 object.

## Result

`A-BASIC-01` is structurally correct in the recorded Preview response, but it
does not exactly match the compact local approved raster. The difference is a
deterministic renderer/font-environment difference, not evidence of missing
content, page-size drift, metadata drift, an artifact-selection problem, or a
confirmed service-layout defect.

The approved reference remains valid for the local renderer. Whether it should
also be the exact Preview oracle requires an explicit review decision; this
investigation does not replace it or label the Preview result acceptable.

## Evidence

| Evidence | Approved/local result | Recorded Preview result |
|---|---|---|
| PDF structure | One 612 x 792 point Letter page | One 612 x 792 point Letter page |
| Required and forbidden text | Required text present; forbidden text absent | Same |
| Metadata | Required title, author, subject, and keywords | Same |
| Rendered raster | 1020 x 1320 pixels; exact approved-reference match | 1020 x 1320 pixels; not byte-identical |
| Embedded font | `Arial-BoldMT`, `ArialMT` | `OpenSans-Bold`, `OpenSans-Regular` |

The existing Preview artifact is
`pr-a-preview-2026-08-07T06-12-32-050Z`, execution
`pr-a-preview-01-A-BASIC-01`. Its complete summary directly references its
candidate raster, so this is not a newest-artifact-selection issue.

Compared with the approved raster, the Preview raster has 15,551 differing
pixels of 1,346,400 (1.155006%). Every differing pixel is inside x=9..501 and
y=32..132: the heading and the paragraph. The rest of the Letter page is
pixel-identical. The Preview heading is wider and taller than the local
reference, and the paragraph begins lower and has wider word bounds. For
example, the Preview heading word `fixture` ends at x=302.25 points while the
local reference ends at x=288.74 points; Preview paragraph text begins at
y=64.42 points while the local reference begins at y=59.64 points.

The local route seam ran one ordinary `A-BASIC-01` execution plus three
`A-DET-BASIC-01` repetitions. All four rendered rasters exactly matched the
approved reference. The three repeat runs had identical semantic structure,
text, and raster hashes; their PDF byte hashes differed only because volatile
PDF metadata is intentionally excluded from correctness. This establishes
local repeatability, not universal visual correctness.

The service selects an installed local browser on Windows, which was Edge
151.0.4129.59 and embedded Arial. The Vercel deployment uses the bundled
Chromium 149 runtime; its PDF embedded Open Sans instead. The fixture requests
`Arial, sans-serif`, but Arial is not available in the Preview runtime. That
font substitution explains the complete, text-only difference.

## Separate audit-harness correction

The initial fresh-worktree core run also found seven stale fixture SHA-256
records in the audit manifest. The files themselves match their Git-tracked
bytes; only the recorded immutable hashes were stale. The linked source hashes
in the review ledger for the asset, table, and pathway references were stale as
well. This change corrects those records without changing fixture HTML,
reference PNGs, review status, or expected rendering behavior. The existing
complete core audit now verifies the corrected records while exercising all
fixtures.

## Decision required before visual changes

No tolerance has been calibrated and no reference is objectively shown to be
wrong. Please choose and explicitly approve one future direction before any
visual-reference change:

1. Provide a compact, licensed, pinned font resource that both local and Vercel
   Preview can use; then review a newly rendered reference deliberately.
2. Approve an environment-specific, compact Vercel Preview reference through
   the existing review-ledger process.
3. Authorize repeated controlled measurements to propose a calibrated,
   reporting-only visual tolerance. A tolerance must be reviewed separately and
   must not turn this current mismatch into an automatic pass.

Until then, the existing Preview mismatch remains an accurately reported
nonblocking finding.

## Proposed Preview confirmation after review

This investigation sends no new Preview request. After review, use a new,
separately authorized maximum budget of **6 HTTP requests**, sequential with no
retries:

| Order | Request | Purpose |
|---:|---|---|
| 1 | `GET /api/health` | Confirm safe service availability. |
| 2 | Authenticated `GET /api/v1/diagnostics` | Confirm synthetic `test` caller and `test` storage environment. |
| 3-5 | `POST A-BASIC-01` three times | Measure Preview repeatability and compare with the explicitly approved visual method. |
| 6 | `POST A-FLOW-01` once | Confirm the remediation did not alter an unrelated Preview fixture. |

Every POST must use `storeResult:false` and `storeHtml:false`, remain below the
existing 100,000-byte input and 4,000,000-byte output limits, and run at
concurrency one. Each initiated POST consumes its request slot regardless of
success, timeout, or visual outcome. Stop only for safety, authorization,
credential, budget, platform-protection, external-service, or genuine
technical constraints—not for a visual mismatch or low metric.

Before that campaign, configure only this branch's Vercel Preview scope with
the six confirmed non-Production test variables:

- `PDF_CREATION_TEST`
- `PDF_CREATION_R2_ENVIRONMENT`
- `PDF_CREATION_R2_SECRET_ACCESS_KEY`
- `PDF_CREATION_R2_ACCESS_KEY_ID`
- `PDF_CREATION_R2_BUCKET_NAME`
- `PDF_CREATION_R2_ACCOUNT_ID`

The local runner must use the generated branch Preview hostname, its calculated
hostname SHA-256 pin, the synthetic Preview key, and an optional deployment
protection bypass secret. Do not copy values into Production, general Preview,
Development, another branch, Git, or test artifacts. Label the resulting
evidence as Preview-only, not Production evidence.
