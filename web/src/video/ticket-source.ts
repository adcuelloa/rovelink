/**
 * The only intentional bridge between control and video (Problem 7D §1):
 * `VideoTransport` depends on this narrow interface, never on
 * `WebSocketTransport` or `RobotTransport` directly, and never on
 * `CONTROLLER_SECRET` — it can only ever ask an already-authenticated
 * control connection for a ticket, never authenticate on its own.
 * `WebSocketTransport` implements this (see transport/websocket.ts's
 * `requestVideoTicket()`); tests inject a fake.
 */

export interface VideoTicket {
  readonly ticket: string;
  readonly expiresAt: number;
}

export type VideoTicketOutcome =
  | ({ readonly ok: true } & VideoTicket)
  /** No credential is ever exposed here — only why a ticket didn't arrive:
   * the control socket wasn't open, the relay didn't answer in time, or it
   * closed/reconnected while the request was outstanding. */
  | { readonly ok: false; readonly reason: 'disconnected' | 'timeout' | 'superseded' };

export interface VideoTicketSource {
  /** At most one outstanding request at a time (Problem 7D §4): a second
   * call while one is pending resolves the first as `superseded` rather
   * than leaving it to hang or inventing correlation-id matching the wire
   * protocol doesn't have. */
  requestVideoTicket(): Promise<VideoTicketOutcome>;
}
