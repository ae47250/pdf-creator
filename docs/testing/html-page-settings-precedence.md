# HTML page settings take precedence — local verification

Date: 2026-10-18. Branch: `feat/html-page-settings-win`. Baseline: `877e07a`.
Environment: macOS, Node 24.19.0, npm 11.17.0, Google Chrome 155.0.8059.80,
Poppler 26.09.0. Python measurements use the available bundled `pdfplumber`;
no dependencies were added or upgraded. No hosted settings, push, merge, or deployment.

## Confirmed original behavior

Line numbers refer to baseline commit `877e07a`:

- `lib/pdf/html-safety.ts:92` rewrote stylesheet text; lines 114–115 appended
  request geometry; lines 122–133 removed HTML size/margins/page-orientation and
  substituted request declarations with `!important`.
- `lib/pdf/pdf-quality.ts:45`–52 required every page to match request dimensions.
- `lib/pdf/renderer.ts:209`–213 derived fixed-page viewport width from the request;
  lines 270–271 used request margins for link coordinates. Lines 280–296 used
  request geometry for flow diagnostics; lines 343–354 passed request PDF options.
- `docs/CALLER_CONTRACT.md:7` prohibited mixed orientation.

## Changes by file

- `lib/pdf/html-safety.ts`: retain validated author CSS verbatim, record whether
  it declares page size, and insert request defaults before author styles in the
  first anonymous cascade layer. This also lets declarations in author layers
  override defaults. All existing safety checks run before browser operations.
- `lib/pdf/renderer.ts`: a disposable print probe measures Chromium's resolved
  page dimensions, printable rectangles and rotation using link annotations.
  Original safe HTML is reloaded before actual rendering. Uniform fixed-page
  geometry determines viewport width, link rectangles and destinations. Mixed
  fixed-page geometry returns 422 with a message naming sizes and margins.
  Flow diagnostics use the first measured page width; native Chromium still
  paginates the unchanged full document, including named/pseudo-pages.
- `lib/pdf/pdf-quality.ts`: retain the request-size check when HTML declares no
  size; otherwise check every side against 72–1224 pt and return 422 on failure.
  Keep distinct actual dimensions and exact expected-page-count enforcement.
  Internal destinations can carry an X coordinate for rotated fixed pages.
- `lib/pdf/limits.ts`: add only the two page-side bounds.
- `app/console-form.tsx`: change only the three page-setting labels to identify
  them as fallbacks.
- `README.md`, `docs/CALLER_CONTRACT.md`, `docs/MIGRATION.md`: document precedence,
  mixed flowing pages, uniform fixed pages, limits and margin boxes.
- `contracts/pdf-creation.schema.json`, `contracts/openapi.yaml`,
  `contracts/manifest.schema.json`: description-only changes; required fields,
  types and request validation are unchanged.
- `tests/integration/html-page-settings.test.ts`: 23 real-browser cases covering
  B1–B14 and individual-margin defaults, layers, left/right pseudo-pages, PDF
  option precedence, mixed fixed margins and rotated cross-page links.
- `tests/unit/html-page-size-quality.test.ts`: seven cases covering source-size
  detection, every side's lower/upper bound, inclusive limits, distinct sizes and
  preservation of strict request-size checks without HTML size declarations.
- `tests/integration/html-page-settings-fixtures.test.ts`: send all four supplied
  fixtures through the real API handler and save PDFs plus response headers.
- `tests/helpers/measure-page-settings.py`: use pdfplumber to measure page count,
  distinct sizes, page-two left text edge, footer text and every character position;
  fail on missing PDFs or an unmet requested comparison.
- `tests/fixtures/html-page-settings/`: unchanged copies of the four supplied HTML
  files and their three reference PDFs. No fixture was special-cased in service code.
- Existing test expectation changes and the single visual baseline are listed below.
- This file is the new testing note.

The installed Chrome's CSS margins override `page.pdf()` margins. With HTML
`@page { size:A4; margin:.5in }`, PDF options of either zero or one inch produced
identical content rectangles, with a left/top edge of 36 pt. The automated test
repeats this check. Request PDF options remain as fallback options; CSS is not
rewritten. The PDF used to measure geometry is disposable; final PDF content is
not rewritten to satisfy geometry checks. Existing metadata and fixed-page merge
operations remain in place.

## Existing expectations updated

| File | Old expectation | New expectation and reason |
|---|---|---|
| `tests/unit/html-safety.test.ts` | HTML page geometry removed and request forced with `!important` | Author declarations preserved, margin boxes retained, lower-priority request rule first |
| `tests/unit/repository-contracts.test.ts` | Contract says mixed orientation unsupported | Contract says request settings are fallbacks and flowing pages may mix orientation |
| `tests/integration/renderer.test.ts` | `flowing-pages.html` has exactly 3 pages | Exactly 6 pages: its `.5in` margins now apply; unchanged tall sections spill onto blank pages |
| `tests/quality-audit/manifest.v1.json` | A-FLOW-01 has 3 pages, headings on 1/2/3 | Exactly 6 pages, headings on 1/3/5; all-pages-nonblank check remains active |
| `tests/quality-audit/core.test.ts` | A-BASIC-01 matches a previously reviewed zero-margin candidate; zero bad basic PDFs | A-BASIC-01 exactly matches the new half-inch-margin reference; A-FLOW-01 has exactly three blank-page findings and the basic category records one bad PDF |

No tests were deleted or disabled. Focused diagnostic runs selected individual
cases; the final full run executes all 204 tests without skips.

One visual baseline changed: `tests/quality-audit/references/A-BASIC-01-p1.png`.
The fixture's own `@page { margin:.5in }` now moves its unchanged heading and
paragraph inward by 36 pt. The complete old and new page rasters were inspected
at original resolution: text is legible, complete and unclipped. The image hash,
reviewer, source hash, tool versions and reason are recorded in
`tests/quality-audit/references/review.v1.json`. Other reference images and
historical user-supplied reviews were preserved.

## A — existing suites, baseline versus final

| Command | Unchanged baseline | Final |
|---|---|---|
| `npm run typecheck` | PASS | PASS |
| `npm run lint` | PASS | PASS |
| `npm run test` | PASS: 173 tests, 23 files | PASS: 204 tests, 26 files |
| `npm run build` | PASS | PASS |
| `npm run test:browser` | PASS: 2 tests | PASS: 2 tests |
| `npm run test:visual` | PASS: 1 test | PASS: 1 test |
| `npm run audit:core` | PASS: 1 test | PASS: 1 test |

Initial restricted baseline attempts could not launch Chrome or bind port 3202.
The unchanged suites were rerun with approved local execution permissions and
passed; those environment failures are not counted as passing runs. No suite
needed unavailable credentials or external network access. Full logs are local
at `/tmp/pdf-page-settings/baseline/` and `/tmp/pdf-page-settings/final/`.
The build-generated `next-env.d.ts` change is restored before committing.

## B — new automated behavior checks

The B tests did not exist in the unchanged baseline. They were not represented
as baseline passes. B1 compares page geometry and all extracted word positions
against direct Chrome using the exact old appended request rule, and C also
compares all character positions against PDFs captured from unchanged code.

| Requirement | Baseline evidence | Final |
|---|---|---|
| B1 no HTML page rules | Captured generic PDF; independent old-rule Chrome control | PASS, all text positions unchanged |
| B2 HTML size only | Old code forced request size | PASS, A4 with four request margins |
| B3 HTML margins only | Old code stripped margins | PASS, Letter with four HTML margins |
| B4 both | Old code forced both | PASS |
| B5 middle named landscape | C test2 baseline lacked landscape | PASS, portrait/landscape/portrait and two distinct sizes |
| B6 first-page margins | Old code forced request margins | PASS, also tests left/right pages |
| B7 print media | Old code rewrote nested page rules | PASS |
| B8 conflicting/important rules | Old code forced request rules | PASS against direct Chrome; includes layers |
| B9 footer counters | Separate new fixture | PASS, “Page 1 of 2” and “Page 2 of 2” |
| B10 A4 fixed pages/internal links | Old coordinates used request geometry | PASS, both link rectangles match right-aligned text and both destinations resolve correctly |
| B11 mixed fixed sizes | Old code forced all pages to request | PASS, 422 with size/margin explanation; mixed margins also rejected |
| B12 bounds | Old code forced request size | PASS: tabloid and A3; 422: 11×18 and .5×5 inches; exact unit boundary checks also pass |
| B13 size URL | Existing safety test passed | PASS, unsafe_html 400 before printing |
| B14 expected count | Existing enforcement passed | PASS, expected_page_count_mismatch 422 |

Additional rotated fixed-page tests cover both `rotate-left` and `rotate-right`
with explicit A4 size and cross-page links; native-content preservation tests
also pass. The normal-cascade oracle uses direct Chrome, not the service's CSS
normalizer or probe implementation.

## C — supplied fixture measurements

All requests use Letter, portrait, zero margins, `storeResult:false`,
`storeHtml:false`. Size sets below are rounded to whole points, matching the
reference notation. Left text edges use pdfplumber character coordinates.

| Fixture | Pages: baseline → final (reference) | Size set: baseline → final | Page 2 left edge: baseline → final (reference), pt |
|---|---|---|---|
| generic | 6 → 6 (baseline) | 612×792 → 612×792 | 0 → 0 (baseline) |
| test1 | 21 → 23 (23) | 612×792 → 612×792 | 0 → 43.5 (43.5) |
| test2 | 12 → 15 (16) | 612×792 → 612×792 + 792×612 | 0 → 50.25 (50.25) |
| test3 | 11 → 12 (12) | 612×792 → 595×842 | 4 → 46.75 (46.75) |

Generic character text, X coordinates and top coordinates match the captured
baseline on every page. All three reference page-count differences are within
2; all reference size sets match; all page-two left-edge differences are 0 pt.
Test1 contains “Page 2 of” and suppresses the cover footer, as explicitly approved
by the user. B9 separately checks “Page 1 of” without cover suppression.

Reproduce capture and comparison (use a Python executable with pdfplumber):

```sh
npx vitest run tests/integration/html-page-settings-fixtures.test.ts
python3 tests/helpers/measure-page-settings.py test-artifacts/html-page-settings/current \
  --baseline test-artifacts/html-page-settings/baseline \
  --references tests/fixtures/html-page-settings/ref
```

The retained baseline PDFs and current PDFs are in ignored
`test-artifacts/html-page-settings/`. The measurement script is committed.
The final script output follows:

```json
{
  "generic_flowing_fixture": {
    "pages": 6,
    "sizes": [
      [
        612,
        792
      ]
    ],
    "leftPage2": 0.0,
    "page1Footer": false,
    "page2Footer": false
  },
  "test1_annual_financial_report": {
    "pages": 23,
    "sizes": [
      [
        612,
        792
      ]
    ],
    "leftPage2": 43.5,
    "page1Footer": false,
    "page2Footer": true
  },
  "test2_program_outcomes_review": {
    "pages": 15,
    "sizes": [
      [
        612,
        792
      ],
      [
        792,
        612
      ]
    ],
    "leftPage2": 50.25,
    "page1Footer": false,
    "page2Footer": false
  },
  "test3_rendering_torture_test": {
    "pages": 12,
    "sizes": [
      [
        595,
        842
      ]
    ],
    "leftPage2": 46.75,
    "page1Footer": false,
    "page2Footer": false
  }
}
{
  "failures": []
}
```

## Other output changes and limitations

A-FLOW-01 is deliberately left unchanged as source material. Honoring its HTML
margins exposes blank pages 2, 4 and 6. The audit records this degraded fixture
outcome: 9/10 supported basic PDFs are correctly rendered, and 1/10 is flagged.
The suite passes because it verifies this exact policy-driven outcome while
retaining the blank-page detector. No blanket relaxation or source modification
was made to hide those pages. Fixing that fixture's layout would be separate work.

A-BASIC-01's single visual reference moved inward by its HTML margins. The
supplied reports change only as captured above; test2's 15 versus reference 16
pages remains inside the requested tolerance. Different installed browser/font
versions can affect pagination. This verification used installed Chrome 155;
bundled Chromium 149 on its deployment platform was not executed or deployed.

Visual-regression generation is not a full manual visual/accessibility audit of
all generated reports. The replaced reference was inspected in full; no formal
PDF/UA, PDF/X or Silver certificate is claimed for the fixture corpus. No safety,
storage, authentication, retry or retention policy changed.
