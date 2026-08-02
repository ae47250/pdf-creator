/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: [
    '@aws-sdk/client-s3',
    '@sparticuz/chromium',
    'puppeteer-core'
  ],
  outputFileTracingIncludes: {
    '/': ['./tests/fixtures/app-a-baseline.html'],
    '/api/v1/pdfs': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    '/api/console/pdfs': ['./node_modules/@sparticuz/chromium/bin/**/*']
  }
};

export default nextConfig;
