import { eq, desc, and, between } from 'drizzle-orm';
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
  contentHash?: string | null;
  isAllDay?: boolean;
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

export function findPendingEventByContentHash(hash: string) {
  return db
    .select()
    .from(personalPendingEvents)
    .where(
      and(
        eq(personalPendingEvents.contentHash, hash),
        eq(personalPendingEvents.status, 'pending'),
      ),
    )
    .get();
}

export function findSimilarPendingEvents(sourceChatJid: string, eventDate: number) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return db
    .select()
    .from(personalPendingEvents)
    .where(
      and(
        eq(personalPendingEvents.sourceChatJid, sourceChatJid),
        eq(personalPendingEvents.status, 'pending'),
        between(personalPendingEvents.eventDate, eventDate - DAY_MS, eventDate + DAY_MS),
      ),
    )
    .all();
}

export function updatePendingEventDetails(
  id: string,
  updates: {
    title?: string;
    eventDate?: number;
    location?: string | null;
    description?: string | null;
    isAllDay?: boolean;
  },
) {
  return db
    .update(personalPendingEvents)
    .set(updates)
    .where(eq(personalPendingEvents.id, id))
    .run();
}

export function getPersonalEventsByStatus(status: 'pending' | 'approved' | 'rejected') {
  return db
    .select()
    .from(personalPendingEvents)
    .where(eq(personalPendingEvents.status, status))
    .orderBy(desc(personalPendingEvents.createdAt))
    .all();
}
