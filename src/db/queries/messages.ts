import { eq, desc } from 'drizzle-orm';
import { db } from '../client.js';
import { messages } from '../schema.js';

export function insertMessage(msg: {
  id: string;
  contactJid: string;
  fromMe: boolean;
  body: string;
  timestamp: number;
}) {
  return db
    .insert(messages)
    .values(msg)
    .onConflictDoNothing({ target: messages.id });
}

export function getRecentMessages(contactJid: string, limit = 50) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.contactJid, contactJid))
    .orderBy(desc(messages.timestamp))
    .limit(limit)
    .then((rows) => rows.reverse()); // chronological order
}
