import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { groups } from '../schema.js';

export function getGroups() {
  return db.select().from(groups).all();
}

export function getGroup(id: string) {
  return db.select().from(groups).where(eq(groups.id, id)).get();
}

export function createGroup(id: string, name?: string) {
  return db
    .insert(groups)
    .values({ id, name: name ?? null })
    .run();
}

export function updateGroup(
  id: string,
  patch: Partial<{
    name: string;
    active: boolean;
    reminderDay: string;
    reminderHour: number;
    calendarLink: string;
    memberEmails: string;
  }>,
) {
  return db
    .update(groups)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(groups.id, id))
    .run();
}

export function deleteGroup(id: string) {
  return db.delete(groups).where(eq(groups.id, id)).run();
}

export function getActiveGroups() {
  return db.select().from(groups).where(eq(groups.active, true)).all();
}

export function getActiveGroupIds(): string[] {
  return db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.active, true))
    .all()
    .map((row) => row.id);
}
