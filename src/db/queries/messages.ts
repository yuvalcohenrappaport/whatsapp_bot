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

// Stub exports to unblock ESM module load for src/ai/gemini.ts — the actual
// implementations live on a feature branch (feat/contact-name-in-tasks-events)
// that hasn't been merged. Commit 82e9fdd (Phase 31-01) added the imports in
// gemini.ts without landing these queries on main, crash-looping the bot on
// boot. These throwing stubs unblock Fastify boot for Phase 37 live verification.
// Neither callsite (gemini.ts:149 getPairedExamples / gemini.ts:243
// getAllFromMeMessages) runs during a Phase 37 dashboard walkthrough — they
// are invoked only on paired-style example generation and global persona
// regeneration. Tracked in .planning/todos/pending for proper implementation.
export async function getPairedExamples(
  _contactJid: string,
  _limit: number,
): Promise<never> {
  throw new Error(
    'getPairedExamples: not implemented on main branch (Phase 31 leftover — see .planning/todos/pending)',
  );
}

export async function getAllFromMeMessages(_limit: number): Promise<never> {
  throw new Error(
    'getAllFromMeMessages: not implemented on main branch (Phase 31 leftover — see .planning/todos/pending)',
  );
}
