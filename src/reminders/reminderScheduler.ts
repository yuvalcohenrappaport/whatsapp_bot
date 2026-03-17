import pino from 'pino';
import { config } from '../config.js';
import { getRemindersInWindow } from '../db/queries/reminders.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── In-memory timer tracking ────────────────────────────────────────────────

const activeTimers = new Map<string, NodeJS.Timeout>();

/**
 * Schedule a reminder to fire at a specific time.
 * - If already past: fires immediately.
 * - If > 24h away: skips (hourly scan will pick it up later).
 * - Otherwise: sets a setTimeout.
 */
export function scheduleReminder(
  id: string,
  fireAt: number,
  onFire: (id: string) => void,
): void {
  const delay = fireAt - Date.now();

  if (delay <= 0) {
    onFire(id);
    return;
  }

  // Cap at 24h — hourly scan handles anything beyond
  if (delay > 24 * 60 * 60 * 1000) {
    return;
  }

  // Clear any existing timer for this ID (e.g., on reschedule)
  if (activeTimers.has(id)) {
    clearTimeout(activeTimers.get(id)!);
  }

  const timer = setTimeout(() => {
    activeTimers.delete(id);
    onFire(id);
  }, delay);

  activeTimers.set(id, timer);
  logger.debug({ id, delayMs: delay }, 'Scheduled reminder timer');
}

/**
 * Cancel a scheduled reminder timer.
 */
export function cancelScheduledReminder(id: string): void {
  const timer = activeTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(id);
    logger.debug({ id }, 'Cancelled scheduled reminder timer');
  }
}

// ─── Hourly scan tracking ─────────────────────────────────────────────────────

let hourlyScanTimer: NodeJS.Timeout | null = null;

/**
 * Start the hourly DB scan that promotes distant reminders crossing
 * into the <24h window to setTimeout.
 * Safe to call multiple times (e.g., on reconnect) — clears any previous interval.
 */
export function startHourlyScan(onFire: (id: string) => void): void {
  if (hourlyScanTimer) {
    clearInterval(hourlyScanTimer);
  }

  hourlyScanTimer = setInterval(() => {
    try {
      const now = Date.now();
      const upcoming = getRemindersInWindow(now, now + 24 * 60 * 60 * 1000);
      for (const r of upcoming) {
        if (!activeTimers.has(r.id)) {
          scheduleReminder(r.id, r.fireAt, onFire);
        }
      }
      logger.debug(
        { scanned: upcoming.length, activeTimers: activeTimers.size },
        'Hourly reminder scan complete',
      );
    } catch (err) {
      logger.error({ err }, 'Error during hourly reminder scan');
    }
  }, 3600_000);

  logger.info('Hourly reminder scan started');
}

/**
 * Schedule all upcoming reminders within 24h window (used on startup).
 */
export function scheduleAllUpcoming(onFire: (id: string) => void): void {
  const now = Date.now();
  const upcoming = getRemindersInWindow(now, now + 24 * 60 * 60 * 1000);
  for (const r of upcoming) {
    if (!activeTimers.has(r.id)) {
      scheduleReminder(r.id, r.fireAt, onFire);
    }
  }
  logger.info(
    { scheduled: upcoming.length, activeTimers: activeTimers.size },
    'Scheduled all upcoming reminders',
  );
}

/**
 * Get the number of active in-memory timers (for debugging/dashboard).
 */
export function getActiveTimerCount(): number {
  return activeTimers.size;
}
