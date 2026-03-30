import pino from 'pino';
import { config } from '../config.js';
import { getScheduledMessagesInWindow } from '../db/queries/scheduledMessages.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── In-memory timer tracking ─────────────────────────────────────────────────

const activeTimers = new Map<string, NodeJS.Timeout>();

/**
 * Schedule a message to fire at a specific time.
 * - If already past: fires immediately.
 * - If > 24h away: skips (periodic scan will pick it up later).
 * - Otherwise: sets a setTimeout.
 */
export function scheduleMessage(
  id: string,
  fireAt: number,
  onFire: (id: string) => void,
): void {
  const delay = fireAt - Date.now();

  if (delay <= 0) {
    onFire(id);
    return;
  }

  // Cap at 24h — periodic scan handles anything beyond
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
  logger.debug({ id, delayMs: delay }, 'Scheduled message timer');
}

/**
 * Cancel a scheduled message timer.
 */
export function cancelScheduledMessage(id: string): void {
  const timer = activeTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(id);
    logger.debug({ id }, 'Cancelled scheduled message timer');
  }
}

// ─── Periodic scan tracking ───────────────────────────────────────────────────

let periodicScanTimer: NodeJS.Timeout | null = null;

/**
 * Start the 15-minute DB scan that promotes messages crossing
 * into the <24h window to setTimeout.
 * Safe to call multiple times (e.g., on reconnect) — clears any previous interval.
 */
export function startPeriodicScan(onFire: (id: string) => void): void {
  if (periodicScanTimer) {
    clearInterval(periodicScanTimer);
  }

  periodicScanTimer = setInterval(() => {
    try {
      const now = Date.now();
      const upcoming = getScheduledMessagesInWindow(now, now + 24 * 60 * 60 * 1000);
      for (const m of upcoming) {
        if (!activeTimers.has(m.id)) {
          scheduleMessage(m.id, m.scheduledAt, onFire);
        }
      }
      logger.debug(
        { scanned: upcoming.length, activeTimers: activeTimers.size },
        'Periodic scheduled message scan complete',
      );
    } catch (err) {
      logger.error({ err }, 'Error during periodic scheduled message scan');
    }
  }, 15 * 60 * 1000);

  logger.info('Periodic scheduled message scan started (15-minute interval)');
}

/**
 * Schedule all upcoming messages within 24h window (used on startup).
 */
export function scheduleAllUpcoming(onFire: (id: string) => void): void {
  const now = Date.now();
  const upcoming = getScheduledMessagesInWindow(now, now + 24 * 60 * 60 * 1000);
  for (const m of upcoming) {
    if (!activeTimers.has(m.id)) {
      scheduleMessage(m.id, m.scheduledAt, onFire);
    }
  }
  logger.info(
    { scheduled: upcoming.length, activeTimers: activeTimers.size },
    'Scheduled all upcoming messages',
  );
}

/**
 * Get the number of active in-memory timers (for debugging/dashboard).
 */
export function getActiveTimerCount(): number {
  return activeTimers.size;
}
