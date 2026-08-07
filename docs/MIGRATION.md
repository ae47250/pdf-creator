# Application migration

Calling applications continue to own calculations, facts, HTML, CSS, fonts, logos, images, citations, filenames, expected page counts, required text, and visual baselines. The service receives only completed self-contained HTML.

## HTML changes

- Include explicit doctype, html, head, and body elements.
- Inline CSS in `style` elements.
- Embed WOFF2 fonts and PNG/JPEG/WebP/safe-SVG images as base64 data URLs.
- Remove scripts and all runtime construction or loading.
- Use HTTPS citation links.
- Add non-nested `data-pdf-page` to every intended fixed page. Do not depend on `.sheet` or another application class for service behavior.
- Use the same format, orientation, and margins in application layout tests that are sent in the API envelope.

## Rollout

1. Generate a frozen fictional fixture in the application.
2. Submit it to an authorized preview service while retaining the existing renderer.
3. Compare page count and dimensions, extracted text/order, external link annotations, metadata, and per-page screenshots in one pinned environment.
4. Enable central rendering behind the application's feature flag for one application at a time.
5. Monitor errors and latency and perform a rollback drill.
6. Remove the old renderer only after the application's acceptance window.

Passing the service tests does not make an unchanged caller reliable. EconPlanner, PathFinder, Job Search, and Tree Service each stay disabled until its own bounded wrapper and fictional Preview fixture pass integration testing, its feature-flag rollback works, and activation is separately authorized.

## Required caller wrapper

- Retry only `429 renderer_busy`, at most five total attempts and never beyond a 15-second admission deadline.
- Require a valid `Retry-After` header. Wait for the greater of that value and full jitter from zero through `min(4 seconds, 2^(retryNumber-1) seconds)`.
- Do not start an attempt after the deadline.
- Return `429 rate_limited` as a recoverable user message; do not keep an interactive request open for 60 seconds.
- Create one opaque idempotency key before the first stored attempt and reuse it for busy retries and later recovery. A changed semantic payload gets a new key. Use a random UUID or an application operation ID; never derive the key from HTML, credentials, names, email addresses, or other personal information.
- Direct requests never send an idempotency key and retry only a pre-render `renderer_busy`; do not automatically retry direct timeouts or ambiguous 5xx responses.
- Keep API credentials on the server.

Each application must prove the limits above, retry exhaustion, correct PDF pages/dimensions/text/links/visuals, and a rollback drill. EconPlanner additionally verifies stored receipt/replay/view/download; PathFinder uses a frozen `data-pdf-page` fixture and shadow comparison; Job Search and Tree Service verify representative fictional reports in their actual direct or stored mode. Future callers pass the same gate before receiving a Production key.

PathFinder migration is a separate task: add `data-pdf-page`, remove its citation script, and retain its existing renderer for shadow comparison and immediate rollback. Do not move PathFinder CSS, templates, business schema, or JSON artifacts into this service.

If a real fixture exceeds 3.5 MB of HTML, needs more than 25 pages, or fails marker-path visual comparison, do not weaken the contract. Keep the existing renderer and open a separate measured design task.
