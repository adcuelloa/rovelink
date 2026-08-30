/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cloudflare relay base URL, e.g. `wss://relay.example.workers.dev`. */
  readonly VITE_RELAY_URL?: string;
  /** Robot this interface connects to. */
  readonly VITE_ROBOT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
