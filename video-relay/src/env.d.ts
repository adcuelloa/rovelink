import type { Env as WorkerEnv } from './index.ts';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
