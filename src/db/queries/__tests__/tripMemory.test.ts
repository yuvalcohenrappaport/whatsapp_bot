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
