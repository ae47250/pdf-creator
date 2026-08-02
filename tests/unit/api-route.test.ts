import { describe, expect, it, vi } from 'vitest';
import { PdfServiceError } from '@/lib/pdf/errors';

const auth = vi.hoisted(() => ({
  authenticateBearer: vi.fn(() => ({ id: 'pathfinder', mayStore: true, maxRetentionDays: 30, rateLimitPerMinute: 10 }))
}));
const contract = vi.hoisted(() => ({
  readJsonRequest: vi.fn(async () => ({})),
  parsePdfCreationRequest: vi.fn(() => ({ correlationId: 'corr-1' }))
}));
const service = vi.hoisted(() => ({ createPdf: vi.fn() }));

vi.mock('@/lib/pdf/auth', () => auth);
vi.mock('@/lib/pdf/contract', () => contract);
vi.mock('@/lib/pdf/service', () => service);

import { POST } from '@/app/api/v1/pdfs/route';

describe('PDF API route diagnostics', () => {
  it('logs an authenticated caller on a controlled service failure', async () => {
    service.createPdf.mockRejectedValueOnce(new PdfServiceError('storage_failed', 502, 'Storage failed.'));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const response = await POST(new Request('http://localhost/api/v1/pdfs', {
      method: 'POST',
      headers: { authorization: 'Bearer configured', 'content-type': 'application/json' },
      body: '{}'
    }));

    expect(response.status).toBe(502);
    expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({
      event: 'pdf_failed',
      caller: 'pathfinder',
      code: 'storage_failed',
      status: 502
    });
    info.mockRestore();
  });
});
