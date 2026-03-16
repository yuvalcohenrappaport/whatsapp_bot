import { eq, desc } from 'drizzle-orm';
import { db } from '../client.js';
import { personalPendingEvents } from '../schema.js';

export function insertPersonalPendingEvent(event: {
  id: string;
  sourceChatJid: string;
  sourceChatName?: string | null;
  senderJid: string;
  senderName?: string | null;
  sourceMessageId: string;
  sourceMessageText: string;
  title: string;
  eventDate: number;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}) {
  return db.insert(personalPendingEvents).values(event).run();
}

export function getPersonalPendingEvent(id: string) {
  return db
    .select()
    .from(personalPendingEvents)
    .where(eq(personalPendingEvents.id, id))
    .get();
}

export function getPersonalPendingEventByNotificationMsgId(msgId: string) {
  return db
    .select()
    .from(personalPendingEvents)
    .where(eq(personalPendingEvents.notificationMsgId, msgId))
    .get();
}

export function getPendingPersonalEvents() {
  return db
    .select()
    .from(personalPendingEvents)
    .where(eq(personalPendingEvents.status, 'pending'))
    .orderBy(desc(personalPendingEvents.createdAt))
    .all();
}

export function updatePersonalPendingEventStatus(
  id: string,
  status: 'approved' | 'rejected',
) {
  return db
    .update(personalPendingEvents)
    .set({ status })
    .where(eq(personalPendingEvents.id, id))
    .run();
}

export function updatePersonalPendingEventNotificationMsgId(
  id: string,
  notificationMsgId: string,
) {
  return db
    .update(personalPendingEvents)
    .set({ notificationMsgId })
    .where(eq(personalPendingEvents.id, id))
    .run();
}
