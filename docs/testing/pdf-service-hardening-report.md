# PDF service multi-application hardening report

Status: isolated Preview storage verification passed on 2026-08-06. PR #6 may merge without waiting for the later lifecycle observations; all three observations remain pending.

## Local and mocked evidence

- API admission, retry headers, fail-closed Firewall behavior, storage environment guard, retention-first paths, conditional creation, cleanup ownership, and redacted cleanup/orphan events are covered by automated tests.
- OpenAPI documents retry headers and stored report application routes.
- The Preview reliability and isolated test-R2 runners contain no credentials or bucket names.
- `npm.cmd run test:fast`: 15 files and 92 tests passed.
- `npm.cmd run test:mocks`: 5 files and 26 tests passed.
- `npm.cmd run lint`: passed with zero warnings.
- `npm.cmd run build`: passed.
- `node --check scripts/run-preview-storage-workflow.mjs`: passed.

## Automatic Preview-deployment evidence

- The exact tested PR head Preview deployment was Ready and its available Vercel checks passed.

## Live isolated test-bucket evidence

- The live Firewall rule uses SDK ID `pdf-creation`, a fixed 60-second window, and a limit of 10 requests. The staged correction was published by the operator before this run.
- The test-bucket `HeadBucket` returned HTTP 200.
- The Production-bucket `HeadBucket` returned HTTP 403 using the same test credentials and endpoint.
- The test lifecycle configuration was inspected through the read-only Cloudflare API request and matched all four required rules.
- Stored requests with and without HTML, distinct reports, replay, conflict, concurrent race, conditional collision, route disposition and integrity, expired routes, and interrupted cleanup all passed.
- Immediate cleanup removed 11 run-owned objects and left zero immediate-test objects.
- Exactly three lifecycle canaries remain, all in the dedicated test bucket and recorded in the private local ledger.
- No Production R2 object was created, modified, copied, or deleted.

## Lifecycle observations

- Retention-1 observation: pending until 2026-08-09T21:44:41.201Z (day 3).
- Retention-7 observation: pending until 2026-08-15T21:44:41.201Z (day 9).
- Retention-30 observation: pending until 2026-09-07T21:44:41.201Z (day 32).

The retained canaries were confirmed present by read-only inspection. Exactly three relevant objects remain, every object is in the private ledger, and each exposes lifecycle expiration metadata. They must remain unchanged for the scheduled observations.

Pending observation dates are later lifecycle-qualification evidence, not blockers to merging PR #6 or starting the application quality audit.

## Read-only Production configuration evidence

- The approved Production bucket identity was found through the read-only Cloudflare API.
- The Vercel Production environment contains the required encrypted R2 variable names. Their values were not displayed, copied, or decrypted during this review.
- Production `r2.dev` public access is disabled.
- Production has zero enabled R2 custom domains.
- The current Production lifecycle configuration contains the default seven-day multipart-abort rule, a broad `reports/` deletion rule at 31 days, and a `temporary-uploads/` deletion rule at one day.
- It does not yet contain the documented retention-specific 2/8/31-day rules, caller idempotency backstops, or transitional legacy caller-prefix rules.
- This configuration gap does not block merging the already isolated and tested code because no calling application is being activated. It remains a required separately authorized Production-configuration and caller-activation gate.
- No Production canary or other Production R2 object was created, modified, copied, or deleted during this inspection.

Current qualification: "Production lifecycle configuration inspected read-only; test-bucket lifecycle verification in progress."

The day-3 readiness gate concerns deletion of the test-bucket retention-1 canary only. Production lifecycle deletion remains unverified. Full test-bucket lifecycle qualification requires the successful day-32 observation.

## Remaining authorization gates

- No Vercel environment variable, Production secret, or R2 lifecycle configuration was changed by Codex.
- No manual Preview or Production deployment was triggered or promoted.
- No Production R2 canary or other Production object was created.
- No application was activated. EconPlanner, Pathfinder, Job Search, and Tree Service each still require its own retry/idempotency integration gate and separate activation authorization.
- PR merge and its automatic Production deployment are authorized only after every immediate merge gate passes; the later lifecycle observations do not block that decision.
