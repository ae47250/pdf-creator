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

PathFinder migration is a separate task: add `data-pdf-page`, remove its citation script, and retain its existing renderer for shadow comparison and immediate rollback. Do not move PathFinder CSS, templates, business schema, or JSON artifacts into this service.

If a real fixture exceeds 3.5 MB of HTML, needs more than 25 pages, or fails marker-path visual comparison, do not weaken the contract. Keep the existing renderer and open a separate measured design task.
