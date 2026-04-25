import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

// ─── In-memory DB bootstrapped by replaying every drizzle migration in order ──
// Mirrors the approach used in src/db/queries/__tests__/tripMemory.test.ts.
// Skips 0010 (FTS5 virtual table) since these tests don't touch group_messages.
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

// IMPORTANT: mock the db client BEFORE importing tripMemory / archiveTripsCron
vi.mock('../../db/client.js', () => ({ db: testDb }));

// Dynamic import after the mock is in place.
const { runArchiveTripsOnce, initArchiveTripsCron } = await import(
  '../archiveTripsCron.js'
);
const tripMemory = await import('../../db/queries/tripMemory.js');

const GROUP_A = '120363000000000001@g.us';
const GROUP_B = '120363000000000002@g.us';
const GROUP_C = '120363000000000003@g.us';

// Fixed "now" for deterministic date math. 2026-05-01 12:00 UTC.
const NOW_MS = Date.parse('2026-05-01T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function clearAll() {
  sqlite.exec('DELETE FROM trip_decisions');
  sqlite.exec('DELETE FROM trip_contexts');
  sqlite.exec('DELETE FROM trip_archive');
}

/** Insert a trip_contexts row directly via raw SQL for test setup precision. */
function insertContext(params: {
  groupJid: string;
  endDate: string | null;
  status?: 'active' | 'archived';
  destination?: string;
}) {
  const status = params.status ?? 'active';
  sqlite
    .prepare(
      `INSERT INTO trip_contexts (
         group_jid, destination, dates, context_summary,
         last_classified_at, updated_at,
         start_date, end_date, budget_by_category,
         calendar_id, status, briefing_time
       ) VALUES (?, ?, NULL, NULL, ?, ?, NULL, ?, '{}', NULL, ?, NULL)`,
    )
    .run(
      params.groupJid,
      params.destination ?? 'TestDest',
      NOW_MS,
      NOW_MS,
      params.endDate,
      status,
    );
}

/** Insert N trip_decisions for a group with archived=0. */
function insertDecisions(groupJid: string, count: number) {
  for (let i = 0; i < count; i++) {
    tripMemory.insertTripDecision({
      id: randomUUID(),
      groupJid,
      type: 'accommodation',
      value: `decision-${i}`,
      confidence: 'high',
      sourceMessageId: null,
    });
  }
}

function countContexts(groupJid: string): number {
  return (
    sqlite
      .prepare('SELECT COUNT(*) AS c FROM trip_contexts WHERE group_jid = ?')
      .get(groupJid) as { c: number }
  ).c;
}

function countArchive(groupJid: string): number {
  return (
    sqlite
      .prepare('SELECT COUNT(*) AS c FROM trip_archive WHERE group_jid = ?')
      .get(groupJid) as { c: number }
  ).c;
}

function countDecisions(
  groupJid: string,
  archived: 0 | 1,
): number {
  return (
    sqlite
      .prepare(
        'SELECT COUNT(*) AS c FROM trip_decisions WHERE group_jid = ? AND archived = ?',
      )
      .get(groupJid, archived) as { c: number }
  ).c;
}

describe('archiveTripsCron', () => {
  beforeEach(() => clearAll());

  describe('runArchiveTripsOnce', () => {
    it('archives an expired (end_date + 3 days < now) active trip', () => {
      // end_date = 4 days before NOW → end_date + 3d = 1 day before NOW → expired.
      const endDate = new Date(NOW_MS - 4 * DAY_MS).toISOString().slice(0, 10);
      insertContext({ groupJid: GROUP_A, endDate });
      insertDecisions(GROUP_A, 3);

      const result = runArchiveTripsOnce(NOW_MS);

      expect(result.archivedCount).toBe(1);
      expect(countContexts(GROUP_A)).toBe(0);
      expect(countArchive(GROUP_A)).toBe(1);

      const archiveRow = sqlite
        .prepare('SELECT * FROM trip_archive WHERE group_jid = ?')
        .get(GROUP_A) as Record<string, unknown>;
      expect(archiveRow.status).toBe('archived'); // moveContextToArchive snapshots as 'archived'
      expect(typeof archiveRow.archived_at).toBe('number');
      expect(archiveRow.id).toBeTruthy();

      // Decisions flipped to archived=1, still exist.
      expect(countDecisions(GROUP_A, 1)).toBe(3);
      expect(countDecisions(GROUP_A, 0)).toBe(0);
    });

    it('leaves non-expired trips untouched (end_date + 3d still in future)', () => {
      // end_date = 2 days before NOW → end_date + 3d = 1 day after NOW → NOT expired.
      const endDate = new Date(NOW_MS - 2 * DAY_MS).toISOString().slice(0, 10);
      insertContext({ groupJid: GROUP_A, endDate });
      insertDecisions(GROUP_A, 2);

      const result = runArchiveTripsOnce(NOW_MS);

      expect(result.archivedCount).toBe(0);
      expect(countContexts(GROUP_A)).toBe(1);
      expect(countArchive(GROUP_A)).toBe(0);
      expect(countDecisions(GROUP_A, 0)).toBe(2);
    });

    it('leaves trips with null end_date untouched', () => {
      insertContext({ groupJid: GROUP_A, endDate: null });
      insertDecisions(GROUP_A, 2);

      const result = runArchiveTripsOnce(NOW_MS);

      expect(result.archivedCount).toBe(0);
      expect(countContexts(GROUP_A)).toBe(1);
      expect(countArchive(GROUP_A)).toBe(0);
    });

    it('leaves already-archived-status trips untouched (belt-and-suspenders)', () => {
      // Even if a row somehow has status='archived' and a very old end_date,
      // getExpiredActiveContexts filters on status='active' — so cron skips it.
      const endDate = new Date(NOW_MS - 30 * DAY_MS).toISOString().slice(0, 10);
      insertContext({ groupJid: GROUP_A, endDate, status: 'archived' });

      const result = runArchiveTripsOnce(NOW_MS);

      expect(result.archivedCount).toBe(0);
      expect(countContexts(GROUP_A)).toBe(1);
      expect(countArchive(GROUP_A)).toBe(0);
    });

    it('is idempotent on re-run (second run finds nothing)', () => {
      const endDate = new Date(NOW_MS - 5 * DAY_MS).toISOString().slice(0, 10);
      insertContext({ groupJid: GROUP_A, endDate });
      insertDecisions(GROUP_A, 2);

      const first = runArchiveTripsOnce(NOW_MS);
      expect(first.archivedCount).toBe(1);

      const second = runArchiveTripsOnce(NOW_MS);
      expect(second.archivedCount).toBe(0);
      // State is stable — still archived, decisions still flipped.
      expect(countContexts(GROUP_A)).toBe(0);
      expect(countArchive(GROUP_A)).toBe(1);
      expect(countDecisions(GROUP_A, 1)).toBe(2);
    });

    it('recovers cleanly from a mid-list crash: other groups archive, failed group retries next run', () => {
      const endDate = new Date(NOW_MS - 5 * DAY_MS).toISOString().slice(0, 10);
      insertContext({ groupJid: GROUP_A, endDate });
      insertContext({ groupJid: GROUP_B, endDate });
      insertDecisions(GROUP_A, 2);
      insertDecisions(GROUP_B, 2);

      // Force moveContextToArchive to throw exactly once on GROUP_A.
      // vi.spyOn on a namespace import mutates the module's live export binding,
      // which the already-imported archiveTripsCron closure will see (ESM
      // named imports are live bindings).
      const real = tripMemory.moveContextToArchive;
      let thrown = false;
      const spy = vi
        .spyOn(tripMemory, 'moveContextToArchive')
        .mockImplementation((groupJid: string) => {
          if (!thrown && groupJid === GROUP_A) {
            thrown = true;
            throw new Error('simulated mid-run crash');
          }
          return real(groupJid);
        });

      const firstRun = runArchiveTripsOnce(NOW_MS);

      // GROUP_B archives cleanly; GROUP_A's move threw, so its decisions stay active.
      expect(firstRun.archivedCount).toBe(1);
      expect(countContexts(GROUP_A)).toBe(1);
      expect(countArchive(GROUP_A)).toBe(0);
      expect(countDecisions(GROUP_A, 0)).toBe(2);
      expect(countDecisions(GROUP_A, 1)).toBe(0);

      expect(countContexts(GROUP_B)).toBe(0);
      expect(countArchive(GROUP_B)).toBe(1);
      expect(countDecisions(GROUP_B, 1)).toBe(2);

      // Un-patch and re-run: GROUP_A now archives.
      spy.mockRestore();
      const secondRun = runArchiveTripsOnce(NOW_MS);

      expect(secondRun.archivedCount).toBe(1);
      expect(countContexts(GROUP_A)).toBe(0);
      expect(countArchive(GROUP_A)).toBe(1);
      expect(countDecisions(GROUP_A, 1)).toBe(2);
    });

    it('skips a row whose context vanishes between SELECT and move (null result path)', () => {
      insertContext({
        groupJid: GROUP_C,
        endDate: new Date(NOW_MS - 5 * DAY_MS).toISOString().slice(0, 10),
      });

      // Simulate a racy delete: moveContextToArchive returns null.
      const spy = vi
        .spyOn(tripMemory, 'moveContextToArchive')
        .mockReturnValue(null);

      const result = runArchiveTripsOnce(NOW_MS);

      // The real helper was short-circuited to null — archivedCount stays 0
      // and we don't flip decisions. Module-level import in archiveTripsCron
      // binds to the spy only via the shared module object — in vitest,
      // vi.spyOn(namespace) mutates the exported binding in place, so the
      // cron's imported reference sees the mock.
      expect(result.archivedCount).toBe(0);
      spy.mockRestore();
    });
  });

  describe('initArchiveTripsCron', () => {
    // Use a cron-schedule spy to assert wiring without actually registering
    // a persistent timer inside the test process.
    let scheduleSpy: ReturnType<typeof vi.fn>;
    let stopSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      stopSpy = vi.fn();
      scheduleSpy = vi.fn(() => ({
        stop: stopSpy,
        start: vi.fn(),
      }));

      vi.resetModules();
      vi.doMock('node-cron', () => ({
        schedule: scheduleSpy,
      }));
    });

    afterEach(() => {
      vi.doUnmock('node-cron');
      vi.resetModules();
    });

    it('registers a daily 02:00 Asia/Jerusalem cron', async () => {
      const { initArchiveTripsCron: init } = await import(
        '../archiveTripsCron.js'
      );
      init();

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      const [expr, , opts] = scheduleSpy.mock.calls[0] as [
        string,
        unknown,
        { timezone?: string },
      ];
      expect(expr).toBe('0 2 * * *');
      expect(opts?.timezone).toBe('Asia/Jerusalem');
    });

    it('is idempotent: second init stops the first registered task', async () => {
      const { initArchiveTripsCron: init } = await import(
        '../archiveTripsCron.js'
      );
      init();
      init();

      expect(scheduleSpy).toHaveBeenCalledTimes(2);
      // The first task's stop was invoked before the second register.
      expect(stopSpy).toHaveBeenCalled();
    });

    it('scheduled handler invokes runArchiveTripsOnce (smoke test)', async () => {
      const { initArchiveTripsCron: init } = await import(
        '../archiveTripsCron.js'
      );
      init();

      // Grab the handler closure cron.schedule was called with.
      const [, handler] = scheduleSpy.mock.calls[0] as [
        string,
        () => void,
        unknown,
      ];

      // No expired rows → handler should not throw and archiveCount should be 0.
      expect(() => handler()).not.toThrow();
    });
  });

  // Ensure the top-level runArchiveTripsOnce/initArchiveTripsCron imports at
  // the head of this file still resolve — keeps them referenced even though
  // most tests use dynamic imports for mocking.
  it('exports runArchiveTripsOnce and initArchiveTripsCron', () => {
    expect(typeof runArchiveTripsOnce).toBe('function');
    expect(typeof initArchiveTripsCron).toBe('function');
  });
});
