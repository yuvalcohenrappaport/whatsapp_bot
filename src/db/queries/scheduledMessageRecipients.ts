import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { scheduledMessageRecipients } from '../schema.js';

export function insertScheduledMessageRecipient(data: {
  id: string;
  scheduledMessageId: string;
  recipientJid: string;
  recipientType: string;
}) {
  return db.insert(scheduledMessageRecipients).values(data).run();
}

export function getRecipientsForMessage(scheduledMessageId: string) {
  return db
    .select()
    .from(scheduledMessageRecipients)
    .where(eq(scheduledMessageRecipients.scheduledMessageId, scheduledMessageId))
    .all();
}

export function updateRecipientStatus(id: string, status: string) {
  const extraFields = status === 'sent' ? { sentAt: Date.now() } : {};
  return db
    .update(scheduledMessageRecipients)
    .set({ status, ...extraFields })
    .where(eq(scheduledMessageRecipients.id, id))
    .run();
}

export function updateRecipientSentContent(id: string, sentContent: string) {
  return db
    .update(scheduledMessageRecipients)
    .set({ sentContent })
    .where(eq(scheduledMessageRecipients.id, id))
    .run();
}

export function incrementRecipientFailCount(id: string) {
  return db
    .update(scheduledMessageRecipients)
    .set({
      failCount: sql`${scheduledMessageRecipients.failCount} + 1`,
    })
    .where(eq(scheduledMessageRecipients.id, id))
    .run();
}

export function deleteRecipientsForMessages(messageIds: string[]) {
  if (messageIds.length === 0) return;
  return db
    .delete(scheduledMessageRecipients)
    .where(inArray(scheduledMessageRecipients.scheduledMessageId, messageIds))
    .run();
}
