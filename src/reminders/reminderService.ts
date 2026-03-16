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

    // Calendar event for distant reminders
    if (hoursUntil > 24) {
      const calendarId = getSelectedCalendarId();
      if (calendarId) {
        const eventId = await createPersonalCalendarEvent({
          calendarId,
          title: `Reminder: ${task}`,
          date: new Date(fireAt),
          description: `WhatsApp reminder: ${task}`,
        });
        if (eventId) {
          updateReminderCalendarEventId(id, eventId);
        }
      }
    }

    // For reminders > 72h, also schedule for WhatsApp delivery at fire time
    // (hourly scan will pick it up when it enters the 24h window)

    // Format confirmation
    const formattedTime = timeFormatter.format(new Date(fireAt));
    const confirmation = `\u23F0 ${task} \u2014 ${formattedTime}`;

    await sock.sendMessage(config.USER_JID, { text: confirmation });

    logger.info({ id, task, fireAt, hoursUntil: hoursUntil.toFixed(1) }, 'Reminder set');
    return true;
  }

  if (parsed.intent === 'cancel' || parsed.intent === 'edit') {
    // Stub — Plan 02 implements full cancel/edit logic
    await sock.sendMessage(config.USER_JID, {
      text: 'Cancel/edit support coming soon.',
    });
    return true;
  }

  return false;
}

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize the reminder system: start hourly scan and schedule upcoming reminders.
 * Call from main() after DB is initialized. Sock is fetched lazily at fire time.
 */
export function initReminderSystem(): void {
  startHourlyScan((id) => {
    fireReminder(id);
  });

  scheduleAllUpcoming((id) => {
    fireReminder(id);
  });

  logger.info('Reminder system initialized');
}
