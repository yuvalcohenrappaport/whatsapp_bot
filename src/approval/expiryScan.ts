/**
 * 7-day silent expiry scan for the Phase 41 approval UX.
 *
 * Runs hourly in the background. Flips every pending actionable whose
 * `detected_at` is older than 7 days to `status='expired'`. Silent — no
 * self-chat message. Idempotent — an already-expired row is filtered out
 * by `getExpiredActionables` (status='pending_approval'), so re-running
 * is a no-op.
 *
 * APPR-05 — Phase 41.
 */
import pino from 'pino';
import { config } from '../config.js';
import {
  getExpiredActionables,
  updateActionableStatus,
} from '../db/queries/actionables.js';

const logger = pino({ level: config.LOG_LEVEL });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Start (or restart) the hourly expiry scan. Idempotent — a second call
 * clears the previous interval before installing the new one. Fires once
 * immediately so a restart picks up anything that crossed the 7-day line
 * during downtime.
 */
export function startExpiryScan(intervalMs: number = ONE_HOUR_MS): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => {
    runOnce().catch((err) =>
      logger.error({ err }, 'expiry scan failed'),
    );
  }, intervalMs);
  // Fire immediately so a restart picks up anything that crossed 7d during downtime
  runOnce().catch((err) =>
    logger.error({ err }, 'expiry scan initial run failed'),
  );
}

/**
 * Stop the hourly scan. Test helper + shutdown hook.
 */
export function stopExpiryScan(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * Run one expiry pass synchronously. Returns the number of rows flipped.
 * Invalid-transition errors (shouldn't happen — `getExpiredActionables`
 * already filters to pending_approval) are logged and skipped so one bad
 * row doesn't abort the whole batch.
 */
export async function runOnce(): Promise<number> {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const expired = getExpiredActionables(cutoff);
  let count = 0;
  for (const a of expired) {
    try {
      updateActionableStatus(a.id, 'expired');
      count++;
    } catch (err) {
      logger.warn({ err, id: a.id }, 'expiry transition failed');
    }
  }
  if (count > 0) {
    logger.info({ count }, 'Expired pending actionables');
  }
  return count;
}
