/**
 * Camera panel: DOM painting + wiring only (mirrors instruments.ts) — all
 * protocol/reconnect/ack logic lives in video/video-transport.ts, all
 * decode/paint logic in video/renderer.ts. This file's only job is to
 * connect those to the DOM and to the two control-lifecycle events that
 * govern video (Problem 7D §3/§8): control becomes authenticated -> video
 * MAY start; control is lost/logs out -> video stops immediately.
 */

import { loadVideoEnabled, saveVideoEnabled } from '../video/preference.ts';
import { createCanvasRenderer } from '../video/renderer.ts';
import type { VideoTicketSource } from '../video/ticket-source.ts';
import type { VideoViewerState } from '../video/video-transport.ts';
import { VideoTransport } from '../video/video-transport.ts';
import { $ } from './dom.ts';

export interface VideoPanelHandle {
  /** Control just became authenticated (initial login, or a Problem 2
   * reconnect within the same mounted view) — starts video if the
   * operator has left it enabled. */
  onControlAuthenticated(): void;
  /** Control was lost (disconnect, logout, auth failure) — stops video
   * immediately and suppresses any auto-reconnect until control
   * re-authenticates (Problem 7D §8, a security property, not cosmetic). */
  onControlLost(): void;
  destroy(): void;
}

const STATE_TEXT: Record<VideoViewerState, string> = {
  disconnected: 'Video off',
  'requesting-ticket': 'Connecting…',
  connecting: 'Connecting…',
  registering: 'Connecting…',
  'waiting-for-publisher': 'Waiting for camera',
  live: '',
  reconnecting: 'Reconnecting…',
  error: 'Video error',
};

function formatAge(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function mountVideoPanel(
  ticketSource: VideoTicketSource | null,
  options: { readonly videoRelayUrl: string | undefined; readonly robotId: string },
): VideoPanelHandle {
  const toggleButton = $('#btn-video-toggle', HTMLButtonElement);
  const frame = $('#video-frame', HTMLElement);
  const status = $('#video-status', HTMLElement);
  const fpsValue = $('#video-fps', HTMLElement);
  const bitrateValue = $('#video-bitrate', HTMLElement);
  const droppedValue = $('#video-dropped', HTMLElement);
  const ageValue = $('#video-age', HTMLElement);

  if (options.videoRelayUrl === undefined || ticketSource === null) {
    status.textContent = 'No video relay configured';
    toggleButton.disabled = true;
    return { onControlAuthenticated() {}, onControlLost() {}, destroy() {} };
  }

  const canvas = $('#video-canvas', HTMLCanvasElement);
  const renderer = createCanvasRenderer(canvas);
  const transport = new VideoTransport({
    url: options.videoRelayUrl,
    robotId: options.robotId,
    ticketSource,
    renderer,
  });

  let controlAuthenticated = false;
  let enabled = loadVideoEnabled();

  function paintToggle(): void {
    toggleButton.textContent = `Video: ${enabled ? 'On' : 'Off'}`;
    toggleButton.setAttribute('aria-pressed', String(enabled));
  }

  function paintState(): void {
    frame.dataset.state = transport.state;
    status.textContent = STATE_TEXT[transport.state];
  }

  // Bitrate is derived here (kbps over the last paint interval), not
  // stored in VideoStats itself — it is a UI-refresh-rate concern, not a
  // transport concern.
  let lastBytes = 0;
  let lastBytesAtMs = Date.now();

  function paintStats(): void {
    const snap = transport.stats;
    const now = Date.now();
    const dtS = (now - lastBytesAtMs) / 1000;
    const kbps = dtS > 0 ? Math.max(0, ((snap.bytesReceived - lastBytes) * 8) / 1000 / dtS) : 0;
    lastBytes = snap.bytesReceived;
    lastBytesAtMs = now;

    fpsValue.textContent = snap.fps.toFixed(1);
    bitrateValue.textContent = snap.framesReceived === 0 ? '—' : `${kbps.toFixed(0)} kbps`;
    droppedValue.textContent = String(snap.framesMissing + snap.framesFailedDecode);
    ageValue.textContent = formatAge(snap.lastFrameAtMs === null ? null : now - snap.lastFrameAtMs);
  }

  const unsubscribeState = transport.subscribe(paintState);
  const statsTimer = setInterval(paintStats, 1000);

  function onToggleClick(): void {
    enabled = !enabled;
    saveVideoEnabled(enabled);
    paintToggle();
    if (enabled) {
      if (controlAuthenticated) transport.connect();
    } else {
      transport.disconnect();
    }
  }
  toggleButton.addEventListener('click', onToggleClick);

  // Hidden tab: pause rather than let a throttled tab's timers miss
  // ACK_TIMEOUT_MS and get evicted by the relay for no useful reason
  // (Problem 7D §18). Visible again: resume only if control is still
  // authenticated AND the operator still has video enabled — a
  // visibilitychange must never itself re-authorize video control loss
  // already revoked.
  function onVisibilityChange(): void {
    if (document.hidden) {
      transport.pause();
    } else if (controlAuthenticated && enabled) {
      transport.resume();
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  paintToggle();
  paintState();

  return {
    onControlAuthenticated() {
      controlAuthenticated = true;
      if (enabled) transport.connect();
    },
    onControlLost() {
      controlAuthenticated = false;
      transport.disconnect();
    },
    destroy() {
      unsubscribeState();
      clearInterval(statsTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      toggleButton.removeEventListener('click', onToggleClick);
      transport.disconnect();
    },
  };
}
