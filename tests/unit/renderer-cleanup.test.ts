import { afterEach, describe, expect, it, vi } from 'vitest';

const browser = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  connected: true,
  newPage: vi.fn(),
  process: vi.fn(() => undefined),
  version: vi.fn(async () => 'HeadlessChrome/149.0.0.0')
}));
const launch = vi.hoisted(() => vi.fn());

vi.mock('puppeteer-core', () => ({ default: { launch } }));
vi.mock('@sparticuz/chromium', () => ({
  default: { args: [], executablePath: vi.fn(async () => 'mock-chromium') }
}));

import { renderPdf } from '@/lib/pdf/renderer';

const request = {
  html: '<!doctype html><html><head></head><body>late browser</body></html>',
  filename: 'Late_Browser.pdf',
  storeResult: false,
  storeHtml: false,
  page: {
    format: 'Letter' as const,
    orientation: 'portrait' as const,
    marginsInches: { top: 0, right: 0, bottom: 0, left: 0 }
  }
};

describe('renderer launch cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('closes a browser that resolves after the launch timeout', async () => {
    vi.useFakeTimers();
    launch.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(browser), 30_001);
    }));

    const rendering = renderPdf(request, 'test');
    const rejection = expect(rendering).rejects.toMatchObject({ code: 'render_timeout' });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('aborts and rejects an outbound browser request', async () => {
    type RequestListener = (request: { url(): string; abort(reason: string): Promise<void>; continue(): Promise<void> }) => void;
    const listeners: RequestListener[] = [];
    const outbound = {
      url: () => 'https://127.0.0.1/private',
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined)
    };
    const page = {
      close: vi.fn(async () => undefined),
      emulateMediaType: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
      off: vi.fn(),
      on: vi.fn((event: string, listener: RequestListener) => {
        if (event === 'request') listeners.push(listener);
      }),
      setContent: vi.fn(async () => {
        for (const listener of listeners) listener(outbound);
      }),
      setJavaScriptEnabled: vi.fn(async () => undefined),
      setRequestInterception: vi.fn(async () => undefined)
    };
    browser.newPage.mockResolvedValueOnce(page);
    launch.mockResolvedValueOnce(browser);

    await expect(renderPdf(request, 'test')).rejects.toMatchObject({ code: 'unsafe_html' });
    expect(outbound.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(outbound.continue).not.toHaveBeenCalled();
  });
});
