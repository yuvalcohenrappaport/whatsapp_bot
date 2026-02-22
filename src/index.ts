import fs from 'node:fs/promises';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import { initDb } from './db/client.js';
import { createSocket } from './whatsapp/connection.js';
import {
  handleConnectionUpdate,
  type ConnectionCallbacks,
} from './whatsapp/reconnect.js';
import { createMessageHandler } from './pipeline/messageHandler.js';
import { importChats } from './importer/importChats.js';

const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

async function main(): Promise<void> {
  logger.info('Starting WhatsApp Bot...');

  initDb();
  logger.info('Database initialized');

  await importChats(config.IMPORT_DIR, config.PROCESSED_DIR, config.OWNER_EXPORT_NAME);
  logger.info('Chat import complete');

  await startSocket();
}

/**
 * Creates a fresh Baileys socket and wires connection event handlers.
 *
 * This function is called recursively on reconnect — each call creates a
 * new socket instance (Baileys sockets cannot be reused after close).
 */
async function startSocket(): Promise<void> {
  const { sock } = await createSocket();

  const callbacks: ConnectionCallbacks = {
    onQR(qr: string) {
      logger.info('QR code received — scan with your WhatsApp app');
      qrcode.generate(qr, { small: true });
    },

    onOpen() {
      logger.info('Connected to WhatsApp');
    },

    onReconnect(delayMs: number) {
      logger.warn({ delayMs }, 'Scheduling reconnect...');
      setTimeout(() => {
        startSocket().catch((err) => {
          logger.error(err, 'Failed to reconnect');
        });
      }, delayMs);
    },

    async onLoggedOut() {
      logger.error(
        'Session expired or invalidated — deleting auth state and exiting',
      );
      await fs.rm(config.AUTH_DIR, { recursive: true, force: true });
      logger.info(
        'Auth state deleted. Restart the bot to scan a new QR code.',
      );
      process.exit(1); // PM2 will restart; user re-scans QR
    },

    onMaxRetriesReached() {
      logger.fatal(
        'Max reconnect retries exhausted — exiting (PM2 will restart)',
      );
      process.exit(1);
    },
  };

  sock.ev.on('connection.update', (update) => {
    handleConnectionUpdate(update, callbacks);
  });

  sock.ev.on('messages.upsert', createMessageHandler(sock));
}

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM — shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT — shutting down...');
  process.exit(0);
});

main().catch((err) => {
  logger.fatal(err, 'Fatal error during startup');
  process.exit(1);
});
