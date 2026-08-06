# PDF service multi-application hardening report

Status: implementation complete locally; isolated Preview configuration and live verification not authorized or run.

## Repository verification

- API admission, retry headers, fail-closed Firewall behavior, storage environment guard, retention-first paths, conditional creation, cleanup ownership, and redacted cleanup/orphan events: covered by automated tests.
- OpenAPI documents retry headers and stored report application routes.
- The Preview reliability and isolated test-R2 runners are repository tooling only. They contain no credentials or bucket names.

## External gates still blocked

- No Firewall rule was staged or published.
- No Vercel environment variable was added, changed, removed, or rescoped.
- No R2 bucket, token, object, lifecycle rule, or Production canary was created or changed.
- No Preview or Production deployment was created or promoted.
- No application was activated. EconPlanner, PathFinder, Job Search, and Tree Service each still require its own retry/idempotency integration gate and separate activation authorization.

## Required future evidence

Record only redacted results:

- Test `HeadBucket` status 200 and Production `HeadBucket` status 403 using the same test credentials/endpoint.
- Three Preview rounds at concurrency 1, 2, 5, and 10 with first-attempt and eventual success, busy/rate-limited counts, attempts/exhaustion, p50/p95/p99/max, corruption/timeout/contamination/link failures, and recovery.
- Immediate storage workflow result and cleanup counts; no bucket names, report IDs, object keys, links, endpoints, or credentials.
- Test-bucket lifecycle observations on days 3, 9, and 32.

Use this exact qualification language before day 32: “Production lifecycle configuration inspected read-only; test-bucket lifecycle verification in progress.” After successful day 32: “Test-bucket lifecycle fully verified.” Never describe Production deletion as verified until an actual, separately authorized Production deletion observation succeeds.
