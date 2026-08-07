# PDF Creation Service

An authenticated, application-neutral Next.js service that converts completed self-contained HTML into validated PDFs. It supports normal browser pagination and automatically switches to isolated one-page-per-marker rendering when `data-pdf-page` elements are present.

The service does not own application templates, business data, report calculations, CSS, fonts, images, or expected visual appearance. It does not fetch URLs or external assets.

## Local setup

Requirements: Node.js 24 and a local Chromium-compatible browser. Windows discovers Chrome or Edge; macOS discovers Chrome, Edge, or Chromium under `/Applications` or `~/Applications`. `CHROME_PATH` can select a specific executable and always takes priority.

```powershell
npm.cmd ci
$env:PDF_CREATION_TEST = '<43-character-base64url-key>'
npm.cmd run dev
```

Open `http://localhost:3000`. Development enables the internal console automatically. Stored mode also requires the private R2 variables described in [Operations](docs/OPERATIONS.md).

## API

`POST /api/v1/pdfs` requires `Content-Type: application/json` and `Authorization: Bearer <application-key>`. The request schema is [contracts/pdf-creation.schema.json](contracts/pdf-creation.schema.json), and the OpenAPI description is [contracts/openapi.yaml](contracts/openapi.yaml).

Minimal server-side example:

```js
const response = await fetch(`${process.env.PDF_CREATION_API_URL}/api/v1/pdfs`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.PDF_CREATION_API_KEY}`
  },
  body: JSON.stringify({
    html: '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial}</style></head><body><h1>Example</h1></body></html>',
    filename: 'Example.pdf',
    storeResult: false,
    page: {
      format: 'Letter',
      orientation: 'portrait',
      marginsInches: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 }
    },
    expectedPageCount: 1
  })
});

if (!response.ok) throw new Error(JSON.stringify(await response.json()));
const pdf = Buffer.from(await response.arrayBuffer());
```

The service can reject a request before rendering with `429 renderer_busy` and `Retry-After: 1`. Calling applications must follow the [shared caller contract](docs/CALLER_CONTRACT.md) and the bounded rollout procedure in [Migration](docs/MIGRATION.md). A `429 rate_limited` response uses `Retry-After: 60` and should be returned to the user rather than held open. Production remains limited to 10 accepted render requests per caller per 60 seconds; Preview may use 30 only for controlled verification.

Stored report links are service application routes (`/reports/{reportId}` and `/reports/{reportId}/download`), not presigned R2 URLs.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The test suite includes real local-Chrome PDF integration checks. No production deployment, R2 lifecycle rule, firewall rule, or environment variable is created by this repository.

See [Operations](docs/OPERATIONS.md) for configuration and incident procedures and [Migration](docs/MIGRATION.md) for application rollout boundaries.
