# Shared caller contract

This is the application-neutral contract for Urveska applications that call the PDF Creation Service. It describes supported behavior; it does not activate a caller or approve a Production release.

## Supported basic PDF

A caller sends one completed, self-contained HTML document and receives one validated PDF. The caller chooses `Letter`, `A4`, or `Legal`, one portrait or landscape orientation for the whole document, margins from zero through two inches, and an optional expected page count from one through 25. Mixed page orientation is unsupported. A caller needing mixed orientation must keep its existing renderer or open a separate measured design task.

The caller owns its calculations, facts, templates, HTML, CSS, fonts, images, citations, filename, expected page count, and visual acceptance. Application-specific CSS stays in the caller; the shared service does not contain caller selectors or business rules. Assets must be embedded data URLs. When typography must be repeatable, the caller must embed and pin a WOFF2 font version rather than depend on an operating-system font.

`expectedPageCount` is an optional exact assertion, not a pagination instruction. Fixed-page documents and other deliberately paginated documents should use it when the caller knows the required count. Ordinary natural-flow documents should normally omit it unless exact page count is itself an application requirement. A supplied value remains strict: a different generated count returns `422 expected_page_count_mismatch`, and fixed-page marker/count validation is unchanged.

## Authentication and limits

- Send `Authorization: Bearer <application-key>` from server-side code only. Never expose the key to browser code, HTML, logs, or stored metadata.
- Send `Content-Type: application/json`. The entire request is limited to 4,000,000 bytes; UTF-8 HTML is limited to 3,500,000 bytes.
- Output is limited to 4,000,000 bytes and 25 pages. HTML is also limited to 10,000 DOM elements, depth 64, 2,000 CSS rules, and 100 images.
- The service blocks scripts, remote URLs, frames, forms, media, objects, and network fetches. Images and fonts must be embedded. Do not weaken those controls for a caller.
- Production admits at most 10 render requests per authenticated caller per 60 seconds. Authentication and rate-limit counters are caller-isolated.

## Direct and stored modes

For an ordinary direct response, set `storeResult:false` and `storeHtml:false`. Omit `retentionDays` and `idempotencyKey`. A successful response is `application/pdf`; the service writes no report object.

For a stored response, set `storeResult:true`, choose `retentionDays` as 1, 7, or 30, and send `storeHtml:true` only when the rendered HTML is required. Every stored request requires `idempotencyKey`.

Create the idempotency key once for the logical operation, before its first attempt. It must be 8-128 characters matching `[A-Za-z0-9._:-]+`; a random UUID or opaque application operation ID is recommended. It must not contain HTML, credentials, personal information, filenames, email addresses, or business data. The service stores only a one-way, caller-scoped hash of the key.

- While the original report is active, same caller + same key + same semantic request: return the original stored report with `storage.idempotentReplay:true`; do not create a second lasting report.
- Same caller + same key + materially different request: return `409 idempotency_conflict`; do not replace the first report.
- Different callers + the same text key: independent records and storage prefixes.
- `correlationId` may change between attempts for diagnostics. It does not change request identity. HTML, filename, page settings, storage options, retention, metadata, and expected page count do.

Stored PDFs, optional HTML, and their manifest share the exact report expiry and retention prefix. Report routes return `410` after the manifest expiry even if lifecycle deletion has not yet run. See [Operations](OPERATIONS.md) for deletion ownership and backstops.

## Errors and retries

Errors use `{ error: { code, message, requestId, correlationId?, details } }` and `Cache-Control: no-store`. Treat the server-generated `requestId` as an attempt identifier for support; do not use it as the caller's idempotency key.

- Retry only `429 renderer_busy`, which has `Retry-After: 1`, at most five total attempts and within a 15-second admission deadline. Reuse the stored operation's idempotency key.
- Return `429 rate_limited` (`Retry-After: 60`) to the user as a recoverable condition; do not hold an interactive call open.
- Do not automatically retry timeouts, `5xx`, storage failures, invalid requests, unsafe HTML, or direct-response ambiguity. A human or bounded recovery workflow may retry a stored request with its original key.
- A stored retry after an ambiguous response either replays the first report or safely completes one report. A changed payload must use a new key.

## Privacy and rollout boundary

The service accepts completed HTML, so callers must minimize personal data and must never send credentials, access tokens, signed URLs, or secrets in the HTML, metadata, filename, correlation ID, or idempotency key. Logs are limited to caller identity, opaque request IDs, status/error code, timings, byte/page counts, and storage mode. Stored R2 objects remain private; recipient links are unguessable application routes, not public bucket or presigned URLs.

No caller is activated by this contract. Each application must pass its own fictional Preview integration, visual acceptance, feature-flag rollback, and separate authorization before receiving or using a Production key.
