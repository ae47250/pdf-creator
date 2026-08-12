import { describe, expect, it, vi } from 'vitest';
import { rendererIdentityFromVersion, resolveBrowserExecutable } from '@/lib/pdf/renderer';

const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const windowsEdge = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
const windowsEdgeX86 = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const macEdge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const macChromium = '/Applications/Chromium.app/Contents/MacOS/Chromium';

function existing(...paths: string[]): (path: string) => boolean {
  const values = new Set(paths);
  return (path) => values.has(path);
}

describe('browser executable resolution', () => {
  it.each([
    ['HeadlessChrome/149.0.7758.0', true, { source: 'installed', product: 'HeadlessChrome', version: '149.0.7758.0' }],
    ['Chromium/149.0.7758.0', false, { source: 'bundled', product: 'Chromium', version: '149.0.7758.0' }]
  ] as const)('records the actual browser identity for %s', (version, local, expected) => {
    expect(rendererIdentityFromVersion(version, local)).toEqual(expected);
  });

  it('gives an explicit CHROME_PATH first priority', async () => {
    const bundledExecutablePath = vi.fn(async () => 'bundled-chromium');
    const result = await resolveBrowserExecutable({
      explicitPath: '/custom/browser',
      platform: 'darwin',
      architecture: 'arm64',
      pathExists: existing('/custom/browser', macChrome),
      bundledExecutablePath
    });

    expect(result).toEqual({ path: '/custom/browser', local: true });
    expect(bundledExecutablePath).not.toHaveBeenCalled();
  });

  it('rejects an unreadable explicit CHROME_PATH', async () => {
    await expect(resolveBrowserExecutable({
      explicitPath: '/missing/browser',
      pathExists: () => false
    })).rejects.toMatchObject({ code: 'service_unavailable', status: 503 });
  });

  it('keeps Windows Chrome ahead of Edge', async () => {
    await expect(resolveBrowserExecutable({
      explicitPath: '',
      platform: 'win32',
      pathExists: existing(windowsChrome, windowsEdge)
    })).resolves.toEqual({ path: windowsChrome, local: true });
  });

  it.each([
    ['64-bit', windowsEdge],
    ['32-bit', windowsEdgeX86]
  ])('keeps the Windows Edge %s fallback', async (_label, edgePath) => {
    await expect(resolveBrowserExecutable({
      explicitPath: '',
      platform: 'win32',
      pathExists: existing(edgePath)
    })).resolves.toEqual({ path: edgePath, local: true });
  });

  it('selects macOS Chrome when present', async () => {
    await expect(resolveBrowserExecutable({
      explicitPath: '',
      platform: 'darwin',
      homeDirectory: '/Users/tester',
      pathExists: existing(macChrome, macEdge)
    })).resolves.toEqual({ path: macChrome, local: true });
  });

  it('selects macOS Edge when Chrome is absent', async () => {
    await expect(resolveBrowserExecutable({
      explicitPath: '',
      platform: 'darwin',
      homeDirectory: '/Users/tester',
      pathExists: existing(macEdge)
    })).resolves.toEqual({ path: macEdge, local: true });
  });

  it('selects macOS Chromium when Chrome and Edge are absent', async () => {
    await expect(resolveBrowserExecutable({
      explicitPath: '',
      platform: 'darwin',
      homeDirectory: '/Users/tester',
      pathExists: existing(macChromium)
    })).resolves.toEqual({ path: macChromium, local: true });
  });

  it.each([
    ['Chrome', '/Users/tester/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    ['Edge', '/Users/tester/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    ['Chromium', '/Users/tester/Applications/Chromium.app/Contents/MacOS/Chromium']
  ])('supports user-local macOS %s', async (_label, browserPath) => {
    await expect(resolveBrowserExecutable({
      explicitPath: '',
      platform: 'darwin',
      homeDirectory: '/Users/tester',
      pathExists: existing(browserPath)
    })).resolves.toEqual({ path: browserPath, local: true });
  });

  it.each(['linux', 'darwin'] as const)('preserves the bundled Chromium fallback on x64 %s', async (platform) => {
    const bundledExecutablePath = vi.fn(async () => 'bundled-chromium');
    await expect(resolveBrowserExecutable({
      explicitPath: '',
      platform,
      architecture: 'x64',
      homeDirectory: '/Users/tester',
      pathExists: () => false,
      bundledExecutablePath
    })).resolves.toEqual({ path: 'bundled-chromium', local: false });
    expect(bundledExecutablePath).toHaveBeenCalledOnce();
  });

  it('keeps the non-x64 bundled Chromium guard when no local browser exists', async () => {
    await expect(resolveBrowserExecutable({
      explicitPath: '',
      platform: 'darwin',
      architecture: 'arm64',
      homeDirectory: '/Users/tester',
      pathExists: () => false
    })).rejects.toMatchObject({ code: 'service_unavailable', status: 503 });
  });
});
