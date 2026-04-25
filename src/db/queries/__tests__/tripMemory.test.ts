import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../schema.js';

// In-memory DB bootstrapped by replaying every drizzle migration in order.
// This mirrors how the real better-sqlite3/migrator runs them, but without
// the _journal tracker — good enough for round-trip query tests.
const sqlite = new Database(':memory:');
const drizzleDir = 'drizzle';
const migrationFiles = readdirSync(drizzleDir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();
for (const file of migrationFiles) {
  // Skip 0010 — FTS5 virtual table uses an `fts5` module that may not be
  // compiled into the node better-sqlite3 build on some CI images. These
  // tests don't touch searchGroupMessages.
  if (file.startsWith('0010_')) continue;
  const sqlText = readFileSync(join(drizzleDir, file), 'utf8');
  for (const stmt of sqlText.split('--> statement-breakpoint')) {
    const t = stmt.trim();
    if (!t) continue;
    sqlite.exec(t);
  }
}
const testDb = drizzle(sqlite, { schema });

vi.mock('../../client.js', () => ({ db: testDb }));

const {
  insertTripDecision,
  upsertTripContext,
  getTripContext,
  getDecisionsByGroup,
  getUnresolvedOpenItems,
  getBudgetRollup,
  updateDecisionConflicts,
  moveContextToArchive,
  markDecisionsArchivedForGroup,
  getExpiredActiveContexts,
  softDeleteDecision,
  updateBudgetByCategory,
  listTripsForDashboard,
  getTripBundle,
} = await import('../tripMemory.js');

const GROUP = '120363999999@g.us';

function clearAll() {
  sqlite.exec('DELETE FROM trip_decisions');
  sqlite.exec('DELETE FROM trip_contexts');
  sqlite.exec('DELETE FROM trip_archive');
}

describe('tripMemory v2.1 queries', () => {
  beforeEach(() => clearAll());

  describe('insertTripDecision', () => {
    it('round-trips full v2.1 fields', () => {
      const id = randomUUID();
      insertTripDecision({
        id,
        groupJid: GROUP,
        type: 'accommodation',
        value: 'Hotel Roma Centrale',
        confidence: 'high',
        sourceMessageId: 'MSG1',
        proposedBy: '972501111111@s.whatsapp.net',
        category: 'lodging',
        costAmount: 820.5,
        costCurrency: 'EUR',
        conflictsWith: ['d1', 'd2'],
        origin: 'self_reported',
        metadata: { nights: 3, roomType: 'double' },
      });

      const row = sqlite
        .prepare('SELECT * FROM trip_decisions WHERE id = ?')
        .get(id) as Record<string, unknown>;

      expect(row.proposed_by).toBe('972501111111@s.whatsapp.net');
      expect(row.category).toBe('lodging');
      expect(row.cost_amount).toBeCloseTo(820.5);
      expect(row.cost_currency).toBe('EUR');
      expect(JSON.parse(row.conflicts_with as string)).toEqual(['d1', 'd2']);
      expect(row.origin).toBe('self_reported');
      expect(JSON.parse(row.metadata as string)).toEqual({
        nights: 3,
        roomType: 'double',
      });
      expect(row.archived).toBe(0);
    });

    it('still accepts legacy-only fields (backwards compat)', () => {
      const id = randomUUID();
      insertTripDecision({
        id,
        groupJid: GROUP,
        type: 'destination',
        value: 'Rome',
        confidence: 'high',
        sourceMessageId: null,
      });

      const row = sqlite
        .prepare('SELECT * FROM trip_decisions WHERE id = ?')
        .get(id) as Record<string, unknown>;

      expect(row.value).toBe('Rome');
      expect(row.proposed_by).toBeNull();
      expect(row.category).toBeNull();
      expect(row.cost_amount).toBeNull();
      expect(row.origin).toBe('inferred'); // default
      expect(JSON.parse(row.conflicts_with as string)).toEqual([]); // default
      expect(row.metadata).toBeNull();
      expect(row.archived).toBe(0);
    });
  });

  describe('upsertTripContext', () => {
    it('persists v2.1 fields and survives re-upsert', () => {
      upsertTripContext(GROUP, {
        destination: 'Rome',
        startDate: '2026-06-01',
        endDate: '2026-06-08',
        budgetByCategory: { flights: 1500, lodging: 800, food: 400 },
        calendarId: 'cal-123',
        briefingTime: '08:00',
      });

      let ctx = getTripContext(GROUP)!;
      expect(ctx.destination).toBe('Rome');
      expect(ctx.startDate).toBe('2026-06-01');
      expect(ctx.endDate).toBe('2026-06-08');
      expect(ctx.calendarId).toBe('cal-123');
      expect(ctx.status).toBe('active');
      expect(JSON.parse(ctx.budgetByCategory)).toEqual({
        flights: 1500,
        lodging: 800,
        food: 400,
      });

      // Re-upsert with a partial patch — unspecified fields must NOT be wiped.
      upsertTripContext(GROUP, { destination: 'Rome, Italy' });
      ctx = getTripContext(GROUP)!;
      expect(ctx.destination).toBe('Rome, Italy');
      expect(ctx.endDate).toBe('2026-06-08'); // preserved
      expect(JSON.parse(ctx.budgetByCategory)).toEqual({
        flights: 1500,
        lodging: 800,
        food: 400,
      }); // preserved
    });
  });

  describe('getBudgetRollup', () => {
    it('sums costs per category, excludes archived, honors targets', () => {
      upsertTripContext(GROUP, {
        destination: 'Rome',
        budgetByCategory: { flights: 1000, lodging: 800, food: 300 },
      });
      // Active decisions
      insertTripDecision({
        id: randomUUID(),
        groupJid: GROUP,
        type: 'transport',
        value: 'TLV-FCO flights',
        confidence: 'high',
        sourceMessageId: null,
        category: 'flights',
        costAmount: 600,
      });
      insertTripDecision({
        id: randomUUID(),
        groupJid: GROUP,
        type: 'transport',
        value: 'FCO-TLV return',
        confidence: 'high',
        sourceMessageId: null,
        category: 'flights',
        costAmount: 350,
      });
      insertTripDecision({
        id: randomUUID(),
        groupJid: GROUP,
        type: 'accommodation',
        value: 'Hotel Roma',
        confidence: 'high',
        sourceMessageId: null,
        category: 'lodging',
        costAmount: 820,
      });
      insertTripDecision({
        id: randomUUID(),
        groupJid: GROUP,
        type: 'activity',
        value: 'Colosseum tour',
        confidence: 'high',
        sourceMessageId: null,
        category: 'activities',
        costAmount: 90,
      });
      // Archived row — must be excluded from spent
      const archivedId = randomUUID();
      insertTripDecision({
        id: archivedId,
        groupJid: GROUP,
        type: 'transport',
        value: 'cancelled flight',
        confidence: 'high',
        sourceMessageId: null,
        category: 'flights',
        costAmount: 99999,
      });
      sqlite
        .prepare('UPDATE trip_decisions SET archived = 1 WHERE id = ?')
        .run(archivedId);

      const roll = getBudgetRollup(GROUP);
      expect(roll.targets.flights).toBe(1000);
      expect(roll.targets.lodging).toBe(800);
      expect(roll.targets.food).toBe(300);
      expect(roll.spent.flights).toBe(950); // 600 + 350, NOT the archived 99999
      expect(roll.spent.lodging).toBe(820);
      expect(roll.spent.activities).toBe(90);
      expect(roll.spent.food).toBe(0); // no rows, returns 0 (not error)
      expect(roll.remaining.flights).toBe(50);
      expect(roll.remaining.lodging).toBe(-20); // over budget
      expect(roll.remaining.food).toBe(300);
    });

    it('returns zeros when no context + no decisions exist', () => {
      const roll = getBudgetRollup('120363000000@g.us'); // unknown group
      for (const cat of [
        'flights',
        'lodging',
        'food',
        'activities',
        'transit',
        'shopping',
        'other',
      ] as const) {
        expect(roll.targets[cat]).toBe(0);
        expect(roll.spent[cat]).toBe(0);
        expect(roll.remaining[cat]).toBe(0);
      }
    });
  });

  describe('updateDecisionConflicts', () => {
    it('persists conflict id list as JSON', () => {
      const id = randomUUID();
      insertTripDecision({
        id,
        groupJid: GROUP,
        type: 'activity',
        value: 'Vatican tour',
        confidence: 'high',
        sourceMessageId: null,
      });
      updateDecisionConflicts(id, ['conflict-a', 'conflict-b']);

      const row = sqlite
        .prepare('SELECT conflicts_with FROM trip_decisions WHERE id = ?')
        .get(id) as { conflicts_with: string };
      expect(JSON.parse(row.conflicts_with)).toEqual([
        'conflict-a',
        'conflict-b',
      ]);
    });
  });

  describe('moveContextToArchive + markDecisionsArchivedForGroup', () => {
    it('atomically moves the context row and archives decisions', () => {
      upsertTripContext(GROUP, {
        destination: 'Rome',
        startDate: '2026-06-01',
        endDate: '2026-06-08',
        budgetByCategory: { flights: 1000 },
        calendarId: 'cal-x',
        briefingTime: '08:30',
      });
      insertTripDecision({
        id: randomUUID(),
        groupJid: GROUP,
        type: 'transport',
        value: 'flight',
        confidence: 'high',
        sourceMessageId: null,
      });
      insertTripDecision({
        id: randomUUID(),
        groupJid: GROUP,
        type: 'accommodation',
        value: 'hotel',
        confidence: 'high',
        sourceMessageId: null,
      });

      const result = moveContextToArchive(GROUP);
      expect(result?.archiveId).toBeTypeOf('string');

      // Context gone
      expect(getTripContext(GROUP)).toBeUndefined();

      // Archive row present with snapshot + archived_at
      const archiveRow = sqlite
        .prepare('SELECT * FROM trip_archive WHERE group_jid = ?')
        .get(GROUP) as Record<string, unknown>;
      expect(archiveRow).toBeDefined();
      expect(archiveRow.id).toBe(result?.archiveId);
      expect(archiveRow.destination).toBe('Rome');
      expect(archiveRow.status).toBe('archived');
      expect(archiveRow.calendar_id).toBe('cal-x');
      expect(archiveRow.briefing_time).toBe('08:30');
      expect(typeof archiveRow.archived_at).toBe('number');
      expect((archiveRow.archived_at as number) > Date.now() - 5000).toBe(true);

      // Decisions still present, still archived=0 until we call the next helper
      const beforeArchive = sqlite
        .prepare(
          'SELECT COUNT(*) as c FROM trip_decisions WHERE group_jid = ? AND archived = 0',
        )
        .get(GROUP) as { c: number };
      expect(beforeArchive.c).toBe(2);

      const flipped = markDecisionsArchivedForGroup(GROUP);
      expect(flipped).toBe(2);

      const afterArchive = sqlite
        .prepare(
          'SELECT COUNT(*) as c FROM trip_decisions WHERE group_jid = ? AND archived = 1',
        )
        .get(GROUP) as { c: number };
      expect(afterArchive.c).toBe(2);

      // Default getDecisionsByGroup hides archived rows
      expect(getDecisionsByGroup(GROUP)).toHaveLength(0);
      // Explicit opt-in returns them
      expect(
        getDecisionsByGroup(GROUP, { includeArchived: true }),
      ).toHaveLength(2);
    });

    it('returns null when no context exists', () => {
      expect(moveContextToArchive('missing@g.us')).toBeNull();
    });
  });

  describe('getExpiredActiveContexts', () => {
    it('returns rows past end_date + 3 days, excludes recent and archived', () => {
      const today = new Date();
      const minusDays = (d: number) => {
        const t = new Date(today);
        t.setDate(t.getDate() - d);
        return t.toISOString().slice(0, 10);
      };

      // Expired by 4 days past end_date (end + 3 buffer < now)
      upsertTripContext('grp-expired@g.us', {
        destination: 'Rome',
        startDate: minusDays(14),
        endDate: minusDays(7),
      });
      // Not yet expired — end_date yesterday, still inside 3-day grace
      upsertTripContext('grp-fresh@g.us', {
        destination: 'Paris',
        startDate: minusDays(10),
        endDate: minusDays(1),
      });
      // Already archived status — excluded
      upsertTripContext('grp-archived@g.us', {
        destination: 'London',
        startDate: minusDays(20),
        endDate: minusDays(12),
        status: 'archived',
      });
      // No end_date — excluded
      upsertTripContext('grp-nodate@g.us', {
        destination: 'Tokyo',
      });

      const expired = getExpiredActiveContexts(Date.now());
      const groups = expired.map((r) => r.groupJid).sort();
      expect(groups).toEqual(['grp-expired@g.us']);
    });
  });

  describe('Phase 55 dashboard helpers', () => {
    // ── migration round-trip ────────────────────────────────────────────────
    describe('migration 0024 columns', () => {
      it('adds status/lat/lng with correct defaults', () => {
        const cols = sqlite.prepare('PRAGMA table_info(trip_decisions)').all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
        }>;
        const statusCol = cols.find((c) => c.name === 'status');
        const latCol = cols.find((c) => c.name === 'lat');
        const lngCol = cols.find((c) => c.name === 'lng');

        expect(statusCol).toBeDefined();
        expect(statusCol!.notnull).toBe(1);
        expect(statusCol!.dflt_value).toBe("'active'");

        expect(latCol).toBeDefined();
        expect(latCol!.notnull).toBe(0);

        expect(lngCol).toBeDefined();
        expect(lngCol!.notnull).toBe(0);
      });
    });

    // ── softDeleteDecision ──────────────────────────────────────────────────
    describe('softDeleteDecision', () => {
      it('flips status from active to deleted', () => {
        const id = randomUUID();
        insertTripDecision({ id, groupJid: GROUP, type: 'destination', value: 'Rome', confidence: 'high', sourceMessageId: null });

        softDeleteDecision(id);

        const row = sqlite.prepare('SELECT status FROM trip_decisions WHERE id = ?').get(id) as { status: string };
        expect(row.status).toBe('deleted');
      });

      it('is idempotent on already-deleted rows', () => {
        const id = randomUUID();
        insertTripDecision({ id, groupJid: GROUP, type: 'destination', value: 'Paris', confidence: 'high', sourceMessageId: null });

        softDeleteDecision(id);
        softDeleteDecision(id); // second call should not throw

        const row = sqlite.prepare('SELECT status FROM trip_decisions WHERE id = ?').get(id) as { status: string };
        expect(row.status).toBe('deleted');
        const count = (sqlite.prepare('SELECT COUNT(*) as c FROM trip_decisions WHERE id = ?').get(id) as { c: number }).c;
        expect(count).toBe(1); // still single row
      });

      it('returns changes: 0 for unknown id', () => {
        const result = softDeleteDecision('non-existent-uuid');
        expect(result.changes).toBe(0);
      });
    });

    // ── getDecisionsByGroup deleted-filter ──────────────────────────────────
    describe('getDecisionsByGroup deleted-filter', () => {
      it('excludes status=deleted by default', () => {
        // 3 active + 1 deleted
        for (let i = 0; i < 3; i++) {
          insertTripDecision({ id: randomUUID(), groupJid: GROUP, type: 'activity', value: `Activity ${i}`, confidence: 'high', sourceMessageId: null });
        }
        const deletedId = randomUUID();
        insertTripDecision({ id: deletedId, groupJid: GROUP, type: 'activity', value: 'Deleted activity', confidence: 'high', sourceMessageId: null });
        softDeleteDecision(deletedId);

        const rows = getDecisionsByGroup(GROUP);
        expect(rows).toHaveLength(3);
        expect(rows.every((r) => r.status !== 'deleted')).toBe(true);
      });

      it('includeDeleted: true returns all 4 rows', () => {
        for (let i = 0; i < 3; i++) {
          insertTripDecision({ id: randomUUID(), groupJid: GROUP, type: 'activity', value: `Activity ${i}`, confidence: 'high', sourceMessageId: null });
        }
        const deletedId = randomUUID();
        insertTripDecision({ id: deletedId, groupJid: GROUP, type: 'activity', value: 'Deleted activity', confidence: 'high', sourceMessageId: null });
        softDeleteDecision(deletedId);

        const rows = getDecisionsByGroup(GROUP, { includeDeleted: true });
        expect(rows).toHaveLength(4);
      });

      it('legacy positional-arg call still excludes deleted rows', () => {
        insertTripDecision({ id: randomUUID(), groupJid: GROUP, type: 'flights', value: 'TLV-FCO', confidence: 'high', sourceMessageId: null });
        const deletedId = randomUUID();
        insertTripDecision({ id: deletedId, groupJid: GROUP, type: 'flights', value: 'Cancelled flight', confidence: 'high', sourceMessageId: null });
        softDeleteDecision(deletedId);

        const rows = getDecisionsByGroup(GROUP, 'flights');
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toBe('TLV-FCO');
      });
    });

    // ── getBudgetRollup deleted-exclusion ───────────────────────────────────
    describe('getBudgetRollup deleted-exclusion', () => {
      it('ignores cost_amount of status=deleted rows', () => {
        upsertTripContext(GROUP, { destination: 'Rome', budgetByCategory: { food: 200 } });

        insertTripDecision({ id: randomUUID(), groupJid: GROUP, type: 'food', value: 'Dinner', confidence: 'high', sourceMessageId: null, category: 'food', costAmount: 50 });
        const deletedId = randomUUID();
        insertTripDecision({ id: deletedId, groupJid: GROUP, type: 'food', value: 'Cancelled dinner', confidence: 'high', sourceMessageId: null, category: 'food', costAmount: 50 });
        softDeleteDecision(deletedId);

        const roll = getBudgetRollup(GROUP);
        expect(roll.spent.food).toBe(50); // Only non-deleted row counts
      });
    });

    // ── updateBudgetByCategory ──────────────────────────────────────────────
    describe('updateBudgetByCategory', () => {
      it('merges new category into existing budget JSON', () => {
        upsertTripContext(GROUP, { destination: 'Rome', budgetByCategory: { food: 200 } });

        const merged = updateBudgetByCategory(GROUP, { lodging: 500 });
        expect(merged.food).toBe(200);
        expect(merged.lodging).toBe(500);

        const ctx = getTripContext(GROUP)!;
        const stored = JSON.parse(ctx.budgetByCategory);
        expect(stored.food).toBe(200);
        expect(stored.lodging).toBe(500);
      });

      it('overwrites existing category amount', () => {
        upsertTripContext(GROUP, { destination: 'Rome', budgetByCategory: { food: 200 } });

        const merged = updateBudgetByCategory(GROUP, { food: 300 });
        expect(merged.food).toBe(300);
      });

      it('throws when trip_context row missing', () => {
        expect(() => updateBudgetByCategory('missing@g.us', { food: 100 })).toThrow();
      });
    });

    // ── listTripsForDashboard sort ──────────────────────────────────────────
    describe('listTripsForDashboard sort', () => {
      it('upcoming trips sort first by startDate ASC, then past trips DESC by endDate', () => {
        const today = new Date().toISOString().slice(0, 10);
        const offset = (days: number) => {
          const d = new Date(today);
          d.setDate(d.getDate() + days);
          return d.toISOString().slice(0, 10);
        };

        // trip_A: upcoming, startDate = today+10
        upsertTripContext('grp-A@g.us', { destination: 'Trip A', startDate: offset(10), endDate: offset(15) });
        // trip_B: upcoming, startDate = today+5 (sorts before A)
        upsertTripContext('grp-B@g.us', { destination: 'Trip B', startDate: offset(5), endDate: offset(9) });
        // trip_C: past, endDate = today-30
        upsertTripContext('grp-C@g.us', { destination: 'Trip C', startDate: offset(-45), endDate: offset(-30) });

        const list = listTripsForDashboard();
        const jids = list.map((t) => t.groupJid);

        expect(jids.indexOf('grp-B@g.us')).toBeLessThan(jids.indexOf('grp-A@g.us'));
        expect(jids.indexOf('grp-A@g.us')).toBeLessThan(jids.indexOf('grp-C@g.us'));
      });

      it('archived trips appear last in archivedAt DESC', () => {
        const today = new Date().toISOString().slice(0, 10);
        const offset = (days: number) => {
          const d = new Date(today);
          d.setDate(d.getDate() + days);
          return d.toISOString().slice(0, 10);
        };

        // One past trip_contexts row
        upsertTripContext('grp-past@g.us', { destination: 'Past Trip', startDate: offset(-20), endDate: offset(-10) });

        // Two trip_archive rows with different archivedAt
        sqlite.exec(`INSERT INTO trip_archive (id, group_jid, destination, dates, context_summary, last_classified_at, updated_at, start_date, end_date, budget_by_category, calendar_id, status, briefing_time, archived_at)
          VALUES ('arch-1', 'grp-arch1@g.us', 'Archive 1', null, null, null, ${Date.now()}, '${offset(-60)}', '${offset(-50)}', '{}', null, 'archived', null, ${Date.now() - 2000})`);
        sqlite.exec(`INSERT INTO trip_archive (id, group_jid, destination, dates, context_summary, last_classified_at, updated_at, start_date, end_date, budget_by_category, calendar_id, status, briefing_time, archived_at)
          VALUES ('arch-2', 'grp-arch2@g.us', 'Archive 2', null, null, null, ${Date.now()}, '${offset(-80)}', '${offset(-70)}', '{}', null, 'archived', null, ${Date.now() - 1000})`);

        const list = listTripsForDashboard();
        const jids = list.map((t) => t.groupJid);

        // past trip_context row before archive rows
        expect(jids.indexOf('grp-past@g.us')).toBeLessThan(jids.indexOf('grp-arch1@g.us'));
        expect(jids.indexOf('grp-past@g.us')).toBeLessThan(jids.indexOf('grp-arch2@g.us'));
        // arch-2 has larger archivedAt (less old), so it sorts first (DESC)
        expect(jids.indexOf('grp-arch2@g.us')).toBeLessThan(jids.indexOf('grp-arch1@g.us'));
      });
    });

    // ── getTripBundle ───────────────────────────────────────────────────────
    describe('getTripBundle', () => {
      it('returns full payload: context + decisions + openQuestions + calendarEvents + budget', () => {
        const today = new Date().toISOString().slice(0, 10);
        const offset = (days: number) => {
          const d = new Date(today);
          d.setDate(d.getDate() + days);
          return d.toISOString().slice(0, 10);
        };

        upsertTripContext(GROUP, {
          destination: 'Rome',
          startDate: offset(1),
          endDate: offset(7),
          budgetByCategory: { flights: 1000, lodging: 500 },
        });

        const activeId = randomUUID();
        insertTripDecision({ id: activeId, groupJid: GROUP, type: 'accommodation', value: 'Hotel Roma', confidence: 'high', sourceMessageId: null, category: 'lodging', costAmount: 300 });

        const deletedId = randomUUID();
        insertTripDecision({ id: deletedId, groupJid: GROUP, type: 'activity', value: 'Old tour', confidence: 'high', sourceMessageId: null });
        softDeleteDecision(deletedId);

        const qId = randomUUID();
        insertTripDecision({ id: qId, groupJid: GROUP, type: 'open_question', value: 'Which hotel?', confidence: 'high', sourceMessageId: null });

        const bundle = getTripBundle(GROUP);

        expect(bundle).not.toBeNull();
        expect(bundle!.context!.destination).toBe('Rome');
        expect(bundle!.readOnly).toBe(false);
        // decisions includes both active and deleted
        expect(bundle!.decisions.length).toBeGreaterThanOrEqual(2);
        expect(bundle!.decisions.some((d) => d.id === deletedId)).toBe(true);
        expect(bundle!.decisions.some((d) => d.id === activeId)).toBe(true);
        // openQuestions only has non-deleted unresolved
        expect(bundle!.openQuestions.some((q) => q.id === qId)).toBe(true);
        expect(bundle!.openQuestions.every((q) => q.status !== 'deleted')).toBe(true);
        // budget is populated
        expect(bundle!.budget.targets.flights).toBe(1000);
        expect(bundle!.budget.spent.lodging).toBe(300);
      });

      it('falls through to trip_archive with readOnly: true for archived trips', () => {
        const today = new Date().toISOString().slice(0, 10);
        sqlite.exec(`INSERT INTO trip_archive (id, group_jid, destination, dates, context_summary, last_classified_at, updated_at, start_date, end_date, budget_by_category, calendar_id, status, briefing_time, archived_at)
          VALUES ('arch-bundle-test', 'grp-only-archive@g.us', 'Barcelona', null, null, null, ${Date.now()}, '${today}', '${today}', '{}', null, 'archived', null, ${Date.now()})`);

        const bundle = getTripBundle('grp-only-archive@g.us');

        expect(bundle).not.toBeNull();
        expect(bundle!.readOnly).toBe(true);
        expect(bundle!.context!.status).toBe('archived');
        expect(bundle!.context!.destination).toBe('Barcelona');
      });

      it('returns null when neither trip_contexts nor trip_archive has the group', () => {
        const result = getTripBundle('completely-unknown@g.us');
        expect(result).toBeNull();
      });
    });
  });

  describe('backwards-compat: existing callers', () => {
    it('getDecisionsByGroup(groupJid, type) still works (positional type arg)', () => {
      insertTripDecision({
        id: randomUUID(),
        groupJid: GROUP,
        type: 'destination',
        value: 'Rome',
        confidence: 'high',
        sourceMessageId: null,
      });
      insertTripDecision({
        id: randomUUID(),
        groupJid: GROUP,
        type: 'activity',
        value: 'Colosseum',
        confidence: 'high',
        sourceMessageId: null,
      });

      const dests = getDecisionsByGroup(GROUP, 'destination');
      expect(dests).toHaveLength(1);
      expect(dests[0].value).toBe('Rome');
    });

    it('getUnresolvedOpenItems ignores archived open_question rows', () => {
      const archivedOpen = randomUUID();
      insertTripDecision({
        id: archivedOpen,
        groupJid: GROUP,
        type: 'open_question',
        value: 'old question',
        confidence: 'high',
        sourceMessageId: null,
      });
      sqlite
        .prepare('UPDATE trip_decisions SET archived = 1 WHERE id = ?')
        .run(archivedOpen);

      insertTripDecision({
        id: randomUUID(),
        groupJid: GROUP,
        type: 'open_question',
        value: 'new question',
        confidence: 'high',
        sourceMessageId: null,
      });

      const open = getUnresolvedOpenItems(GROUP);
      expect(open).toHaveLength(1);
      expect(open[0].value).toBe('new question');
    });
  });
});
