import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { calendarEvents } from '../schema.js';

export function insertCalendarEvent(event: {
  id: string;
  groupJid: string;
  messageId: string;
  calendarId: string;
  calendarEventId: string;
  title: string;
  eventDate: number;
}) {
  return db.insert(calendarEvents).values(event).run();
}

export function updateCalendarEventConfirmation(
  id: string,
  confirmationMsgId: string,
) {
  return db
    .update(calendarEvents)
    .set({ confirmationMsgId })
    .where(eq(calendarEvents.id, id))
    .run();
}

export function getCalendarEventByConfirmationMsgId(
  confirmationMsgId: string,
) {
  return db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.confirmationMsgId, confirmationMsgId))
    .get();
}

export function deleteCalendarEvent(id: string) {
  const event = db
    .select({
      calendarEventId: calendarEvents.calendarEventId,
      calendarId: calendarEvents.calendarId,
    })
    .from(calendarEvents)
    .where(eq(calendarEvents.id, id))
    .get();

  if (event) {
    db.delete(calendarEvents).where(eq(calendarEvents.id, id)).run();
  }

  return event;
}
