import { randomUUID } from 'node:crypto';
import type { WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import { hasReminderIntent, parseReminderCommand } from './reminderParser.js';
import {
  scheduleReminder,
  startHourlyScan,
  scheduleAllUpcoming,
} from './reminderScheduler.js';
import {
  insertReminder,
  getReminderById,
  getPendingOverdue,
  updateReminderStatus,
  updateReminderCalendarEventId,
} from '../db/queries/reminders.js';
import {
  createPersonalCalendarEvent,
  getSelectedCalendarId,
} from '../calendar/personalCalendarService.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Time formatting ─────────────────────────────────────────────────────────

const timeFormatter = new Intl.DateTimeFormat('en-IL', {
  timeZone: 'Asia/Jerusalem',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Compute tomorrow at 09:00 in Asia/Jerusalem timezone.
 */
function tomorrowNineAm(): number {
  const now = new Date();
  // Get current date in IST
  const istNow = new Date(
    now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }),
  );
  istNow.setDate(istNow.getDate() + 1);
  istNow.setHours(9, 0, 0, 0);

  // Convert back to UTC by computing the offset
  const utcStr = istNow.toLocaleString('en-US', { timeZone: 'UTC' });
  const istStr = istNow.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
  const offset = new Date(utcStr).getTime() - new Date(istStr).getTime();

  return istNow.getTime() + offset;
}

/**
 * Format a relative time difference for human readability (e.g., "3h ago", "2d ago").
 */
function formatRelativeTime(diffMs: number): string {
  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) return 'just now';
  if (absMs < 3_600_000) return `${Math.round(absMs / 60_000)}m ago`;
  if (absMs < 86_400_000) return `${Math.round(absMs / 3_600_000)}h ago`;
  return `${Math.round(absMs / 86_400_000)}d ago`;
}

// ─── Fire handler ────────────────────────────────────────────────────────────

/**
 * Fire a reminder: mark as fired in DB and send WhatsApp message.
 * Gets sock lazily from state at fire time (sock may not exist at schedule time).
 */
async function fireReminder(id: string): Promise<void> {
  try {
    const reminder = getReminderById(id);
    if (!reminder) {
      logger.warn({ id }, 'Reminder not found at fire time');
      return;
    }
    if (reminder.status !== 'pending') {
      logger.debug({ id, status: reminder.status }, 'Reminder already handled — skipping fire');
      return;
    }

    updateReminderStatus(id, 'fired');

    const sock = getState().sock;
    if (!sock) {
      logger.warn({ id }, 'No WhatsApp connection at reminder fire time');
      return;
    }

    await sock.sendMessage(config.USER_JID, {
      text: `\uD83D\uDD14 Reminder: ${reminder.task}`,
    });

    logger.info({ id, task: reminder.task }, 'Reminder fired');
  } catch (err) {
    logger.error({ err, id }, 'Error firing reminder');
  }
}

// ─── Restart recovery ────────────────────────────────────────────────────────

/**
 * Recover reminders missed during bot downtime.
 * - Missed by < 1 hour: fire immediately
 * - Missed by > 1 hour: mark as 'skipped' and send summary
 */
export async function recoverReminders(): Promise<void> {
  const now = Date.now();
  const overdue = getPendingOverdue(now);

  if (overdue.length === 0) {
    logger.info('No overdue reminders to recover');
    return;
  }

  const oneHourAgo = now - 3_600_000;
  const toFire: typeof overdue = [];
  const toSkip: typeof overdue = [];

  for (const r of overdue) {
    if (r.fireAt >= oneHourAgo) {
      toFire.push(r);
    } else {
      toSkip.push(r);
    }
  }

  // Fire recent missed reminders
  for (const r of toFire) {
    await fireReminder(r.id);
  }

  // Skip old missed reminders
  for (const r of toSkip) {
    updateReminderStatus(r.id, 'skipped');
  }

  // Send summary of skipped reminders to self-chat
  if (toSkip.length > 0) {
    const sock = getState().sock;
    if (sock) {
      const lines = toSkip.map(
        (r) => `- ${r.task} (was due ${formatRelativeTime(now - r.fireAt)})`,
      );
      await sock.sendMessage(config.USER_JID, {
        text: `\u23ED\uFE0F Missed ${toSkip.length} reminder(s) while offline:\n${lines.join('\n')}`,
      });
    }
  }

  logger.info(
    { fired: toFire.length, skipped: toSkip.length },
    'Reminder recovery complete',
  );
}

// ─── Command handler ─────────────────────────────────────────────────────────

/**
 * Try to handle a self-chat message as a reminder command.
 * Returns true if the message was handled (caller should stop processing).
 */
export async function tryHandleReminder(
  sock: WASocket,
  text: string,
): Promise<boolean> {
  if (!hasReminderIntent(text)) return false;

  const parsed = await parseReminderCommand(text);
  if (!parsed || parsed.intent === 'none') return false;

  if (parsed.intent === 'set') {
    // Determine fire time
    let fireAt: number;
    if (parsed.dateTime) {
      fireAt = new Date(parsed.dateTime).getTime();
      if (isNaN(fireAt)) {
        fireAt = tomorrowNineAm();
      }
    } else {
      fireAt = tomorrowNineAm();
    }

    const task = parsed.task ?? text;
    const id = randomUUID();

    // Insert into DB
    insertReminder({ id, task, fireAt });

    // Smart routing based on time distance
    const hoursUntil = (fireAt - Date.now()) / 3_600_000;

    if (hoursUntil <= 24) {
      // Near-term: schedule setTimeout for WhatsApp delivery
      scheduleReminder(id, fireAt, (remId) => {
        fireReminder(remId);
      });
    }

    // Calendar event for distant reminders (>24h)
    if (hoursUntil > 24) {
      const calendarId = getSelectedCalendarId();
      if (calendarId) {
        try {
          const eventId = await createPersonalCalendarEvent({
            calendarId,
            title: `Reminder: ${task}`,
            date: new Date(fireAt),
            description: `WhatsApp reminder: ${task}`,
          });
          if (eventId) {
            updateReminderCalendarEventId(id, eventId);
          }
        } catch (err) {
          logger.warn({ err, id }, 'Failed to create calendar event for reminder — WhatsApp delivery will still work');
        }
      } else {
        logger.debug({ id }, 'No calendar configured — skipping calendar event for distant reminder');
      }
    }

    // Format confirmation with delivery method indication
    const formattedTime = timeFormatter.format(new Date(fireAt));
    let confirmation: string;
    if (hoursUntil <= 24) {
      confirmation = `\u23F0 ${task} \u2014 ${formattedTime}`;
    } else if (hoursUntil <= 72) {
      confirmation = `\u23F0 ${task} \u2014 ${formattedTime} (calendar event created)`;
    } else {
      confirmation = `\u23F0 ${task} \u2014 ${formattedTime} (calendar event created, WhatsApp reminder at fire time)`;
    }

    await sock.sendMessage(config.USER_JID, { text: confirmation });

    logger.info({ id, task, fireAt, hoursUntil: hoursUntil.toFixed(1) }, 'Reminder set');
    return true;
  }

  if (parsed.intent === 'cancel' || parsed.intent === 'edit') {
    // Stub — Task 2 implements full cancel/edit logic with Gemini matching
    await sock.sendMessage(config.USER_JID, {
      text: 'Cancel/edit support coming soon.',
    });
    return true;
  }

  return false;
}

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize the reminder system: recover missed reminders, start hourly scan,
 * and schedule upcoming reminders.
 * Call after WhatsApp connection is established (sock must be available for recovery messages).
 */
export async function initReminderSystem(): Promise<void> {
  // Recovery first — fires recent missed reminders and summarizes old ones
  await recoverReminders();

  startHourlyScan((id) => {
    fireReminder(id);
  });

  scheduleAllUpcoming((id) => {
    fireReminder(id);
  });

  logger.info('Reminder system initialized (with recovery)');
}
