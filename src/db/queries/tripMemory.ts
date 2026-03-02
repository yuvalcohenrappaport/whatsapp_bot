import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { tripContexts, tripDecisions } from '../schema.js';

export function getTripContext(groupJid: string) {
  return db
    .select()
    .from(tripContexts)
    .where(eq(tripContexts.groupJid, groupJid))
    .get();
}

export function upsertTripContext(
  groupJid: string,
  data: {
    destination?: string | null;
    dates?: string | null;
    contextSummary?: string | null;
  },
) {
  return db
    .insert(tripContexts)
    .values({
      groupJid,
      ...data,
      lastClassifiedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: tripContexts.groupJid,
      set: { ...data, lastClassifiedAt: Date.now(), updatedAt: Date.now() },
    })
    .run();
}

export function getDecisionsByGroup(groupJid: string, type?: string) {
  if (type !== undefined) {
    return db
      .select()
      .from(tripDecisions)
      .where(and(eq(tripDecisions.groupJid, groupJid), eq(tripDecisions.type, type)))
      .orderBy(desc(tripDecisions.createdAt))
      .all();
  }
  return db
    .select()
    .from(tripDecisions)
    .where(eq(tripDecisions.groupJid, groupJid))
    .orderBy(desc(tripDecisions.createdAt))
    .all();
}

export function insertTripDecision(decision: {
  id: string;
  groupJid: string;
  type: string;
  value: string;
  confidence: string;
  sourceMessageId: string | null;
}) {
  return db.insert(tripDecisions).values(decision).run();
}

export function getUnresolvedOpenItems(groupJid: string) {
  return db
    .select()
    .from(tripDecisions)
    .where(
      and(
        eq(tripDecisions.groupJid, groupJid),
        eq(tripDecisions.type, 'open_question'),
        eq(tripDecisions.resolved, false),
      ),
    )
    .orderBy(desc(tripDecisions.createdAt))
    .all();
}

export function resolveOpenItem(decisionId: string) {
  return db
    .update(tripDecisions)
    .set({ resolved: true })
    .where(eq(tripDecisions.id, decisionId))
    .run();
}

export function searchGroupMessages(
  groupJid: string,
  query: string,
  limit = 10,
): { id: string; senderName: string | null; body: string; timestamp: number }[] {
  // Sanitize: split on whitespace, filter words shorter than 2 chars,
  // wrap each word in double quotes to prevent FTS5 syntax injection
  const sanitized = query
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w.replace(/"/g, '')}"`)
    .join(' ');

  if (!sanitized) return [];

  const results = db.all<{
    id: string;
    sender_name: string | null;
    body: string;
    timestamp: number;
  }>(sql`
    SELECT gm.id, gm.sender_name, gm.body, gm.timestamp
    FROM group_messages_fts fts
    JOIN group_messages gm ON gm.rowid = fts.rowid
    WHERE group_messages_fts MATCH ${sanitized}
      AND gm.group_jid = ${groupJid}
    ORDER BY fts.rank
    LIMIT ${limit}
  `);

  return results.map((r) => ({
    id: r.id,
    senderName: r.sender_name,
    body: r.body,
    timestamp: r.timestamp,
  }));
}
