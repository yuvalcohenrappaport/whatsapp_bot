import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { settings } from '../schema.js';

const DEFAULTS: Record<string, string> = {
  ai_provider: 'gemini',
  voice_replies_enabled: 'false', // global master switch — 'true' | 'false'
  commitment_detection_enabled: 'true', // master switch for commitment detection
  v1_8_detection_pipeline: 'interactive', // 'legacy' | 'dark_launch' | 'interactive' — Phase 40/41 gate: fresh deploys land in 'interactive' directly (self-chat preview UX). Existing servers still have the stored Phase-40 value 'dark_launch' — runFirstBootDigest (Plan 41-04) flips them to 'interactive' atomically with the digest-posted flag on first successful digest send. 'legacy' keeps the pre-v1.8 split commitments→{reminders,todoTasks} path.
  v1_8_approval_digest_posted: 'false', // one-time gate for the Phase 41 first-boot digest; flipped to 'true' after the digest message is sent successfully. Stored value survives restarts so the digest never re-fires.
};

export function getSetting(key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (row) return row.value;
  // Seed default if it exists
  const fallback = DEFAULTS[key];
  if (fallback) {
    setSetting(key, fallback);
    return fallback;
  }
  return null;
}

export function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getAllSettings(): Record<string, string> {
  // Ensure defaults are seeded
  for (const [k, v] of Object.entries(DEFAULTS)) {
    const existing = db.select().from(settings).where(eq(settings.key, k)).get();
    if (!existing) {
      db.insert(settings).values({ key: k, value: v }).run();
    }
  }
  const rows = db.select().from(settings).all();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
