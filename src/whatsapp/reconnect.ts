import { DisconnectReason, type ConnectionState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { getState } from '../api/state.js';

const MAX_RETRIES = 10;
let retryCount = 0;

/** Reset retry count — called when connection opens successfully. */
export function resetRetries(): void {
  retryCount = 0;
}

/** Get current retry count (for logging/diagnostics). */
export function getRetryCount(): number {
  return retryCount;
}

export interface ConnectionCallbacks {
  /** Called when a QR code is available for scanning. */
  onQR: (qr: string) => void;
  /** Called when connection is successfully established. */
  onOpen: () => void;
  /** Called when a reconnect should be scheduled after a transient error. */
  onReconnect: (delayMs: number) => void;
  /** Called when the session is invalidated (logged out, bad session, forbidden). */
  onLoggedOut: () => void;
  /** Called when max reconnect attempts have been exhausted. */
  onMaxRetriesReached: () => void;
}

/**
 * Handles Baileys connection.update events and routes to the appropriate callback.
 *
 * Disconnect reason routing:
 * - 401 (loggedOut), 403 (forbidden), 405 (connectionClosed), 500 (badSession): session invalidated -> onLoggedOut
 * - 440 (connectionReplaced): another session took over -> log warning, no reconnect
 * - All others (408, 411, 428, 515, 503, etc.): transient -> exponential backoff reconnect
 * - connection === 'open': reset retry count -> onOpen
 * - QR code present: display for scanning -> onQR
 */
export function handleConnectionUpdate(
  update: Partial<ConnectionState>,
  callbacks: ConnectionCallbacks,
): void {
  const { connection, lastDisconnect, qr } = update;

  // QR code available — display it for the user to scan
  if (qr) {
    callbacks.onQR(qr);
  }

  if (connection === 'close') {
    if (getState().isShuttingDown) return;

    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

    // Session permanently invalidated — delete and require re-auth
    // 401 = loggedOut, 403 = forbidden, 405 = connectionClosed (stale session),
    // 500 = badSession
    if (
      statusCode === DisconnectReason.loggedOut ||
      statusCode === DisconnectReason.forbidden ||
      statusCode === DisconnectReason.connectionClosed ||
      statusCode === DisconnectReason.badSession
    ) {
      callbacks.onLoggedOut();
      return;
    }

    // Another device/session replaced this connection — do NOT reconnect
    if (statusCode === DisconnectReason.connectionReplaced) {
      // Log only; no reconnect (the other session is the active one)
      return;
    }

    // Transient error — reconnect with exponential backoff
    retryCount++;
    if (retryCount > MAX_RETRIES) {
      callbacks.onMaxRetriesReached();
      return;
    }

    const delay = Math.min(1000 * 2 ** (retryCount - 1), 60_000);
    callbacks.onReconnect(delay);
  }

  if (connection === 'open') {
    resetRetries();
    callbacks.onOpen();
  }
}
