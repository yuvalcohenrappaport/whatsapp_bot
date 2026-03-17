import { eq, and, lte, gte, asc } from 'drizzle-orm';
import { db } from '../client.js';
import { reminders } from '../schema.js';

export function insertReminder(data: {
  id: string;
  task: string;
  fireAt: number;
  calendarEventId?: string | null;
  source?: string;
  sourceContactJid?: string | null;
}) {
  return db.insert(reminders).values(data).run();
}

export function getReminderById(id: string) {
  return db
    .select()
    .from(reminders)
    .where(eq(reminders.id, id))
    .get();
}

export function getRemindersByStatus(status: string) {
  return db
    .select()
    .from(reminders)
    .where(eq(reminders.status, status))
    .orderBy(asc(reminders.fireAt))
    .all();
}

export function updateReminderStatus(id: string, status: string) {
  return db
    .update(reminders)
    .set({ status, updatedAt: Date.now() })
    .where(eq(reminders.id, id))
    .run();
}

export function getRemindersInWindow(fromMs: number, toMs: number) {
  return db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.status, 'pending'),
        gte(reminders.fireAt, fromMs),
        lte(reminders.fireAt, toMs),
      ),
    )
    .orderBy(asc(reminders.fireAt))
    .all();
}

export function getPendingOverdue(nowMs: number) {
  return db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.status, 'pending'),
        lte(reminders.fireAt, nowMs),
      ),
    )
    .orderBy(asc(reminders.fireAt))
    .all();
}

export function getPendingReminders() {
  return db
    .select()
    .from(reminders)
    .where(eq(reminders.status, 'pending'))
    .orderBy(asc(reminders.fireAt))
    .all();
}

export function updateReminderTask(id: string, task: string) {
  return db
    .update(reminders)
    .set({ task, updatedAt: Date.now() })
    .where(eq(reminders.id, id))
    .run();
}

export function updateReminderFireAt(id: string, fireAt: number) {
  return db
    .update(reminders)
    .set({ fireAt, updatedAt: Date.now() })
    .where(eq(reminders.id, id))
    .run();
}

export function updateReminderCalendarEventId(id: string, calendarEventId: string) {
  return db
    .update(reminders)
    .set({ calendarEventId, updatedAt: Date.now() })
    .where(eq(reminders.id, id))
    .run();
}

export function updateReminderTodoIds(id: string, todoTaskId: string, todoListId: string) {
  return db
    .update(reminders)
    .set({ todoTaskId, todoListId, updatedAt: Date.now() })
    .where(eq(reminders.id, id))
    .run();
}
