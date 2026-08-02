import { randomUUID } from 'node:crypto';
import { isConsoleEnabled } from '@/lib/console-auth';
import packageJson from '@/package.json';
import { authenticateBearer } from '@/lib/pdf/auth';
import { errorResponse } from '@/lib/pdf/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const requestId = randomUUID();
  try {
    const caller = authenticateBearer(request.headers.get('authorization'));
    const r2Names = [
      'PDF_CREATION_R2_ACCOUNT_ID', 'PDF_CREATION_R2_BUCKET_NAME',
      'PDF_CREATION_R2_ACCESS_KEY_ID', 'PDF_CREATION_R2_SECRET_ACCESS_KEY'
    ];
    return Response.json({
      status: 'ok',
      requestId,
      caller: caller.id,
      versions: {
        service: packageJson.version,
        node: process.version,
        next: packageJson.dependencies.next,
        puppeteer: packageJson.dependencies['puppeteer-core'],
        chromium: packageJson.dependencies['@sparticuz/chromium']
      },
      runtime: { arch: process.arch, platform: process.platform },
      configuration: {
        storageReady: r2Names.every((name) => Boolean(process.env[name])),
        consoleEnabled: isConsoleEnabled(),
        chromeOverride: Boolean(process.env.CHROME_PATH)
      }
    }, { headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
