# A-BASIC-01 Preview visual-reference investigation

## Scope and boundary

This note records the focused remediation investigation that began from merged
`main` commit `a6f8d1e`. It uses synthetic, ignored local artifacts and the
existing PR A Preview artifact only. It does not change the approved visual
reference, its hash, visual tolerance, a caller, Production configuration, or
any R2 object.

## Result

The original Preview mismatch was a deterministic local-Arial/Preview-Open
Sans substitution. Under the user-approved pinned-font solution,
`A-BASIC-01` now embeds one compact Open Sans v44 Latin WOFF2 locally as a
`data:` URL and explicitly uses its 400 and 700 weights. This is a fixture-only
correction; the service renderer and caller HTML are unchanged.

A new candidate was deliberately reviewed before approval and replaces only the
`A-BASIC-01` compact reference. It is structurally correct and the locally
generated ordinary run plus three repeat runs have identical raster evidence.
The completed Preview confirmation is separately recorded below. It still has
an exact reference mismatch, so this local approval is not a claim that the
deployed service passed visual correctness.

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
`A-DET-BASIC-01` repetitions from the pinned-font fixture. Before the reference
update, all four produced candidate raster
`7cae94affafb3eebf7be7e32a6379b554bf01a7e96a4bee71334071dd9172ea0`.
The candidate was viewed at original resolution: the heading and paragraph are
ordered, legible, unwrapped, within the Letter-page margins, and have no
clipping or unexpected content. Required text, one-page geometry, and metadata
were also verified. The three repeat runs had identical semantic structure,
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

## Approved pinned-font correction

The fixture uses the official Google Fonts Open Sans v44 Latin variable WOFF2,
which the official CSS serves for both requested 400 and 700 weights. Vendoring
one 48,320-byte file avoids duplicating identical bytes. Its SHA-256 is
`d8e4fe0452aa2076429a9bb5d8757d00a994dd95986cf950e9a1a371b9a072a0`.
The associated SIL Open Font License 1.1, attribution, upstream URLs, and
license hash are committed beside it under
`tests/quality-audit/fonts/open-sans-v44/`.

No exact-comparison tolerance was weakened or added. The updated reference
review record includes the deliberate visual inspection, tool versions, fixture
hash, image hash, and font provenance. A remaining Preview mismatch must still
be reported as a mismatch; it cannot be hidden through replacement or a
tolerance relaxation.

## Completed Preview confirmation

The approved six-request campaign completed on Preview deployment
`dpl_4XToHMzxGwNsYhwNkdCSaaFmMNuc`, built from PR #8 commit
`c966204d4db718590f81a34f59f990a5241a495a`. It used exactly **6 HTTP
requests**, sequentially with no retries:

| Order | Request | Purpose |
|---:|---|---|
| 1 | `GET /api/health` | Confirm safe service availability. |
| 2 | Authenticated `GET /api/v1/diagnostics` | Confirm synthetic `test` caller and `test` storage environment. |
| 3-5 | `POST A-BASIC-01` three times | Measure Preview repeatability and compare with the explicitly approved visual method. |
| 6 | `POST A-FLOW-01` once | Confirm the remediation did not alter an unrelated Preview fixture. |

Health returned HTTP 200 with `status=ok`. Authenticated diagnostics returned
HTTP 200 with `status=ok`, `caller=test`, and `storageEnvironment=test`.
Every POST used `storeResult:false` and `storeHtml:false`, stayed within the
100,000-byte input and 4,000,000-byte output limits, and ran at concurrency
one. The six branch-scoped sensitive Preview variables were the following test
configuration names only:

- `PDF_CREATION_TEST`
- `PDF_CREATION_R2_ENVIRONMENT`
- `PDF_CREATION_R2_SECRET_ACCESS_KEY`
- `PDF_CREATION_R2_ACCESS_KEY_ID`
- `PDF_CREATION_R2_BUCKET_NAME`
- `PDF_CREATION_R2_ACCOUNT_ID`

No value was copied into Production, general Preview, Development, another
branch, Git, or test artifacts. The runner used the generated deployment
hostname and its SHA-256 pin. This is Preview-only evidence, not Production
evidence.

### Raw result

The campaign had two unique supported-basic fixtures: `A-BASIC-01` and
`A-FLOW-01`. Both returned a PDF and both were structurally valid: production
rate **2/2 (100.00%)** and structural-validity rate **2/2 (100.00%)**.
`A-FLOW-01` met all required expectations. `A-BASIC-01` was executed three
times and each result was an exact visual-reference mismatch, so the
unique-fixture correct-rendering rate was **1/2 (50.00%)**. There were no
generation failures, unsupported fixtures, intentional rejections, or
unavailable fixtures in this small confirmation lane.

All three `A-BASIC-01` rasters had the same candidate SHA-256
`8540cf1ba3124ab8980810aa8035e980aba88ab2f53962b328b983be21dd55dd`,
which differs from the reviewed reference
`7cae94affafb3eebf7be7e32a6379b554bf01a7e96a4bee71334071dd9172ea0`.
This establishes Preview repeatability of the mismatch; it does not establish
visual correctness. The Preview PDF inspection observed two embedded
`OpenSans-Regular` subsets, while the local candidate had separate
`Open-Sans-Bold` and `Open-Sans` subsets. This is an observation for a later
focused investigation, not a confirmed renderer defect or a reason to weaken
the approved reference.

The three A-BASIC-01 durations were 4,369 ms, 1,881 ms, and 976 ms; the
A-FLOW-01 duration was 426 ms. These are informational measurements only.
The completed mismatch is a nonblocking finding. It did not trigger a retry,
reference replacement, tolerance change, caller activation, or any Production
action.
