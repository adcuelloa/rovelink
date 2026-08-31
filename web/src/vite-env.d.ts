/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cloudflare relay base URL, e.g. `wss://relay.example.workers.dev`. */
  readonly VITE_RELAY_URL?: string;
  /** Dedicated video relay base URL (Problem 7B-7D) — always a SEPARATE
   * deployment from VITE_RELAY_URL, never the same Worker. Unset disables
   * the video panel rather than failing (see video/ticket-source.ts). */
  readonly VITE_VIDEO_RELAY_URL?: string;
  /** Robot this interface connects to. */
  readonly VITE_ROBOT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
