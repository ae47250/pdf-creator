# Mr. Lombardi PDF Demo Workflow

## Project

- Name: `alpha-pdf-demo`
- Local folder: `C:\Users\eiriksson\OneDrive - Hanover College\A\A-github`
- GitHub repo: `ae47250/A`
- Framework: Next.js App Router
- Main page: `app/page.js`
- PDF API route: `app/api/pdf/route.js`
- Static assets: `public/drum-set-1.svg`, `public/drum-set-2.svg`, `public/drum-set-3.svg`

## Current Status

- Local app runs at `http://localhost:3000` while the PowerShell dev server is running.
- Local production build passed with `npm run build`.
- Local browser PDF test passed after typing text into the form and clicking `Create PDF`.
- The app returned `PDF conversion successful. Opening PDF...` during the local test.
- Latest local Git status was clean before this document was added.
- Mobile layout changes are already committed in `a002c34 Improve mobile layout`.

## Important Public Release Check

Before giving the deployed Vercel link broadly, verify the deployed site after Vercel has rebuilt from the latest GitHub commit.

Required deployed-site check:

1. Open the Vercel URL.
2. Type fresh text into the text box.
3. Click `Create PDF`.
4. Confirm a PDF opens or downloads.
5. Confirm the page does not show a Chromium or PDF conversion error.

Reason: local PDF generation and deployed PDF generation use different browser paths. Local uses an installed Chrome or Edge browser when available. Vercel uses `@sparticuz/chromium`.

## User Workflow

1. User opens the web page.
2. User types text into the textarea.
3. User clicks `Create PDF`.
4. Frontend sends the text to `/api/pdf`.
5. Server validates the text.
6. Server builds a full HTML document from the text and image URLs.
7. Puppeteer opens that HTML in a headless browser.
8. Puppeteer prints the HTML page to a PDF buffer.
9. Server returns the PDF with `Content-Type: application/pdf`.
10. Frontend receives the PDF blob and opens it in a new browser tab.

## Frontend Details

File: `app/page.js`

The page stores user input in React state:

```js
const [text, setText] = useState('');
```

The textarea updates that state:

```js
onChange={(event) => setText(event.target.value)}
```

When the user clicks `Create PDF`, the browser sends JSON to the API:

```js
body: JSON.stringify({ text })
```

If the API returns a PDF, the browser creates a temporary blob URL:

```js
const pdfBlob = await response.blob();
const pdfUrl = URL.createObjectURL(pdfBlob);
window.open(pdfUrl, '_blank');
```

That blob URL is temporary and local to the browser session. It is not a permanent public file link.

## PDF API Details

File: `app/api/pdf/route.js`

The API accepts only `POST` requests through the exported `POST` function.

Input validation:

- Empty text returns `400`.
- Text over 5,000 characters returns `400`.
- Valid text continues to PDF generation.

The user text is escaped before entering the HTML:

```js
const safeText = escapeHtml(inputText).replace(/\n/g, '<br />');
```

This prevents typed HTML-like text from being treated as real HTML.

The generated HTML includes:

- A green banner.
- The `MR. LOMBARDI` heading.
- Three drum-set SVG images.
- A section titled `This is what you said:`.
- The escaped user text.
- A thank-you message.
- The generated date.

The image URLs are built from the current site origin:

```js
const origin = new URL(request.url).origin;
const drumOne = `${origin}/drum-set-1.svg`;
```

That means local testing uses URLs like:

```text
http://localhost:3000/drum-set-1.svg
```

The deployed site uses URLs from the deployed Vercel domain.

## Browser Selection Logic

The API first checks for a local installed browser:

```js
const localBrowserPath = localBrowserPaths.find((browserPath) => existsSync(browserPath));
```

If local Chrome or Edge exists, Puppeteer uses that path. This helps local Windows testing.

If no local browser path is found, Puppeteer uses:

```js
await chromium.executablePath()
```

That path comes from `@sparticuz/chromium`, which is intended for serverless environments such as Vercel.

## Vercel Chromium Configuration

File: `next.config.mjs`

The project includes:

```js
serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core']
```

and:

```js
outputFileTracingIncludes: {
  '/api/pdf': ['./node_modules/@sparticuz/chromium/bin/**/*']
}
```

Purpose:

- Keep Chromium-related files available to the deployed PDF API route.
- Avoid Vercel bundling or relocating Chromium in a way that breaks the executable path.

## Local Commands

Use these commands from PowerShell if Node is installed at `C:\ProgramsNew\Nodejs`:

```powershell
cd "C:\Users\eiriksson\OneDrive - Hanover College\A\A-github"
& "C:\ProgramsNew\Nodejs\npm.cmd" install
& "C:\ProgramsNew\Nodejs\npm.cmd" run build
& "C:\ProgramsNew\Nodejs\npm.cmd" run dev
```

Keep the PowerShell window open while using `http://localhost:3000`.

## Git Commands

Use the installed Git path if `git` is not on PATH:

```powershell
cd "C:\Users\eiriksson\OneDrive - Hanover College\A\A-github"
& "C:\Program Files\Git\cmd\git.exe" status
& "C:\Program Files\Git\cmd\git.exe" add .
& "C:\Program Files\Git\cmd\git.exe" commit -m "Describe change here"
& "C:\Program Files\Git\cmd\git.exe" push
```

## Files Changed During This Workflow

- `app/api/pdf/route.js`: added local browser fallback for Windows local testing while keeping Vercel Chromium support.
- `next.config.mjs`: added Vercel bundling configuration for `@sparticuz/chromium`.
- `app/page.js`: removed prefilled textarea text and improved narrow-screen/mobile layout.
- `package-lock.json`: recorded installed dependency versions.
- `WORKFLOW.md`: documents this workflow.

## Known Limits

- This is a learning demo, not a full document management system.
- Generated PDFs are opened as temporary browser blob URLs.
- The app does not save generated PDFs permanently.
- The app does not include authentication.
- The API accepts simple text input only.
- Public release should wait until the deployed Vercel PDF flow is confirmed after the latest deployment.
