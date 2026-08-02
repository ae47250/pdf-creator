import { reportResponse } from '@/lib/storage/report-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ reportId: string }> }
): Promise<Response> {
  return reportResponse((await context.params).reportId, 'inline');
}
