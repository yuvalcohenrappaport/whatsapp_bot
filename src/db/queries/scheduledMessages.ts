import { eq, and, lte, gte, asc, inArray, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { scheduledMessages } from '../schema.js';

export function insertScheduledMessage(data: {
  id: string;
  type: string;
  content: string;
  scheduledAt: number;
  cronExpression?: string | null;
}) {
  return db.insert(scheduledMessages).values(data).run();
}

export function getScheduledMessageById(id: string) {
  return db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.id, id))
    .get();
}

export function getScheduledMessagesInWindow(fromMs: number, toMs: number) {
  return db.select().from(scheduledMessages).where(
    and(
      eq(scheduledMessages.status, 'pending'),
      gte(scheduledMessages.scheduledAt, fromMs),
      lte(scheduledMessages.scheduledAt, toMs),
    )
  ).orderBy(asc(scheduledMessages.scheduledAt)).all();
}

export function getPendingScheduledMessages(nowMs: number) {
  return db
    .select()
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.status, 'pending'),
        lte(scheduledMessages.scheduledAt, nowMs),
      ),
    )
    .orderBy(asc(scheduledMessages.scheduledAt))
    .all();
}

export function getNotifiedScheduledMessages() {
  return db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.status, 'notified'))
    .orderBy(asc(scheduledMessages.scheduledAt))
    .all();
}

export function getScheduledMessageByNotificationMsgId(notificationMsgId: string) {
  return db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.notificationMsgId, notificationMsgId))
    .get();
}

export function updateScheduledMessageStatus(id: string, status: string) {
  return db
    .update(scheduledMessages)
    .set({ status, updatedAt: Date.now() })
    .where(eq(scheduledMessages.id, id))
    .run();
}

export function markScheduledMessageCancelled(id: string) {
  return db
    .update(scheduledMessages)
    .set({ status: 'cancelled', cronExpression: null, cancelRequestedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(scheduledMessages.id, id))
    .run();
}

export function updateScheduledMessageForRearm(id: string, scheduledAt: number) {
  return db
    .update(scheduledMessages)
    .set({
      status: 'pending',
      scheduledAt,
      notificationMsgId: null,
      cancelRequestedAt: null,
      failCount: 0,
      updatedAt: Date.now(),
    })
    .where(eq(scheduledMessages.id, id))
    .run();
}

export function incrementScheduledMessageFailCount(id: string) {
  return db
    .update(scheduledMessages)
    .set({
      failCount: sql`${scheduledMessages.failCount} + 1`,
      updatedAt: Date.now(),
    })
    .where(eq(scheduledMessages.id, id))
    .run();
}

export function updateScheduledMessageNotificationMsgId(id: string, msgId: string) {
  return db
    .update(scheduledMessages)
    .set({ notificationMsgId: msgId, updatedAt: Date.now() })
    .where(eq(scheduledMessages.id, id))
    .run();
}

export function deleteOldScheduledMessages(cutoffMs: number) {
  return db
    .delete(scheduledMessages)
    .where(
      and(
        inArray(scheduledMessages.status, ['sent', 'cancelled', 'failed']),
        lte(scheduledMessages.createdAt, cutoffMs),
      ),
    )
    .returning({ id: scheduledMessages.id });
}

export function getAllScheduledMessages(tab?: string) {
  const query = db.select().from(scheduledMessages);

  if (tab === 'pending') {
    return query
      .where(inArray(scheduledMessages.status, ['pending', 'notified', 'sending']))
      .orderBy(asc(scheduledMessages.scheduledAt))
      .all();
  }

  if (tab === 'sent') {
    return query
      .where(eq(scheduledMessages.status, 'sent'))
      .orderBy(asc(scheduledMessages.scheduledAt))
      .all();
  }

  if (tab === 'failed') {
    return query
      .where(inArray(scheduledMessages.status, ['failed', 'cancelled', 'expired']))
      .orderBy(asc(scheduledMessages.scheduledAt))
      .all();
  }

  // 'all' or undefined — no status filter
  return query.orderBy(asc(scheduledMessages.scheduledAt)).all();
}

export function updateScheduledMessageContentAndTime(
  id: string,
  content: string,
  scheduledAt: number,
) {
  return db
    .update(scheduledMessages)
    .set({ content, scheduledAt, updatedAt: Date.now() })
    .where(eq(scheduledMessages.id, id))
    .run();
}
