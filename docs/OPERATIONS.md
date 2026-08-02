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
CHROME_PATH
```

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
- Define firewall rate-limit IDs `pdf-creation-econplanner`, `pdf-creation-pathfinder`, `pdf-creation-jobsearch`, `pdf-creation-treeservice`, and `pdf-creation-test`.
- Production callers: 10 render requests per minute. Test caller: 30 per minute. The SDK key is the authenticated caller ID.
- A missing Vercel firewall rule fails closed in Vercel. Local development skips the external firewall check.
- Keep the testing console disabled in production by omitting `PDF_CREATION_CONSOLE_ENABLED` or setting it to `false`.
- To enable it in production, set both `PDF_CREATION_CONSOLE_ENABLED=true` and a sensitive `PDF_CREATION_CONSOLE_PASSWORD`. The password gate issues an eight-hour secure, HTTP-only session cookie; neither this password nor `PDF_CREATION_TEST` reaches browser code.
- Protected previews may set it to `true` without the production password gate.
- Exclude `/reports/*` from production Deployment Protection. Possession of an unguessable report URL grants access until manifest expiry.

After a production build, inspect `.next/server/app/api/v1/pdfs` and its trace. If the uncompressed traced creation function exceeds 230 MB or Vercel rejects it, use only the approved fallback: `@sparticuz/chromium-min@149.0.0` with the exact x64 pack in private nearby R2 and verify its checksum. Do not use a latest or public GitHub pack URL.

## Private R2

Restrict the access token to one private bucket. Do not configure a public object domain or listing.

Lifecycle rules must be configured and live-verified separately:

- `reports/retention-1/`: delete after 2 days.
- `reports/retention-7/`: delete after 8 days.
- `reports/retention-30/`: delete after 31 days.

The recipient route enforces the exact one-, seven-, or 30-day deadline from the manifest. Lifecycle deletion is only the one-day cleanup backstop. The service uploads PDF and optional rendered HTML first, writes the manifest last, and deletes attempted artifacts after partial failures. No business JSON is stored.

## Observability and incident handling

Logs contain only event name, request ID, caller, status/error code, durations, byte counts, page count, and storage mode. Do not add raw HTML, filenames, metadata, authorization headers, personal data, or full stacks.

Useful checks:

- `GET /api/health` is public and returns only basic service health.
- `GET /api/v1/diagnostics` requires an application bearer key and reports versions plus redacted configuration readiness.
- `renderer_busy` means another Chromium render is active in that function instance.
- Callers retry transient failures with the same idempotency key. The service does not automatically rerender ambiguous requests.
- Keep the previous accepted Vercel deployment available for rollback. Application integrations keep their old renderer behind a flag until acceptance.

## Preview acceptance

Before production promotion, verify the full checklist from the approved plan: traced bundle size; five cold and twenty warm renders; ten simultaneous requests; no unexpected network activity; fail-closed fonts/images; generic one-page, flowing, and 25-marker fixtures; current fictional PathFinder shadow fixture; PDF structure/text/link/visual comparisons; idempotency races; injected partial R2 failure cleanup; open recipient links; exact 410 expiry; lifecycle cleanup; and log redaction.

Label results as unit tested, locally integrated, mock-storage tested, live Vercel tested, live R2 tested, or not live-verified.
