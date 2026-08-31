import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Test-only fixture credentials, not real secrets: wrangler.jsonc
      // declares these as required but (correctly) does not define them,
      // so tests supply their own here instead of reading .dev.vars or any
      // real Cloudflare secret. VIDEO_TICKET_SECRET here matches nothing
      // outside this test run — tests that need a ticket the video relay
      // will accept mint one directly with this same value (see
      // room.do.test.ts), which is exactly how the real control relay and
      // video relay agree on a ticket in production: same secret, both
      // sides.
      miniflare: {
        bindings: {
          VIDEO_PUBLISHER_SECRET: 'test-video-publisher-secret',
          VIDEO_TICKET_SECRET: 'test-video-ticket-secret',
        },
      },
    }),
  ],
  test: {
    include: ['src/**/*.do.test.ts'],
  },
});
