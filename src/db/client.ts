import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import pino from 'pino';
import { config } from '../config.js';
import * as schema from './schema.js';

const sqlite = new Database(config.DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });

const logger = pino({ level: config.LOG_LEVEL });

export function initDb(): void {
  migrate(db, { migrationsFolder: './drizzle' });

  // Phase 39 — after 0021 backfill, replace the placeholder USER_JID on
  // backfilled user_command rows with the real value from config.USER_JID.
  // Idempotent: the UPDATE is a no-op once the placeholder is gone.
  let userJidFixed = 0;
  try {
    const result = sqlite
      .prepare(
        "UPDATE actionables SET source_contact_jid = ? WHERE source_contact_jid = 'USER_JID_PLACEHOLDER'",
      )
      .run(config.USER_JID);
    userJidFixed = result.changes;
  } catch (err) {
    // actionables table may not exist on a pre-0020 DB during a staged rollback
    logger.warn({ err }, 'actionables USER_JID fixup skipped');
  }

  // Phase 39 — one-time informational log so the first post-deploy startup
  // surfaces any backfill anomalies.
  try {
    const actionablesTotal = sqlite
      .prepare('SELECT COUNT(*) as c FROM actionables')
      .get() as { c: number };
    const legacyCommitment = sqlite
      .prepare(
        "SELECT COUNT(*) as c FROM reminders WHERE source = 'commitment'",
      )
      .get() as { c: number };
    const legacyTodoTasks = sqlite
      .prepare('SELECT COUNT(*) as c FROM todo_tasks')
      .get() as { c: number };
    logger.info(
      {
        actionables_total: actionablesTotal.c,
        legacy_reminders_commitment: legacyCommitment.c,
        legacy_todo_tasks: legacyTodoTasks.c,
        user_jid_fixed: userJidFixed,
      },
      'Post-migration table counts',
    );
  } catch (err) {
    logger.debug({ err }, 'Post-migration count log skipped');
  }
}
