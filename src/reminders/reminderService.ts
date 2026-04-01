import { randomUUID } from 'node:crypto';
import type { WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import {
  hasReminderIntent,
  parseReminderCommand,
  matchReminderForCancelEdit,
} from './reminderParser.js';
import {
  scheduleReminder,
  cancelScheduledReminder,
  startHourlyScan,
  scheduleAllUpcoming,
} from './reminderScheduler.js';
import {
  insertReminder,
  getReminderById,
  getPendingReminders,
  getPendingOverdue,
  updateReminderStatus,
  updateReminderCalendarEventId,
  updateReminderFireAt,
  updateReminderTask,
  updateReminderTodoIds,
} from '../db/queries/reminders.js';
import {
  createPersonalCalendarEvent,
  getSelectedCalendarId,
} from '../calendar/personalCalendarService.js';
import { createTodoTask, deleteTodoTask } from '../todo/todoService.js';
import { isTasksConnected } from '../todo/todoAuthService.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Google Tasks sync helper ────────────────────────────────────────────────

async function syncReminderToTasks(id: string, task: string, fireAt: number): Promise<void> {
  if (!isTasksConnected()) return;
  try {
    const result = await createTodoTask({
      title: `⏰ ${task}`,
      note: `Reminder due: ${timeFormatter.format(new Date(fireAt))}`,
    });
    updateReminderTodoIds(id, result.taskId, result.listId);
  } catch (err) {
    logger.warn({ err, id }, 'Failed to sync reminder to Google Tasks');
  }
}

async function deleteReminderFromTasks(reminder: { todoTaskId?: string | null; todoListId?: string | null }): Promise<void> {
  if (reminder.todoTaskId && reminder.todoListId) {
    try {
      await deleteTodoTask(reminder.todoTaskId, reminder.todoListId);
    } catch (err) {
      logger.warn({ err }, 'Failed to delete reminder from Google Tasks');
    }
  }
}

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

// ─── Disambiguation state ────────────────────────────────────────────────────

/** Pending cancel disambiguation: choice number -> reminder ID */
let pendingCancelIds: Map<number, string> | null = null;

/** Pending edit disambiguation: choice number -> reminder ID */
let pendingEditIds: Map<number, string> | null = null;

/** Stored edit params for disambiguation follow-up */
let pendingEditParams: { editNewTime?: string; editNewTask?: string } | null = null;

// ─── Fire handler ────────────────────────────────────────────────────────────

/**
 * Fire a reminder: mark as fired in DB and send WhatsApp message.
 * Gets sock lazily from state at fire time (sock may not exist at schedule time).
 */
export async function fireReminder(id: string): Promise<void> {
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

// ─── Cancel/Edit executors ───────────────────────────────────────────────────

async function executeCancelReminder(
  sock: WASocket,
  reminderId: string,
): Promise<boolean> {
  const reminder = getReminderById(reminderId);
  if (!reminder) return false;

  cancelScheduledReminder(reminderId);
  updateReminderStatus(reminderId, 'cancelled');

  // Delete from Google Tasks
  await deleteReminderFromTasks(reminder);

  if (reminder.calendarEventId) {
    logger.info(
      { reminderId, calendarEventId: reminder.calendarEventId },
      'Reminder cancelled — calendar event remains (manual deletion needed)',
    );
  }

  await sock.sendMessage(config.USER_JID, {
    text: `\u274C Cancelled: ${reminder.task}`,
  });

  logger.info({ reminderId, task: reminder.task }, 'Reminder cancelled');
  return true;
}

async function executeEditReminder(
  sock: WASocket,
  reminderId: string,
  editParams: { editNewTime?: string; editNewTask?: string } | null,
): Promise<boolean> {
  const reminder = getReminderById(reminderId);
  if (!reminder) return false;

  let updatedTask = reminder.task;
  let updatedFireAt = reminder.fireAt;

  if (editParams?.editNewTime) {
    const newFireAt = new Date(editParams.editNewTime).getTime();
    if (!isNaN(newFireAt)) {
      updateReminderFireAt(reminderId, newFireAt);
      updatedFireAt = newFireAt;

      // Reschedule: cancel old timer, set new one if within 24h
      cancelScheduledReminder(reminderId);
      const hoursUntil = (newFireAt - Date.now()) / 3_600_000;
      if (hoursUntil <= 24 && hoursUntil > 0) {
        scheduleReminder(reminderId, newFireAt, (id) => {
          fireReminder(id);
        });
      }
    }
  }

  if (editParams?.editNewTask) {
    updateReminderTask(reminderId, editParams.editNewTask);
    updatedTask = editParams.editNewTask;
  }

  const formattedTime = timeFormatter.format(new Date(updatedFireAt));
  await sock.sendMessage(config.USER_JID, {
    text: `\u270F\uFE0F Updated: ${updatedTask} \u2014 ${formattedTime}`,
  });

  logger.info({ reminderId, task: updatedTask, fireAt: updatedFireAt }, 'Reminder edited');
  return true;
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
  // --- Disambiguation handling (check FIRST before normal parsing) ---
  if (pendingCancelIds || pendingEditIds) {
    const trimmed = text.trim();
    const choiceNum = parseInt(trimmed, 10);

    if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= 9) {
      // Handle cancel disambiguation
      if (pendingCancelIds && pendingCancelIds.has(choiceNum)) {
        const reminderId = pendingCancelIds.get(choiceNum)!;
        pendingCancelIds = null;
        return await executeCancelReminder(sock, reminderId);
      }

      // Handle edit disambiguation
      if (pendingEditIds && pendingEditIds.has(choiceNum)) {
        const reminderId = pendingEditIds.get(choiceNum)!;
        const editParams = pendingEditParams;
        pendingEditIds = null;
        pendingEditParams = null;
        return await executeEditReminder(sock, reminderId, editParams);
      }
    }

    // Non-digit or out-of-range: clear disambiguation, continue normal flow
    pendingCancelIds = null;
    pendingEditIds = null;
    pendingEditParams = null;
  }

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

    // Sync to Google Tasks (fire-and-forget)
    syncReminderToTasks(id, task, fireAt).catch((error) => {
      console.error('Failed to sync reminder to tasks:', error);
    });

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

  if (parsed.intent === 'cancel') {
    const pending = getPendingReminders();
    if (pending.length === 0) {
      await sock.sendMessage(config.USER_JID, { text: 'No pending reminders to cancel.' });
      return true;
    }

    const target = parsed.editTarget ?? parsed.task ?? text;
    const matchResult = await matchReminderForCancelEdit(
      target,
      pending.map((r) => ({ id: r.id, task: r.task, fireAt: r.fireAt })),
    );

    const matchedIds = matchResult?.matchedIds ?? [];

    if (matchedIds.length === 1) {
      return await executeCancelReminder(sock, matchedIds[0]);
    }

    if (matchedIds.length > 1) {
      const matched = pending.filter((r) => matchedIds.includes(r.id));
      const choiceMap = new Map<number, string>();
      const lines = matched.map((r, i) => {
        choiceMap.set(i + 1, r.id);
        const time = timeFormatter.format(new Date(r.fireAt));
        return `${i + 1}. ${r.task} \u2014 ${time}`;
      });
      pendingCancelIds = choiceMap;
      await sock.sendMessage(config.USER_JID, {
        text: `Multiple reminders match. Reply with the number:\n${lines.join('\n')}`,
      });
      return true;
    }

    // No matches — show all pending
    const listLines = pending.map((r) => {
      const time = timeFormatter.format(new Date(r.fireAt));
      return `- ${r.task} \u2014 ${time}`;
    });
    await sock.sendMessage(config.USER_JID, {
      text: `No matching reminder found. Your pending reminders:\n${listLines.join('\n')}`,
    });
    return true;
  }

  if (parsed.intent === 'edit') {
    const pending = getPendingReminders();
    if (pending.length === 0) {
      await sock.sendMessage(config.USER_JID, { text: 'No pending reminders to edit.' });
      return true;
    }

    const target = parsed.editTarget ?? parsed.task ?? text;
    const matchResult = await matchReminderForCancelEdit(
      target,
      pending.map((r) => ({ id: r.id, task: r.task, fireAt: r.fireAt })),
    );

    const matchedIds = matchResult?.matchedIds ?? [];

    if (matchedIds.length === 1) {
      return await executeEditReminder(sock, matchedIds[0], {
        editNewTime: parsed.editNewTime,
        editNewTask: parsed.editNewTask,
      });
    }

    if (matchedIds.length > 1) {
      const matched = pending.filter((r) => matchedIds.includes(r.id));
      const choiceMap = new Map<number, string>();
      const lines = matched.map((r, i) => {
        choiceMap.set(i + 1, r.id);
        const time = timeFormatter.format(new Date(r.fireAt));
        return `${i + 1}. ${r.task} \u2014 ${time}`;
      });
      pendingEditIds = choiceMap;
      pendingEditParams = {
        editNewTime: parsed.editNewTime,
        editNewTask: parsed.editNewTask,
      };
      await sock.sendMessage(config.USER_JID, {
        text: `Multiple reminders match. Reply with the number:\n${lines.join('\n')}`,
      });
      return true;
    }

    // No matches
    const listLines = pending.map((r) => {
      const time = timeFormatter.format(new Date(r.fireAt));
      return `- ${r.task} \u2014 ${time}`;
    });
    await sock.sendMessage(config.USER_JID, {
      text: `No matching reminder found. Your pending reminders:\n${listLines.join('\n')}`,
    });
    return true;
  }

  return false;
}

// ─── Initialization ──────────────────────────────────────────────────────────

let reminderSystemInitialized = false;

/**
 * Initialize the reminder system: recover missed reminders, start hourly scan,
 * and schedule upcoming reminders.
 * Call after WhatsApp connection is established (sock must be available for recovery messages).
 * Safe to call on every reconnect — recovery and scheduling are idempotent,
 * and the hourly scan clears any previous interval.
 */
export async function initReminderSystem(): Promise<void> {
  // Recovery first — fires recent missed reminders and summarizes old ones
  await recoverReminders();

  // Hourly scan is safe to restart (clears previous interval internally)
  startHourlyScan((id) => {
    fireReminder(id);
  });

  scheduleAllUpcoming((id) => {
    fireReminder(id);
  });

  if (!reminderSystemInitialized) {
    logger.info('Reminder system initialized (with recovery)');
    reminderSystemInitialized = true;
  } else {
    logger.info('Reminder system re-initialized after reconnect');
  }
}
