import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

// In-memory DB bootstrapped by replaying every drizzle migration in order.
// Mirrors the pattern used in src/db/queries/__tests__/tripMemory.test.ts
// (skip 0010 FTS5, split on the statement-breakpoint marker).
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

vi.mock('../../db/client.js', () => ({ db: testDb }));

const { handleSelfReportCommand } = await import('../tripPreferences.js');

const GROUP = '120363999999@g.us';
const SENDER = '972501111111@s.whatsapp.net';

function makeMsg(
  body: string,
  overrides: Partial<{
    id: string;
    senderJid: string;
    senderName: string | null;
    timestamp: number;
  }> = {},
) {
  return {
    id: overrides.id ?? 'MSG-' + Math.random().toString(36).slice(2),
    senderJid: overrides.senderJid ?? SENDER,
    senderName: overrides.senderName ?? 'Alice',
    body,
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

function clearAll() {
  sqlite.exec('DELETE FROM trip_decisions');
  sqlite.exec('DELETE FROM trip_contexts');
  sqlite.exec('DELETE FROM trip_archive');
}

describe('handleSelfReportCommand', () => {
  beforeEach(() => clearAll());

  describe('!pref', () => {
    it('inserts a self_reported activity decision and returns true', async () => {
      const msg = makeMsg('!pref אני טבעוני');
      const handled = await handleSelfReportCommand(GROUP, msg);
      expect(handled).toBe(true);

      const rows = sqlite
        .prepare('SELECT * FROM trip_decisions WHERE group_jid = ?')
        .all(GROUP) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('אני טבעוני');
      expect(rows[0].origin).toBe('self_reported');
      expect(rows[0].proposed_by).toBe(SENDER);
      expect(rows[0].type).toBe('activity');
      expect(rows[0].source_message_id).toBe(msg.id);
    });

    it('silently drops empty !pref body — no DB write, still terminal', async () => {
      const handled = await handleSelfReportCommand(GROUP, makeMsg('!pref'));
      expect(handled).toBe(true);

      const count = sqlite
        .prepare('SELECT COUNT(*) as c FROM trip_decisions')
        .get() as { c: number };
      expect(count.c).toBe(0);
    });

    it('silently drops !pref with only whitespace args', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!pref    '),
      );
      expect(handled).toBe(true);
      const count = sqlite
        .prepare('SELECT COUNT(*) as c FROM trip_decisions')
        .get() as { c: number };
      expect(count.c).toBe(0);
    });
  });

  describe('!budget', () => {
    it('updates budget_by_category[category] with amount + currency', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!budget food 500 EUR'),
      );
      expect(handled).toBe(true);

      const ctx = sqlite
        .prepare('SELECT budget_by_category FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP) as { budget_by_category: string };
      const parsed = JSON.parse(ctx.budget_by_category);
      expect(parsed.food).toEqual({ amount: 500, currency: 'EUR' });
    });

    it('uppercases a lowercase currency', async () => {
      await handleSelfReportCommand(GROUP, makeMsg('!budget food 500 eur'));
      const ctx = sqlite
        .prepare('SELECT budget_by_category FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP) as { budget_by_category: string };
      expect(JSON.parse(ctx.budget_by_category).food.currency).toBe('EUR');
    });

    it('merges a second !budget without clobbering prior entries', async () => {
      await handleSelfReportCommand(GROUP, makeMsg('!budget food 500 EUR'));
      await handleSelfReportCommand(
        GROUP,
        makeMsg('!budget lodging 800 EUR'),
      );

      const ctx = sqlite
        .prepare('SELECT budget_by_category FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP) as { budget_by_category: string };
      const parsed = JSON.parse(ctx.budget_by_category);
      expect(parsed.food).toEqual({ amount: 500, currency: 'EUR' });
      expect(parsed.lodging).toEqual({ amount: 800, currency: 'EUR' });
    });

    it('silently drops invalid category', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!budget foo 500 EUR'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });

    it('silently drops non-numeric amount', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!budget food abc EUR'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });

    it('silently drops missing third arg', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!budget food 500'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });

    it('silently drops non-positive amount', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!budget food -5 EUR'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });

    it('silently drops zero amount', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!budget food 0 EUR'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });

    it('silently drops malformed currency (length != 3)', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!budget food 500 DOLLARS'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });
  });

  describe('!dates', () => {
    it('sets start_date + end_date when args are valid ISO and start <= end', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!dates 2026-05-10 2026-05-20'),
      );
      expect(handled).toBe(true);

      const ctx = sqlite
        .prepare(
          'SELECT start_date, end_date FROM trip_contexts WHERE group_jid = ?',
        )
        .get(GROUP) as { start_date: string; end_date: string };
      expect(ctx.start_date).toBe('2026-05-10');
      expect(ctx.end_date).toBe('2026-05-20');
    });

    it('silently drops impossible month (13)', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!dates 2026-13-01 2026-05-20'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });

    it('silently drops end < start', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!dates 2026-05-20 2026-05-10'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });

    it('silently drops non-ISO tokens', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!dates yesterday today'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });

    it('silently drops missing second date', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!dates 2026-05-10'),
      );
      expect(handled).toBe(true);
      const ctx = sqlite
        .prepare('SELECT * FROM trip_contexts WHERE group_jid = ?')
        .get(GROUP);
      expect(ctx).toBeUndefined();
    });
  });

  describe('unknown verb / non-command fallthrough', () => {
    it('returns false for an unknown !verb', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('!foobar whatever'),
      );
      expect(handled).toBe(false);
      const count = sqlite
        .prepare('SELECT COUNT(*) as c FROM trip_decisions')
        .get() as { c: number };
      expect(count.c).toBe(0);
    });

    it('returns false for a non-! message', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('hello world'),
      );
      expect(handled).toBe(false);
    });

    it('returns false for a message starting with whitespace then text', async () => {
      const handled = await handleSelfReportCommand(
        GROUP,
        makeMsg('   hello !pref nope'),
      );
      expect(handled).toBe(false);
    });
  });
});
