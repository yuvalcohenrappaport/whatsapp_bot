import { eq, desc, and, between } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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

export function updatePersonalPendingEventFields(
  id: string,
  patch: {
    title?: string;
    eventDate?: number;
    location?: string | null;
    description?: string | null;
    isAllDay?: boolean;
    calendarEventId?: string | null;
  },
): void {
  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.eventDate !== undefined) updates.eventDate = patch.eventDate;
  if (patch.location !== undefined) updates.location = patch.location;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.isAllDay !== undefined) updates.isAllDay = patch.isAllDay;
  if (patch.calendarEventId !== undefined) updates.calendarEventId = patch.calendarEventId;
  if (Object.keys(updates).length === 0) return;
  db.update(personalPendingEvents)
    .set(updates)
    .where(eq(personalPendingEvents.id, id))
    .run();
}

/**
 * Link a Google Calendar event ID back to a personal_pending_events row
 * after it has been approved and a calendar event created.
 */
export function linkCalendarEventId(id: string, calendarEventId: string): void {
  db.update(personalPendingEvents)
    .set({ calendarEventId })
    .where(eq(personalPendingEvents.id, id))
    .run();
}

/** Hard-delete a personal pending events row. Caller must do Google Calendar cleanup first. */
export function deletePersonalPendingEvent(id: string): void {
  db.delete(personalPendingEvents).where(eq(personalPendingEvents.id, id)).run();
}

/**
 * Calendar view: approved personal events whose eventDate falls within
 * the given window. Phase 44 SC1.
 */
export function getApprovedEventsBetween(
  fromMs: number,
  toMs: number,
) {
  return db
    .select()
    .from(personalPendingEvents)
    .where(
      and(
        eq(personalPendingEvents.status, 'approved'),
        between(personalPendingEvents.eventDate, fromMs, toMs),
      ),
    )
    .all();
}

/**
 * Insert a new event directly at status='approved' (dashboard create-flow,
 * SC4). The caller is responsible for creating the Google Calendar event
 * first and passing a calendarEventId-bearing identifier if it wants the
 * two to be linked — this function only writes the local row.
 */
export function insertApprovedPersonalEvent(params: {
  title: string;
  eventDate: number;
  location?: string | null;
  description?: string | null;
  isAllDay?: boolean;
  sourceChatJid?: string;
}): ReturnType<typeof getPersonalPendingEvent> {
  const id = `user_cmd_${randomUUID()}`;
  db.insert(personalPendingEvents).values({
    id,
    sourceChatJid: params.sourceChatJid ?? 'dashboard',
    sourceChatName: null,
    senderJid: 'dashboard',
    senderName: 'Self',
    sourceMessageId: `dashboard_${id}`,
    sourceMessageText: '',
    title: params.title,
    eventDate: params.eventDate,
    location: params.location ?? null,
    description: params.description ?? null,
    url: null,
    status: 'approved',
    contentHash: null,
    isAllDay: params.isAllDay ?? false,
  }).run();
  return getPersonalPendingEvent(id);
}
