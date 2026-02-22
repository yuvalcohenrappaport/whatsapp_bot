import pino from 'pino';
import { config } from './config.js';
import { db, initDb } from './db/client.js';

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

  logger.info(
    'WhatsApp Bot started (scaffold only — connection in next plan)',
  );
}

main().catch((err) => {
  logger.fatal(err, 'Fatal error during startup');
  process.exit(1);
});
