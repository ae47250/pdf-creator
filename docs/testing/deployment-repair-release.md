# Link, page policy and document language repairs

Fixed-page internal links now use post-isolation geometry, printable width, content scaling and physical margins. Requested page geometry takes precedence over conflicting, named, pseudo and nested CSS page rules after source CSS validation. PDF merging preserves a single unambiguous source language, including when a blank source page omits it; conflicting languages remain unspecified.

The three implementation modules and two unit-test files match the snapshot verified on 2026-10-17 with bundled `@sparticuz/chromium@149.0.0`, measured as HeadlessChrome 149.0.7827.0 on Ubuntu x86-64. The existing Section 55 regression passed with all 55 sections retained across eight pages. All 42 targeted output pages were visually inspected.

The original Linux run executed 15 regressions: one pass and 14 failures. Ubuntu MuPDF 1.23.10 emitted an ICC-support warning rejected by the unchanged checker; REPORT-MERGED additionally retained its known accessibility failures. Separate inspection of the same 14 API PDFs with the existing macOS tools passed all 13 link/page cases; REPORT-MERGED still failed its historical accessibility assertions while its language check passed. Original failures were not reclassified, and no expectations were weakened.

The targeted link-placement, page-policy and language repairs are supported by that evidence. Language preservation does not establish accessibility-structure preservation. This release does not repair tagged merging or claim PDF/UA conformance, comprehensive report correctness, or verification of the exact Production operating-system image.

Local retained evidence: `test-artifacts/deployment-linux-149/REPORT.md`, its environment and source manifests, raw/final PDFs, original results, independent inspection results and visual-review record. The existing source register is `tests/whole-report/sources.lock.json` in the separately preserved audit workspace. These audit artifacts are not runtime dependencies and are not included in this scoped release.

Deployment acceptance for this release requires the existing CI workflow plus focused Preview checks of repaired links, page conflict handling, merged language and Section 55, using synthetic direct-mode requests and inspecting the returned PDFs. Production follows only after that acceptance, with a small synthetic direct-mode PDF smoke test. Existing audit limitations remain disclosed throughout.
