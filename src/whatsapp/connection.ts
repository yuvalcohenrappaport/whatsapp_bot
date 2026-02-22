import makeWASocket, {
  useMultiFileAuthState,
  Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';

/**
 * Creates a fresh Baileys WebSocket connection with persistent auth state.
 *
 * IMPORTANT: Baileys sockets cannot be reused after close.
 * Each reconnect must call createSocket() to get a new socket instance.
 *
 * @returns The socket instance and saveCreds callback (for creds.update event)
 */
export async function createSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(config.AUTH_DIR);

  const logger = pino({ level: 'silent' }); // Suppress Baileys internal noise

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false, // Prevents stopping phone notifications
    getMessage: async () => undefined, // Stub — real DB lookup added in Phase 2+
  });

  // Persist session credentials after QR scan and on subsequent updates
  sock.ev.on('creds.update', saveCreds);

  return { sock, saveCreds };
}
