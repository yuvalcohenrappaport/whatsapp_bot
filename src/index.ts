// Silence libsignal's console.* calls — they dump SessionEntry (privKey/rootKey/etc.)
// to stdout, which PM2 captures into bot-out.log. Must run before any libsignal import.
for (const method of ['info', 'warn', 'error', 'log'] as const) {
  const original = console[method];
  console[method] = (...args: unknown[]) => {
    const stack = new Error().stack ?? '';
    if (stack.includes('node_modules/libsignal/')) return;
    original(...args);
  };
}

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
import { handleHistorySync } from './whatsapp/historySync.js';
import { importChats } from './importer/importChats.js';
import { getState, updateState } from './api/state.js';
import { createServer } from './api/server.js';
import { initGroupPipeline } from './groups/groupMessagePipeline.js';
import { initReminderScheduler } from './groups/reminderScheduler.js';
import { validateElevenLabsConnection } from './voice/client.js';
import { initPersonalCalendarAuth } from './calendar/personalCalendarService.js';
import { initReminderSystem } from './reminders/reminderService.js';
import { initScheduledMessageScheduler } from './scheduler/scheduledMessageService.js';
import { initApprovalSystem } from './approval/approvalInit.js';

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

  initPersonalCalendarAuth();
  logger.info('Personal calendar auth initialized');

  await validateElevenLabsConnection(logger);
  // Note: result is intentionally not checked — failure is logged as warning, bot continues

  await importChats(config.IMPORT_DIR, config.PROCESSED_DIR, config.OWNER_EXPORT_NAME);
  logger.info('Chat import complete');

  const server = await createServer();
  await server.listen({ port: config.API_PORT, host: config.API_HOST });
  logger.info(`API server listening on ${config.API_HOST}:${config.API_PORT}`);

  initGroupPipeline();
  logger.info('Group pipeline initialized');

  initReminderScheduler();
  logger.info('Reminder scheduler initialized');

  // Note: initReminderSystem() is called in onOpen callback (needs sock for recovery messages)

  await startSocket();
}

/**
 * Creates a fresh Baileys socket and wires connection event handlers.
 *
 * This function is called recursively on reconnect — each call creates a
 * new socket instance (Baileys sockets cannot be reused after close).
 */
async function startSocket(): Promise<void> {
  // Close previous socket before creating a new one
  const prevSock = getState().sock;
  if (prevSock) {
    try {
      prevSock.end(undefined);
      prevSock.ws?.close();
    } catch { /* already closed */ }
  }

  const { sock } = await createSocket();
  updateState({ sock });

  const callbacks: ConnectionCallbacks = {
    onQR(qr: string) {
      logger.info('QR code received — scan with your WhatsApp app');
      qrcode.generate(qr, { small: true });
      updateState({ connection: 'qr_pending', qr });
    },

    onOpen() {
      logger.info('Connected to WhatsApp');
      const botJid = sock.user?.id ?? null;
      const botDisplayName = sock.user?.notify ?? sock.user?.name ?? null;
      updateState({ connection: 'connected', qr: null, sock, botJid, botDisplayName });

      // Initialize reminder system after connection (needs sock for recovery messages)
      initReminderSystem().catch((err) => {
        logger.error(err, 'Failed to initialize reminder system');
      });

      initScheduledMessageScheduler().catch((err) => {
        logger.error(err, 'Failed to initialize scheduled message scheduler');
      });

      // Phase 41 approval UX — wires debounce flush callback, starts 7-day
      // expiry scan, and runs the one-time first-boot digest. Idempotent on
      // reconnect. Must run AFTER sock is connected so the digest can send.
      initApprovalSystem().catch((err) => {
        logger.error(err, 'Failed to initialize approval system');
      });
    },

    onReconnect(delayMs: number, statusCode?: number, reason?: string) {
      logger.warn({ delayMs, statusCode, reason }, 'Scheduling reconnect...');
      updateState({ connection: 'reconnecting', qr: null });
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
      updateState({ connection: 'disconnected', qr: null, sock: null });
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

  sock.ev.on('messaging-history.set', handleHistorySync);
}

// Graceful shutdown — close socket cleanly so WhatsApp doesn't invalidate the session
function gracefulShutdown(signal: string): void {
  logger.info(`Received ${signal} — shutting down gracefully...`);
  updateState({ isShuttingDown: true });

  const sock = getState().sock;
  try {
    sock?.end(undefined);
    sock?.ws?.close();
  } catch { /* already closed */ }

  // Give the socket time to close cleanly, then exit
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled errors — log but don't crash (PM2 restart loop prevention)
process.on('uncaughtException', (err) => {
  logger.error(err, 'Uncaught exception');
});
process.on('unhandledRejection', (reason) => {
  logger.error(reason, 'Unhandled rejection');
});

main().catch((err) => {
  logger.fatal(err, 'Fatal error during startup');
  process.exit(1);
});
