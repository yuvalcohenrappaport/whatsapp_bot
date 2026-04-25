import * as cron from 'node-cron';
import pino from 'pino';
import { config } from '../config.js';
import {
  getExpiredActiveContexts,
  moveContextToArchive,
  markDecisionsArchivedForGroup,
} from '../db/queries/tripMemory.js';

const logger = pino({ level: config.LOG_LEVEL });

let scheduled: cron.ScheduledTask | null = null;

/**
 * Archive all expired trip contexts (end_date + 3 days < now).
 *
 * Per-group atomic: moveContextToArchive runs first (itself wrapped in a
 * drizzle transaction that inserts into trip_archive and deletes from
 * trip_contexts), THEN markDecisionsArchivedForGroup flips the decisions.
 *
 * Ordering matters for crash recovery: if the process dies between the two
 * steps, the trip is already fully archived (reads of trip_contexts won't see
 * it) and its decisions are still joinable via group_jid to trip_archive.
 * The inverse ordering would leave an "active trip with no decisions" window.
 *
 * A mid-run crash across multiple groups leaves the remaining groups for the
 * next run to pick up — each group is its own independent unit.
 *
 * Returns the count of fully-archived groups for logging + tests.
 */
export function runArchiveTripsOnce(nowMs = Date.now()): {
  archivedCount: number;
} {
  const expired = getExpiredActiveContexts(nowMs);
  let archivedCount = 0;

  for (const row of expired) {
    try {
      const result = moveContextToArchive(row.groupJid);
      if (!result) {
        // Row disappeared between the SELECT and the move (e.g. manual delete).
        // Skip — there's nothing to archive.
        logger.warn(
          { groupJid: row.groupJid },
          'moveContextToArchive returned null — skipping',
        );
        continue;
      }
      const decisionsFlipped = markDecisionsArchivedForGroup(row.groupJid);
      archivedCount++;
      logger.info(
        {
          groupJid: row.groupJid,
          archiveId: result.archiveId,
          decisionsFlipped,
        },
        'Trip archived',
      );
    } catch (err) {
      // Don't let one bad group poison the rest — log and continue. The next
      // tick will retry whichever groups still qualify.
      logger.error(
        { err, groupJid: row.groupJid },
        'Failed to archive trip — will retry next run',
      );
    }
  }

  if (archivedCount > 0) {
    logger.info({ archivedCount }, 'Archive trips cron run complete');
  }
  return { archivedCount };
}

/**
 * Register the daily 02:00 Asia/Jerusalem cron that archives expired trips.
 *
 * Idempotent — calling twice stops the previous job before registering the
 * new one. Supports dev hot-reload and guards against double-registration
 * if `initArchiveTripsCron` ever ends up wired into more than one startup
 * path.
 */
export function initArchiveTripsCron(): void {
  if (scheduled) {
    scheduled.stop();
    scheduled = null;
  }

  scheduled = cron.schedule(
    '0 2 * * *', // daily at 02:00 local-tz
    () => {
      try {
        runArchiveTripsOnce();
      } catch (err) {
        logger.error({ err }, 'Archive trips cron handler threw');
      }
    },
    { timezone: 'Asia/Jerusalem' },
  );
  logger.info('Archive trips cron initialized (daily 02:00 Asia/Jerusalem)');
}
