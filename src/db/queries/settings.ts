import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { settings } from '../schema.js';

const DEFAULTS: Record<string, string> = {
  ai_provider: 'gemini',
  voice_replies_enabled: 'false', // global master switch — 'true' | 'false'
  commitment_detection_enabled: 'true', // master switch for commitment detection
  v1_8_detection_pipeline: 'dark_launch', // 'legacy' | 'dark_launch' — Phase 40 gate: dark_launch writes to actionables (v1.8), legacy keeps the pre-v1.8 split commitments→{reminders,todoTasks} path
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
