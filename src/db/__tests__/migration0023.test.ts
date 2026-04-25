import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';

// ─── In-memory DB bootstrapped by replaying every drizzle migration in order ──
// Mirrors the pattern used in src/scheduler/__tests__/archiveTripsCron.test.ts
// and src/db/queries/__tests__/tripMemory.test.ts. Skips 0010 (FTS5 virtual
// table) since these tests don't touch group_messages.
const sqlite = new Database(':memory:');
const drizzleDir = 'drizzle';
const migrationFiles = readdirSync(drizzleDir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();
for (const file of migrationFiles) {
  if (file.startsWith('0010_')) continue;
  const sqlText = readFileSync(join(drizzleDir, file), 'utf8');
  for (const stmt of sqlText.split('--> statement-breakpoint')) {
    const t = stmt.trim();
    if (!t) continue;
    sqlite.exec(t);
  }
}
const testDb = drizzle(sqlite, { schema });

// IMPORTANT: mock the db client BEFORE importing tripMemory.
vi.mock('../client.js', () => ({ db: testDb }));

const { upsertTripContext, getTripContext } = await import(
  '../queries/tripMemory.js'
);

const GROUP = '120363000000000777@g.us';

function clearAll() {
  sqlite.exec('DELETE FROM trip_decisions');
  sqlite.exec('DELETE FROM trip_contexts');
  sqlite.exec('DELETE FROM trip_archive');
}

describe('migration 0023 — metadata column on trip_contexts', () => {
  beforeEach(() => clearAll());

  it('trip_contexts has a `metadata` column after migration 0023 applies', () => {
    // PRAGMA table_info returns all columns for the table. We assert the new
    // `metadata` column is present and has the expected nullable TEXT shape.
    const columns = sqlite
      .prepare("PRAGMA table_info('trip_contexts')")
      .all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;

    const metadataCol = columns.find((c) => c.name === 'metadata');
    expect(metadataCol).toBeDefined();
    // `text` (lowercase) matches the ALTER TABLE ADD COLUMN emitted by drizzle.
    expect(metadataCol!.type.toLowerCase()).toBe('text');
    // Nullable — no NOT NULL, no DEFAULT (mirrors trip_decisions.metadata).
    expect(metadataCol!.notnull).toBe(0);
    expect(metadataCol!.dflt_value).toBeNull();

    // Raw INSERT/SELECT round-trip to confirm the column is writable.
    sqlite
      .prepare(
        `INSERT INTO trip_contexts (
           group_jid, destination, last_classified_at, updated_at,
           budget_by_category, status, metadata
         ) VALUES (?, ?, ?, ?, '{}', 'active', ?)`,
      )
      .run(GROUP, 'Rome', Date.now(), Date.now(), '{"tz":"Europe/Rome"}');

    const row = sqlite
      .prepare('SELECT metadata FROM trip_contexts WHERE group_jid = ?')
      .get(GROUP) as { metadata: string | null };
    expect(row.metadata).toBe('{"tz":"Europe/Rome"}');
  });

  it('upsertTripContext round-trips a metadata patch', () => {
    // Seed a row without metadata.
    upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
    });

    const before = getTripContext(GROUP);
    expect(before).toBeDefined();
    expect(before!.metadata).toBeNull();

    // Patch metadata.
    upsertTripContext(GROUP, { metadata: '{"tz":"Europe/Rome"}' });

    const after = getTripContext(GROUP);
    expect(after).toBeDefined();
    expect(after!.metadata).toBe('{"tz":"Europe/Rome"}');

    // Parse and assert the stored tz survives JSON round-trip.
    const parsed = JSON.parse(after!.metadata as string) as {
      tz: string;
    };
    expect(parsed.tz).toBe('Europe/Rome');

    // Other columns untouched by the metadata-only patch.
    expect(after!.destination).toBe('Rome');
    expect(after!.startDate).toBe('2026-05-10');
    expect(after!.endDate).toBe('2026-05-15');
  });
});
