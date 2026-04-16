import { and, eq, desc } from 'drizzle-orm';
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

export function getStyleExamples(contactJid: string, limit = 200): Promise<string[]> {
  return db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.contactJid, contactJid), eq(messages.fromMe, true)))
    .orderBy(desc(messages.timestamp))
    .limit(limit)
    .then((rows) => rows.map((r) => r.body));
}

export async function getPairedExamples(
  contactJid: string,
  limit: number,
): Promise<{ incoming: string; reply: string }[]> {
  // Over-fetch recent messages so pairing (which skips consecutive same-side
  // messages) can still yield up to `limit` pairs.
  const recent = await db
    .select({ fromMe: messages.fromMe, body: messages.body })
    .from(messages)
    .where(eq(messages.contactJid, contactJid))
    .orderBy(desc(messages.timestamp))
    .limit(Math.max(limit * 10, 500));

  const chronological = recent.reverse();
  const pairs: { incoming: string; reply: string }[] = [];
  let pendingIncoming: string | null = null;
  for (const m of chronological) {
    if (!m.body) continue;
    if (!m.fromMe) {
      pendingIncoming = m.body;
    } else if (pendingIncoming !== null) {
      pairs.push({ incoming: pendingIncoming, reply: m.body });
      pendingIncoming = null;
    }
  }
  return pairs.slice(-limit);
}

export async function getAllFromMeMessages(limit: number): Promise<string[]> {
  const rows = await db
    .select({ body: messages.body })
    .from(messages)
    .where(eq(messages.fromMe, true))
    .orderBy(desc(messages.timestamp))
    .limit(limit);
  return rows.map((r) => r.body).filter((b) => b.length > 0);
}
