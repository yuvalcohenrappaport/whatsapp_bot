import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../client.js';
import { drafts } from '../schema.js';

export function createDraft(contactJid: string, inReplyToMessageId: string, body: string) {
  const id = randomUUID();
  db.insert(drafts).values({ id, contactJid, inReplyToMessageId, body }).run();
  return id;
}

export function getLatestPendingDraft() {
  return db
    .select()
    .from(drafts)
    .where(eq(drafts.status, 'pending'))
    .orderBy(desc(drafts.createdAt))
    .limit(1)
    .get();
}

export function markDraftSent(id: string) {
  return db
    .update(drafts)
    .set({ status: 'sent', actionedAt: Date.now() })
    .where(and(eq(drafts.id, id), eq(drafts.status, 'pending')));
}

export function markDraftRejected(id: string) {
  return db
    .update(drafts)
    .set({ status: 'rejected', actionedAt: Date.now() })
    .where(and(eq(drafts.id, id), eq(drafts.status, 'pending')));
}
