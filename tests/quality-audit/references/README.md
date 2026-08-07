# Compact visual-reference policy

These four PNG files are reviewed correctness references for the compact PR A
corpus. They are not ordinary generated test output and they do not establish
service-wide or Production quality.

An approved reference must be synthetic, non-sensitive, at most 256 KiB, and
listed by immutable SHA-256 in `review.v1.json`. The complete reference set must
remain at most 1 MiB. Generated PDFs, full-document raster sets, raw logs, signed
URLs, credentials, and real caller documents stay in ignored
`test-artifacts/pdf-quality-audit/` and must never be committed.

The harness never creates or updates an approved reference. A candidate is
generated in an ignored run directory, viewed at original resolution, checked
against its immutable fixture and explicit geometry/text expectations, and then
added through a deliberate pull-request diff with reviewer, reason, tool
versions, fixture hash, image hash, and notes. This prevents a newly generated
defect from becoming accepted merely because a command was run.

An exact candidate/reference raster match is a provisional PR A result label.
It never stops later fixtures or blocks the report. Browser, font, operating-
system, and Poppler variation will be measured in repeated controlled baselines
before any broader visual tolerance is proposed, reviewed, documented, and
frozen in a later deliberate change.

Visual repeatability is separate evidence. Matching two fresh outputs shows
only that the implementation repeated itself; it does not prove correctness.
Correctness requires an approved reference or explicit checked geometry.

`A-BASIC-01` additionally embeds its reviewed, open-licensed Open Sans v44
Latin WOFF2 through a `data:` URL. The vendored source, checksum, and SIL Open
Font License attribution are in `tests/quality-audit/fonts/open-sans-v44/`.
This is a fixture-level contract: callers that require visually repeatable
typography must embed or otherwise provide their pinned font files. The PDF
service does not impose a service-wide default font or change caller HTML.
