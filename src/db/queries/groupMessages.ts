import { and, eq, gte, asc } from 'drizzle-orm';
import { db } from '../client.js';
import { groupMessages } from '../schema.js';

export function insertGroupMessage(msg: {
  id: string;
  groupJid: string;
  senderJid: string;
  senderName: string | null;
  fromMe: boolean;
  body: string;
  timestamp: number;
}) {
  return db
    .insert(groupMessages)
    .values(msg)
    .onConflictDoNothing({ target: groupMessages.id });
}

export function getGroupMessagesSince(
  groupJid: string,
  sinceMs: number,
  limit = 200,
) {
  return db
    .select({
      senderName: groupMessages.senderName,
      body: groupMessages.body,
      timestamp: groupMessages.timestamp,
      fromMe: groupMessages.fromMe,
    })
    .from(groupMessages)
    .where(
      and(
        eq(groupMessages.groupJid, groupJid),
        gte(groupMessages.timestamp, sinceMs),
      ),
    )
    .orderBy(asc(groupMessages.timestamp))
    .limit(limit)
    .all();
}
