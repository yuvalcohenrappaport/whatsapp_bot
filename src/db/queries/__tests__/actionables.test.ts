import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../schema.js';

// In-memory DB per test file, bootstrapped from the actionables migration SQL.
const sqlite = new Database(':memory:');
const migrationSQL = readFileSync('drizzle/0020_actionables.sql', 'utf8');
for (const stmt of migrationSQL.split('--> statement-breakpoint')) {
  const t = stmt.trim();
  if (t) sqlite.exec(t);
}
const testDb = drizzle(sqlite, { schema });

vi.mock('../../client.js', () => ({ db: testDb }));

// Import AFTER the mock is registered
const {
  createActionable,
  getActionableById,
  getActionableByPreviewMsgId,
  getPendingActionables,
  getExpiredActionables,
  updateActionableStatus,
  updateActionableTask,
  updateActionableEnrichment,
  updateActionableTodoIds,
  updateActionablePreviewMsgId,
  getRecentTerminalActionables,
  isValidTransition,
} = await import('../actionables.js');

type Status =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'fired'
  | 'expired';

const ALL_STATUSES: Status[] = [
  'pending_approval',
  'approved',
  'rejected',
  'fired',
  'expired',
];

function clearTable() {
  sqlite.exec('DELETE FROM actionables');
}

function seed(overrides: Partial<Parameters<typeof createActionable>[0]> = {}) {
  const id = overrides.id ?? randomUUID();
  createActionable({
    id,
    sourceType: 'commitment',
    sourceContactJid: '972501234567@s.whatsapp.net',
    sourceContactName: 'Lee',
    sourceMessageId: 'MSG1',
    sourceMessageText: "I'll send the report tomorrow",
    detectedLanguage: 'en',
    originalDetectedTask: 'Send the report to Lee',
    ...overrides,
  });
  return id;
}

describe('actionables queries', () => {
  beforeEach(() => clearTable());

  describe('createActionable + getActionableById', () => {
    it('persists a new row with defaults', () => {
      const id = seed();
      const row = getActionableById(id);
      expect(row).toBeDefined();
      expect(row?.status).toBe('pending_approval');
      expect(row?.task).toBe('Send the report to Lee');
      expect(row?.sourceType).toBe('commitment');
      expect(row?.detectedAt).toBeTypeOf('number');
      expect(row?.createdAt).toBeTypeOf('number');
    });

    it('defaults task to originalDetectedTask when not provided', () => {
      const id = seed({ originalDetectedTask: 'Buy milk' });
      expect(getActionableById(id)?.task).toBe('Buy milk');
    });

    it('respects an explicit task override', () => {
      const id = seed({
        originalDetectedTask: 'send it',
        task: 'Send the Q2 report to Lee',
      });
      expect(getActionableById(id)?.task).toBe('Send the Q2 report to Lee');
    });

    it('returns undefined for a missing id', () => {
      expect(getActionableById('nope')).toBeUndefined();
    });
  });

  describe('getPendingActionables', () => {
    it('returns only pending_approval rows ordered by detectedAt desc', () => {
      const older = seed({
        originalDetectedTask: 'old',
        detectedAt: 1000,
      });
      const newer = seed({
        originalDetectedTask: 'new',
        detectedAt: 2000,
      });
      seed({ status: 'approved', originalDetectedTask: 'already approved' });
      seed({ status: 'rejected', originalDetectedTask: 'rejected' });

      const rows = getPendingActionables();
      expect(rows.map((r) => r.id)).toEqual([newer, older]);
    });
  });

  describe('getExpiredActionables', () => {
    it('returns pending rows older than the cutoff', () => {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const old = seed({
        originalDetectedTask: 'old',
        detectedAt: now - sevenDaysMs - 1000,
      });
      seed({ originalDetectedTask: 'recent', detectedAt: now - 1000 });
      seed({
        originalDetectedTask: 'old but approved',
        status: 'approved',
        detectedAt: now - sevenDaysMs - 1000,
      });

      const rows = getExpiredActionables(now - sevenDaysMs);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(old);
    });
  });

  describe('isValidTransition (full truth table)', () => {
    const cases: Array<[Status, Status, boolean]> = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        cases.push([from, to, expected(from, to)]);
      }
    }

    function expected(from: Status, to: Status): boolean {
      if (from === 'pending_approval') {
        return to === 'approved' || to === 'rejected' || to === 'expired';
      }
      if (from === 'approved') return to === 'fired';
      return false;
    }

    it.each(cases)('%s → %s is %s', (from, to, ok) => {
      expect(isValidTransition(from, to)).toBe(ok);
    });
  });

  describe('updateActionableStatus', () => {
    it('allows pending_approval → approved', () => {
      const id = seed();
      updateActionableStatus(id, 'approved');
      expect(getActionableById(id)?.status).toBe('approved');
    });

    it('allows approved → fired', () => {
      const id = seed();
      updateActionableStatus(id, 'approved');
      updateActionableStatus(id, 'fired');
      expect(getActionableById(id)?.status).toBe('fired');
    });

    it('throws on invalid transition rejected → approved', () => {
      const id = seed();
      updateActionableStatus(id, 'rejected');
      expect(() => updateActionableStatus(id, 'approved')).toThrow(
        /invalid actionable transition/,
      );
    });

    it('is idempotent for same-state transition', () => {
      const id = seed();
      updateActionableStatus(id, 'approved');
      expect(() => updateActionableStatus(id, 'approved')).not.toThrow();
    });

    it('throws for unknown id', () => {
      expect(() => updateActionableStatus('nope', 'approved')).toThrow(
        /not found/,
      );
    });

    it('bumps updatedAt', async () => {
      const id = seed();
      const before = getActionableById(id)!.updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      updateActionableStatus(id, 'approved');
      const after = getActionableById(id)!.updatedAt;
      expect(after).toBeGreaterThan(before);
    });
  });

  describe('updateActionableTask', () => {
    it('replaces task without touching originalDetectedTask', () => {
      const id = seed({
        originalDetectedTask: 'send it',
        task: 'send it',
      });
      updateActionableTask(id, 'Send the Q2 report to Lee');
      const row = getActionableById(id)!;
      expect(row.task).toBe('Send the Q2 report to Lee');
      expect(row.originalDetectedTask).toBe('send it');
    });
  });

  describe('updateActionableEnrichment', () => {
    it('sets enriched title + note', () => {
      const id = seed();
      updateActionableEnrichment(id, {
        title: 'Send Q2 report to Lee by Friday',
        note: 'From: Lee\nSnippet: ...',
      });
      const row = getActionableById(id)!;
      expect(row.enrichedTitle).toBe('Send Q2 report to Lee by Friday');
      expect(row.enrichedNote).toContain('From: Lee');
    });
  });

  describe('updateActionableTodoIds', () => {
    it('persists Google Tasks ids', () => {
      const id = seed();
      updateActionableTodoIds(id, {
        todoTaskId: 'T1',
        todoListId: 'L1',
      });
      const row = getActionableById(id)!;
      expect(row.todoTaskId).toBe('T1');
      expect(row.todoListId).toBe('L1');
    });
  });

  describe('updateActionablePreviewMsgId + lookup', () => {
    it('roundtrips through getActionableByPreviewMsgId', () => {
      const id = seed();
      updateActionablePreviewMsgId(id, 'PREVIEW_1');
      const row = getActionableByPreviewMsgId('PREVIEW_1');
      expect(row?.id).toBe(id);
    });
  });

  describe('getRecentTerminalActionables', () => {
    it('returns terminal-state rows in updatedAt desc order', () => {
      const a = seed({ status: 'approved', detectedAt: 1000 });
      seed({ status: 'pending_approval', detectedAt: 1500 }); // excluded
      const b = seed({ status: 'rejected', detectedAt: 2000 });
      const c = seed({ status: 'expired', detectedAt: 3000 });

      const rows = getRecentTerminalActionables(10);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(a);
      expect(ids).toContain(b);
      expect(ids).toContain(c);
      expect(rows.find((r) => r.status === 'pending_approval')).toBeUndefined();
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        seed({ status: 'rejected' });
      }
      expect(getRecentTerminalActionables(3)).toHaveLength(3);
    });
  });
});
