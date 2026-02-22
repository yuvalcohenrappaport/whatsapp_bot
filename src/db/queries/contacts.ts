import { eq } from 'drizzle-orm';
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
