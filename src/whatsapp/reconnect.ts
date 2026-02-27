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
  onReconnect: (delayMs: number, statusCode?: number, reason?: string) => void;
  /** Called when the session is invalidated (logged out, bad session, forbidden). */
  onLoggedOut: () => void;
  /** Called when max reconnect attempts have been exhausted. */
  onMaxRetriesReached: () => void;
}

/**
 * Handles Baileys connection.update events and routes to the appropriate callback.
 *
 * Disconnect reason routing:
 * - 401 (loggedOut): session explicitly revoked -> onLoggedOut (delete auth)
 * - 440 (connectionReplaced): another session took over -> log warning, no reconnect
 * - All others (403, 408, 428, 500, 515, etc.): transient -> exponential backoff reconnect
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
    const errorMsg = (lastDisconnect?.error as Boom)?.message ?? 'unknown';

    // Session permanently invalidated — delete and require re-auth
    // Only 401 (loggedOut) is a true logout where WhatsApp explicitly revoked the session.
    // All other codes (connectionClosed, badSession, forbidden, etc.) are usually transient
    // and should be retried with the existing credentials.
    if (statusCode === DisconnectReason.loggedOut) {
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
    callbacks.onReconnect(delay, statusCode, errorMsg);
  }

  if (connection === 'open') {
    resetRetries();
    callbacks.onOpen();
  }
}
