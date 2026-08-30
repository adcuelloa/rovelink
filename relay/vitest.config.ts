import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Test-only fixture credentials, not real secrets: wrangler.jsonc
      // declares DEVICE_SECRET/CONTROLLER_SECRET as required but (correctly)
      // does not define them, so tests supply their own here instead of
      // reading .dev.vars or any real Cloudflare secret.
      miniflare: {
        bindings: {
          DEVICE_SECRET: 'test-device-secret',
          CONTROLLER_SECRET: 'test-controller-secret',
        },
      },
    }),
  ],
  test: {
    include: ['src/**/*.do.test.ts'],
  },
});
