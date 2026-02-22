import { eq, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { contacts } from '../schema.js';

export function getContact(jid: string) {
  return db.select().from(contacts).where(eq(contacts.jid, jid)).get();
}

export function upsertContact(jid: string, name?: string | null) {
  return db
    .insert(contacts)
    .values({ jid, name: name ?? null })
    .onConflictDoNothing({ target: contacts.jid });
}

export function updateContactMode(jid: string, mode: 'off' | 'draft' | 'auto') {
  return db
    .update(contacts)
    .set({ mode, updatedAt: Date.now() })
    .where(eq(contacts.jid, jid));
}

export function setStyleSummary(jid: string, summary: string) {
  return db
    .update(contacts)
    .set({ styleSummary: summary, updatedAt: Date.now() })
    .where(eq(contacts.jid, jid));
}

export function setSnoozeUntil(jid: string, until: number | null) {
  return db
    .update(contacts)
    .set({ snoozeUntil: until, updatedAt: Date.now() })
    .where(eq(contacts.jid, jid));
}

export function incrementAutoCount(jid: string) {
  return db
    .update(contacts)
    .set({
      consecutiveAutoCount: sql`${contacts.consecutiveAutoCount} + 1`,
      updatedAt: Date.now(),
    })
    .where(eq(contacts.jid, jid));
}

export function resetAutoCount(jid: string) {
  return db
    .update(contacts)
    .set({ consecutiveAutoCount: 0, updatedAt: Date.now() })
    .where(eq(contacts.jid, jid));
}
