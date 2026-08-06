# Operations

## Runtime and secrets

Use Node.js 24.x. Production uses bundled `@sparticuz/chromium@149.0.0` on x64. Local runs use `CHROME_PATH` when supplied, otherwise installed Chrome or Edge.

Application keys:

```text
PDF_CREATION_ECONPLANNER
PDF_CREATION_ECONPLANNER_PREVIOUS
PDF_CREATION_PATHFINDER
PDF_CREATION_PATHFINDER_PREVIOUS
PDF_CREATION_JOBSEARCH
PDF_CREATION_JOBSEARCH_PREVIOUS
PDF_CREATION_TREESERVICE
PDF_CREATION_TREESERVICE_PREVIOUS
PDF_CREATION_TEST
PDF_CREATION_TEST_PREVIOUS
```

Keys must contain at least 32 characters. Generate 256 random bits and encode them as 43-character base64url values. Never use `NEXT_PUBLIC_` for a key.

Other service variables:

```text
PDF_CREATION_CONSOLE_ENABLED
PDF_CREATION_CONSOLE_PASSWORD
PDF_CREATION_R2_ACCOUNT_ID
PDF_CREATION_R2_BUCKET_NAME
PDF_CREATION_R2_ACCESS_KEY_ID
PDF_CREATION_R2_SECRET_ACCESS_KEY
PDF_CREATION_R2_JURISDICTION
PDF_CREATION_R2_ENVIRONMENT
CHROME_PATH
```

Set `PDF_CREATION_R2_ENVIRONMENT=production` only when `VERCEL_ENV=production`; use `test` for Preview, Development, and the isolated harness. A mismatch fails with `503` before the S3 client is constructed. This marker is defense in depth only: Preview verification also requires branch-scoped credentials limited to the private test bucket, exact test-bucket identity, and the read-only Production-bucket denial check below.

Calling applications use `PDF_CREATION_API_URL`, `PDF_CREATION_API_KEY`, and `PDF_CREATION_ENABLED` on their server only.

## Rotation

1. Put the new key in the caller's current variable and retain the old value in `_PREVIOUS`.
2. Deploy the service preview/production only when separately approved.
3. Change the calling application.
4. Confirm requests authenticate with the new key.
5. Remove the previous value.

The service checks all configured current and previous digests without an early match return. It never logs keys, key fragments, or key hashes.

## Vercel controls

- Function duration: 120 seconds.
- Define one Firewall SDK rate-limit ID: `pdf-creation`. The authenticated caller ID is `rateLimitKey`, so callers have separate counters.
- Production: exactly 10 accepted render requests per caller per 60 seconds. Do not increase it without measured evidence and an explicit user decision. Preview may temporarily use 30 per caller per minute for controlled testing.
- A missing Vercel firewall rule fails closed in Vercel. Local development skips the external firewall check.
- Keep the testing console disabled in production by omitting `PDF_CREATION_CONSOLE_ENABLED` or setting it to `false`.
- To enable it in production, set both `PDF_CREATION_CONSOLE_ENABLED=true` and a sensitive `PDF_CREATION_CONSOLE_PASSWORD`. The password gate issues a two-minute secure, HTTP-only session cookie; neither this password nor `PDF_CREATION_TEST` reaches browser code.
- Protected previews may set it to `true` without the production password gate.
- Exclude `/reports/*` from production Deployment Protection. Possession of an unguessable report URL grants access until manifest expiry.

After a production build, inspect `.next/server/app/api/v1/pdfs` and its trace. If the uncompressed traced creation function exceeds 230 MB or Vercel rejects it, use only the approved fallback: `@sparticuz/chromium-min@149.0.0` with the exact x64 pack in private nearby R2 and verify its checksum. Do not use a latest or public GitHub pack URL.

## Private R2

Restrict the access token to one private bucket. Do not configure a public object domain or listing.

Lifecycle rules must be configured and live-verified separately:

- `reports/retention-1/`: delete after 2 days.
- `reports/retention-7/`: delete after 8 days.
- `reports/retention-30/`: delete after 31 days.
- `EconPlanner/idempotency/`, `PathFinder/idempotency/`, `JobSearch/idempotency/`, `TreeService/idempotency/`, and `Test/idempotency/`: delete after 31 days in buckets where the caller exists.

New objects use `reports/retention-{days}/{uuid}/{Caller}/report.pdf`, optional `rendered.html`, and `reports/retention-{days}/{uuid}/manifest.json`. Retain temporary legacy `{Caller}/reports/retention-*` lifecycle rules until at least 32 days after the last old-layout deployment. The recipient route enforces the exact one-, seven-, or 30-day deadline from the manifest. Lifecycle deletion is the cleanup backstop. The service conditionally creates artifacts before the manifest and cleans only writes confirmed successful; an ambiguous timed-out write is left for lifecycle rather than risking deletion of an existing object. No business JSON is stored.

### Isolated Preview identity check

Use one private test bucket with no `r2.dev` or custom domain, and Object Read & Write credentials scoped only to that bucket. Scope those values to the verification Preview branch and compare the configured bucket exactly with the separately recorded approved test bucket.

Before any test-bucket write, use the same test credentials and jurisdiction-specific endpoint for this exact sequence:

1. `HeadBucket` for the approved test bucket must return exactly HTTP 200.
2. `HeadBucket` for the Production bucket must return exactly HTTP 403 Forbidden.

Any other result stops the run. Do not require an error body or named error code from `HeadBucket`. Never issue a modifying request against the Production bucket, and do not fall back to another Production request. Production lifecycle configuration may be inspected read-only with `GetBucketLifecycleConfiguration`; these pull requests create no Production canary or other Production object.

All lifecycle canaries belong only in the dedicated test bucket. Use test rules of two, eight, and 31 days for retention-1, retention-7, and retention-30; observe them on days 3, 9, and 32. The day-3 readiness gate is deletion of the test-bucket retention-1 canary. It does not verify Production deletion. Actual Production deletion requires a later separately authorized Production observation.

## Observability and incident handling

Logs contain only event name, request ID, caller, status/error code, durations, byte counts, page count, and storage mode. Do not add raw HTML, filenames, metadata, authorization headers, personal data, or full stacks.

Useful checks:

- `GET /api/health` is public and returns only basic service health.
- `GET /api/v1/diagnostics` requires an application bearer key and reports versions plus redacted configuration readiness.
- `renderer_busy` means another Chromium render is active in that function instance and returns `Retry-After: 1` before rendering begins.
- `rate_limited` returns `Retry-After: 60`. Production remains 10 accepted renders per caller per 60 seconds.
- Callers use no more than five attempts or 15 seconds, retry only `renderer_busy`, and reuse one idempotency key for stored retries. Direct requests never carry an idempotency key and do not retry ambiguous outcomes.
- EconPlanner, PathFinder, Job Search, and Tree Service each require their own integration, feature-flag fallback, and rollback gate. Service tests alone do not authorize any caller.
- Keep the previous accepted Vercel deployment available for rollback. Application integrations keep their old renderer behind a flag until acceptance.

## Preview acceptance

Before production promotion, verify the full checklist from the approved plan: traced bundle size; five cold and twenty warm renders; ten simultaneous requests; no unexpected network activity; fail-closed fonts/images; generic one-page, flowing, and 25-marker fixtures; current fictional PathFinder shadow fixture; PDF structure/text/link/visual comparisons; idempotency races; injected partial R2 failure cleanup; open recipient links; exact 410 expiry; lifecycle cleanup; and log redaction.

Label results as unit tested, locally integrated, mock-storage tested, live Vercel tested, live R2 tested, or not live-verified.

After immediate test workflows, every run-owned report, manifest, HTML object, and idempotency mapping must be removed. Test prefixes must be empty except explicitly recorded lifecycle canaries. Each remaining canary ledger entry includes its exact test prefix, creation time, expected expiration, and scheduled observation date; an unidentified remainder fails acceptance.

## Change authority

Repository implementation and local tests do not authorize external changes. Publishing or altering Firewall rules, changing Vercel variables, creating buckets or tokens, changing lifecycle rules or Production secrets, writing any Production R2 object, merging, deploying, promoting, or activating an application all require later explicit authorization. Git branch creation, commit, push, and pull-request creation are also separate approval gates.
