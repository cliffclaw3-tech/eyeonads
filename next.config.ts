import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@sparticuz/chromium', 'playwright-core'],
  outputFileTracingIncludes: {
    '/api/social-discovery': ['./node_modules/@sparticuz/chromium/bin/**/*', './node_modules/playwright-core/**/*'],
    '/api/discovery/worker': ['./node_modules/@sparticuz/chromium/bin/**/*', './node_modules/playwright-core/**/*'],
  },
};

export default nextConfig;
