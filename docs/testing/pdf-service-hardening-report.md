# PDF service multi-application hardening report

Status: isolated Preview storage verification passed on 2026-08-06; lifecycle observations remain pending.

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

- The tested PR Preview deployment was Ready and its available Vercel checks passed before the isolated workflow ran.

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

- Retention-1 observation: 2026-08-09 (day 3).
- Retention-7 observation: 2026-08-15 (day 9).
- Retention-30 observation: 2026-09-07 (day 32).

Current qualification: test-bucket lifecycle verification is in progress. Production lifecycle configuration was not inspected by this run.

After a separately authorized read-only Production configuration inspection succeeds, use: "Production lifecycle configuration inspected read-only; test-bucket lifecycle verification in progress."

The day-3 readiness gate concerns deletion of the test-bucket retention-1 canary only. Production lifecycle deletion remains unverified. Full test-bucket lifecycle qualification requires the successful day-32 observation.

## Remaining authorization gates

- No Vercel environment variable, Production secret, or R2 lifecycle configuration was changed by Codex.
- No manual Preview or Production deployment was triggered or promoted.
- No Production R2 canary or other Production object was created.
- No application was activated. EconPlanner, Pathfinder, Job Search, and Tree Service each still require its own retry/idempotency integration gate and separate activation authorization.
- PR merge and Production deployment remain separately authorized actions.
