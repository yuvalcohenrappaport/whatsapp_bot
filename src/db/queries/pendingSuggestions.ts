import { eq, gt, lte } from 'drizzle-orm';
import { db } from '../client.js';
import { pendingSuggestions } from '../schema.js';

export function insertPendingSuggestion(suggestion: {
  id: string;
  groupJid: string;
  suggestionMsgId: string;
  title: string;
  eventDate: number;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  calendarId: string;
  calendarLink: string;
  sourceMessageId: string;
  senderName?: string | null;
  expiresAt: number;
}) {
  return db.insert(pendingSuggestions).values(suggestion).run();
}

export function getPendingSuggestionByMsgId(suggestionMsgId: string) {
  return db
    .select()
    .from(pendingSuggestions)
    .where(eq(pendingSuggestions.suggestionMsgId, suggestionMsgId))
    .get();
}

export function deletePendingSuggestion(id: string) {
  return db
    .delete(pendingSuggestions)
    .where(eq(pendingSuggestions.id, id))
    .run();
}

export function getUnexpiredPendingSuggestions(nowMs: number) {
  return db
    .select()
    .from(pendingSuggestions)
    .where(gt(pendingSuggestions.expiresAt, nowMs))
    .all();
}

export function deleteExpiredPendingSuggestions(nowMs: number) {
  return db
    .delete(pendingSuggestions)
    .where(lte(pendingSuggestions.expiresAt, nowMs))
    .run();
}
