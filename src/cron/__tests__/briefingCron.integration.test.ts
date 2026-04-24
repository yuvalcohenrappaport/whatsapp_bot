import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BriefingInput } from '../../groups/dayOfBriefing.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

// ─── In-memory DB with all migrations ─────────────────────────────────────────
// Mirrors the pattern in src/scheduler/__tests__/archiveTripsCron.test.ts:
// replay every drizzle migration in order, skipping 0010 (FTS5 virtual table)
// which these tests don't need. Migration 0023 (Plan 01) adds trip_contexts.metadata,
// which is required for the dedup test case below.
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

// IMPORTANT: mock db client + config + ai provider BEFORE importing briefingCron.
// Also mock dayOfBriefing so defaultOrchestrator's dynamic import resolves to a spy.
vi.mock('../../groups/dayOfBriefing.js', () => ({
  runDayOfBriefing: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../db/client.js', () => ({ db: testDb }));
vi.mock('../../config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    GEMINI_API_KEY: 'fake',
    GEMINI_MODEL: 'gemini-2.5-flash',
    OPENWEATHER_API_KEY: undefined,
    NODE_ENV: 'test',
  },
}));
vi.mock('../../ai/provider.js', () => ({
  generateText: vi.fn().mockResolvedValue('Europe/Rome'),
}));

// Dynamic imports AFTER mocks are registered.
const { runBriefingCheckOnce } = await import('../briefingCron.js');
const tripMemory = await import('../../db/queries/tripMemory.js');

// Mock orchestrator — this is the DI seam exposed by runBriefingCheckOnce.
// Bypasses the real dayOfBriefing module entirely. No HTTP calls, no
// send-message side effects — we only exercise the cron scheduling + dedup logic here.
const orchestratorMock = vi.fn((_: BriefingInput) =>
  Promise.resolve<void>(undefined),
);

const GROUP = '120363777777@g.us';

// Fixed "now" = 2026-05-10T06:02:00Z = 08:02 Europe/Rome (CEST, UTC+2).
// Target briefing_time = 08:00 → within the ±7min window.
// TODAY_ROME = '2026-05-10'.
const NOW_MS = Date.parse('2026-05-10T06:02:00Z');
const TODAY_ROME = '2026-05-10';

function clearAll() {
  sqlite.exec('DELETE FROM trip_decisions');
  sqlite.exec('DELETE FROM trip_contexts');
  sqlite.exec('DELETE FROM trip_archive');
}

beforeEach(async () => {
  clearAll();
  orchestratorMock.mockClear();
  const { runDayOfBriefing } = await import('../../groups/dayOfBriefing.js');
  vi.mocked(runDayOfBriefing).mockClear();
  vi.mocked(runDayOfBriefing).mockResolvedValue(undefined);
});

describe('runBriefingCheckOnce (integration)', () => {
  it('triggers orchestrator for matching active trip with no prior briefing', async () => {
    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      briefingTime: '08:00',
      status: 'active',
    });

    const { triggered } = await runBriefingCheckOnce(NOW_MS, orchestratorMock);
    expect(triggered).toBe(1);
    expect(orchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        groupJid: GROUP,
        destination: 'Rome',
        calendarId: null,
        destTz: 'Europe/Rome',
        todayIso: TODAY_ROME,
        coords: null,
        openWeatherApiKey: null,
      }),
    );
  });

  it('does NOT trigger twice on same day (dedup: last_briefing_date)', async () => {
    // Seed with last_briefing_date already = today. Requires migration 0023
    // (trip_contexts.metadata column) and upsertTripContext metadata support.
    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      briefingTime: '08:00',
      status: 'active',
      metadata: JSON.stringify({ last_briefing_date: TODAY_ROME }),
    });

    const { triggered } = await runBriefingCheckOnce(NOW_MS, orchestratorMock);
    expect(triggered).toBe(0);
    expect(orchestratorMock).not.toHaveBeenCalled();
  });

  it('skips archived trips', async () => {
    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
      briefingTime: '08:00',
      status: 'archived',
    });

    const { triggered } = await runBriefingCheckOnce(NOW_MS, orchestratorMock);
    expect(triggered).toBe(0);
    expect(orchestratorMock).not.toHaveBeenCalled();
  });

  it('skips trip with start_date more than 1 day in the future', async () => {
    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-15', // 5 days from now — outside [start_date − 1, end_date]
      endDate: '2026-05-20',
      briefingTime: '08:00',
      status: 'active',
    });

    const { triggered } = await runBriefingCheckOnce(NOW_MS, orchestratorMock);
    expect(triggered).toBe(0);
    expect(orchestratorMock).not.toHaveBeenCalled();
  });

  it('triggers on day-before-travel (start_date − 1 = today)', async () => {
    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-11', // tomorrow — so today is exactly the day-before-travel edge
      endDate: '2026-05-15',
      briefingTime: '08:00',
      status: 'active',
    });

    const { triggered } = await runBriefingCheckOnce(NOW_MS, orchestratorMock);
    expect(triggered).toBe(1);
    expect(orchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({ groupJid: GROUP, destination: 'Rome' }),
    );
  });

  it('skips trip whose end_date is in the past', async () => {
    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-01',
      endDate: '2026-05-09', // ended yesterday — outside window
      briefingTime: '08:00',
      status: 'active',
    });

    const { triggered } = await runBriefingCheckOnce(NOW_MS, orchestratorMock);
    expect(triggered).toBe(0);
    expect(orchestratorMock).not.toHaveBeenCalled();
  });

  it('does NOT trigger when time is outside ±7min window (08:10 vs 08:00)', async () => {
    // 2026-05-10T06:10:00Z = 08:10 Europe/Rome — 10 minutes past target, exceeds ±7min.
    const NOW_0810 = Date.parse('2026-05-10T06:10:00Z');
    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      briefingTime: '08:00',
      status: 'active',
    });

    const { triggered } = await runBriefingCheckOnce(NOW_0810, orchestratorMock);
    expect(triggered).toBe(0);
    expect(orchestratorMock).not.toHaveBeenCalled();
  });

  it('updates last_briefing_date after successful orchestrator call', async () => {
    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      briefingTime: '08:00',
      status: 'active',
    });

    await runBriefingCheckOnce(NOW_MS, orchestratorMock);

    const ctx = tripMemory.getTripContext(GROUP);
    const meta = JSON.parse(ctx?.metadata ?? '{}') as {
      last_briefing_date?: string;
    };
    expect(meta.last_briefing_date).toBe(TODAY_ROME);
  });

  it('two consecutive ticks on same day → exactly one trigger (dedup guard end-to-end)', async () => {
    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      briefingTime: '08:00',
      status: 'active',
    });

    // First tick: should trigger and persist last_briefing_date.
    const first = await runBriefingCheckOnce(NOW_MS, orchestratorMock);
    expect(first.triggered).toBe(1);

    // Second tick 15 minutes later (still within the Rome day, still within
    // the broader hour but outside ±7min of 08:00 — even if we pretended it
    // were inside, last_briefing_date would now gate us).
    // Use the same NOW_MS to prove that even an identical tick doesn't
    // re-trigger once last_briefing_date is set.
    const second = await runBriefingCheckOnce(NOW_MS, orchestratorMock);
    expect(second.triggered).toBe(0);

    // Orchestrator called exactly once across both ticks.
    expect(orchestratorMock).toHaveBeenCalledTimes(1);
  });
});

describe('runBriefingCheckOnce (integration) — real runDayOfBriefing contract', () => {
  // Note: intentionally does NOT inject an orchestrator mock via DI.
  // Exercises the real defaultOrchestrator → dynamic import → (mocked) runDayOfBriefing path.
  // Proves that briefingCron passes a BriefingInput-shaped object, not a bare groupJid string.

  it('defaultOrchestrator invokes runDayOfBriefing with BriefingInput (not a bare string)', async () => {
    const { runDayOfBriefing } = await import('../../groups/dayOfBriefing.js');
    const spy = vi.mocked(runDayOfBriefing);
    spy.mockClear();

    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      briefingTime: '08:00',
      status: 'active',
      calendarId: 'fake-calendar-id',
      metadata: JSON.stringify({ coords: { lat: 41.9, lon: 12.5 } }),
    });

    // No DI orchestrator — use the real defaultOrchestrator path
    const { triggered } = await runBriefingCheckOnce(NOW_MS);
    expect(triggered).toBe(1);

    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0][0];

    // Negative guard: prove the old bug would be caught here
    expect(typeof callArg).not.toBe('string');

    // Positive shape
    expect(callArg).toEqual(
      expect.objectContaining({
        groupJid: GROUP,
        destination: 'Rome',
        calendarId: 'fake-calendar-id',
        destTz: 'Europe/Rome',
        todayIso: TODAY_ROME,
        coords: { lat: 41.9, lon: 12.5 },
        openWeatherApiKey: null, // config mock leaves OPENWEATHER_API_KEY undefined → null
      }),
    );
  });

  it('defaultOrchestrator passes calendarId=null when the row has none (regression guard)', async () => {
    const { runDayOfBriefing } = await import('../../groups/dayOfBriefing.js');
    const spy = vi.mocked(runDayOfBriefing);
    spy.mockClear();

    tripMemory.upsertTripContext(GROUP, {
      destination: 'Rome',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      briefingTime: '08:00',
      status: 'active',
      // calendarId intentionally omitted → DB stores null
    });

    await runBriefingCheckOnce(NOW_MS);

    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0][0];
    expect(callArg).toEqual(
      expect.objectContaining({
        groupJid: GROUP,
        calendarId: null,
        coords: null, // no metadata.coords set
      }),
    );
  });
});
