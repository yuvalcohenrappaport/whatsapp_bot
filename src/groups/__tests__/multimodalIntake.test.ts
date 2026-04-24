/**
 * Phase 52-02 Task 3: Integration + unit tests for multimodalIntake.
 *
 * 12 test cases covering every branch of handleMultimodalIntake with mocked
 * vision + mocked sock + mocked baileys download + real in-memory DB.
 * No GEMINI_API_KEY required. No network. No real Baileys.
 *
 * Real-fixture accuracy (Plan 52-03) lives in a separate suite.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';
import { mkImageMsg, mkPdfMsg, mkStickerMsg } from './fixtures/multimodal/testHelpers.js';

// ─── In-memory DB via migration replay (same pattern as tripPreferences.test.ts) ──

const sqlite = new Database(':memory:');
const drizzleDir = 'drizzle';
const migrationFiles = readdirSync(drizzleDir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();
for (const file of migrationFiles) {
  // Skip 0010 — FTS5 virtual table uses an fts5 module that may not be
  // compiled into every node better-sqlite3 build.
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

// ─── Module mocks — declared BEFORE import of multimodalIntake ───────────────

// Gemini vision — replaced per-test via mockResolvedValueOnce.
vi.mock('../../ai/geminiVision.js', () => ({
  extractTripFact: vi.fn(),
}));

// Baileys downloadMediaMessage — keep all real exports, override just this one.
vi.mock('@whiskeysockets/baileys', async () => {
  const actual = await vi.importActual<typeof import('@whiskeysockets/baileys')>(
    '@whiskeysockets/baileys',
  );
  return {
    ...actual,
    downloadMediaMessage: vi
      .fn()
      .mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
  };
});

// Suggestion tracker — so we don't actually try to send WhatsApp messages.
vi.mock('../suggestionTracker.js', () => ({
  createSuggestion: vi.fn().mockResolvedValue(undefined),
}));

// Shared sock mock — tests read the sendMessage spy through getState().
const mockSendMessage = vi.fn().mockResolvedValue({ key: { id: 'ack-msg' } });
vi.mock('../../api/state.js', () => ({
  getState: vi.fn(() => ({
    sock: { sendMessage: mockSendMessage },
  })),
}));

// calendarHelpers — mock detectGroupLanguage + ensureGroupCalendar so
// multimodal tests don't hit real calendar creation. Preserve other exports.
vi.mock('../calendarHelpers.js', async () => {
  const actual = await vi.importActual<typeof import('../calendarHelpers.js')>(
    '../calendarHelpers.js',
  );
  return {
    ...actual,
    detectGroupLanguage: vi.fn().mockResolvedValue('en'),
    ensureGroupCalendar: vi.fn().mockResolvedValue({
      calendarId: 'cal-id-abc',
      calendarLink: 'https://calendar.google.com/calendar/embed?src=cal-id-abc',
    }),
  };
});

// conflictDetector — assert the Phase 51-03 hook fires on multimodal inserts.
vi.mock('../conflictDetector.js', () => ({
  runAfterInsert: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import after mocks are registered ───────────────────────────────────────

const { handleMultimodalIntake } = await import('../multimodalIntake.js');
const { extractTripFact } = await import('../../ai/geminiVision.js');
const { createSuggestion } = await import('../suggestionTracker.js');
const { runAfterInsert } = await import('../conflictDetector.js');
const calendarHelpers = await import('../calendarHelpers.js');

const mockExtract = vi.mocked(extractTripFact);
const mockCreateSuggestion = vi.mocked(createSuggestion);
const mockRunAfterInsert = vi.mocked(runAfterInsert);
const mockDetectLang = vi.mocked(calendarHelpers.detectGroupLanguage);

// ─── Test group setup ────────────────────────────────────────────────────────

const ACTIVE_GROUP = '120363999999@g.us';
const INACTIVE_GROUP = '120363888888@g.us';

function seedGroups() {
  sqlite
    .prepare(
      `INSERT INTO groups (id, name, travel_bot_active, keyword_rules_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(ACTIVE_GROUP, 'Italy Trip', 1, 0, Date.now(), Date.now());
  sqlite
    .prepare(
      `INSERT INTO groups (id, name, travel_bot_active, keyword_rules_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(INACTIVE_GROUP, 'Inactive Group', 0, 0, Date.now(), Date.now());
}

function clearAll() {
  sqlite.exec('DELETE FROM trip_decisions');
  sqlite.exec('DELETE FROM trip_contexts');
  sqlite.exec('DELETE FROM groups');
}

function countDecisions(): number {
  return (
    sqlite
      .prepare('SELECT COUNT(*) as c FROM trip_decisions')
      .get() as { c: number }
  ).c;
}

function getDecisionRow(): Record<string, unknown> | undefined {
  return sqlite
    .prepare('SELECT * FROM trip_decisions LIMIT 1')
    .get() as Record<string, unknown> | undefined;
}

function flightExtraction(overrides: Partial<{
  date: string | null;
  time: string | null;
  confidence: number;
  type: string;
  title: string;
}> = {}) {
  return {
    type: (overrides.type ?? 'flight') as 'flight' | 'hotel' | 'restaurant' | 'activity' | 'transit' | 'other',
    title: overrides.title ?? 'LH401 TLV→FRA',
    date: overrides.date === undefined ? '2026-05-10' : overrides.date,
    time: overrides.time === undefined ? '14:20' : overrides.time,
    location: 'TLV Airport',
    address: null,
    reservation_number: 'ABC123',
    cost_amount: 450,
    cost_currency: 'EUR',
    confidence: overrides.confidence ?? 0.95,
    notes: null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('handleMultimodalIntake', () => {
  beforeEach(() => {
    clearAll();
    seedGroups();
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({ key: { id: 'ack-msg' } });
    mockDetectLang.mockResolvedValue('en');
  });

  it('1. skips sticker messages without calling vision', async () => {
    await handleMultimodalIntake(ACTIVE_GROUP, mkStickerMsg(ACTIVE_GROUP));

    expect(mockExtract).not.toHaveBeenCalled();
    expect(countDecisions()).toBe(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('2. skips images under 50KB without calling vision', async () => {
    await handleMultimodalIntake(ACTIVE_GROUP, mkImageMsg(ACTIVE_GROUP, 30_000));

    expect(mockExtract).not.toHaveBeenCalled();
    expect(countDecisions()).toBe(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('3. image >= 50KB + high confidence + dated → inserts, suggests, acks', async () => {
    mockExtract.mockResolvedValueOnce(flightExtraction());

    const msg = mkImageMsg(ACTIVE_GROUP, 80_000, 'msg-flight-1');
    await handleMultimodalIntake(ACTIVE_GROUP, msg);

    // DB insert with origin='multimodal' and metadata preserved
    expect(countDecisions()).toBe(1);
    const row = getDecisionRow()!;
    expect(row.origin).toBe('multimodal');
    expect(row.source_message_id).toBe('msg-flight-1');
    expect(row.type).toBe('flight');

    const metadata = JSON.parse(row.metadata as string);
    expect(metadata.date).toBe('2026-05-10');
    expect(metadata.time).toBe('14:20');
    expect(metadata.location).toBe('TLV Airport');
    expect(metadata.vision_confidence).toBe(0.95);

    // createSuggestion called once with matching args
    expect(mockCreateSuggestion).toHaveBeenCalledTimes(1);
    const [suggestGroupJid, extracted, calId, calLink, sourceMsgId] =
      mockCreateSuggestion.mock.calls[0];
    expect(suggestGroupJid).toBe(ACTIVE_GROUP);
    expect(extracted.title).toBe('LH401 TLV→FRA');
    expect(extracted.date.getTime()).toBe(new Date('2026-05-10T14:20:00').getTime());
    expect(calId).toBe('cal-id-abc');
    expect(calLink).toContain('cal-id-abc');
    expect(sourceMsgId).toBe('msg-flight-1');

    // 1-line ack posted
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const ackArg = mockSendMessage.mock.calls[0][1] as { text: string };
    expect(ackArg.text).toMatch(/^📌 noted: flight — /);
    expect(ackArg.text).not.toContain('\n');
  });

  it('4. PDF passes through regardless of size (no pre-filter)', async () => {
    mockExtract.mockResolvedValueOnce(flightExtraction({ title: 'Hilton Rome', type: 'hotel' }));

    const msg = mkPdfMsg(ACTIVE_GROUP, 10_000, 'msg-pdf-small');
    await handleMultimodalIntake(ACTIVE_GROUP, msg);

    // Vision called — pre-filter did NOT skip the small PDF
    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(countDecisions()).toBe(1);
    const row = getDecisionRow()!;
    expect(row.type).toBe('hotel');
    expect(row.source_message_id).toBe('msg-pdf-small');
  });

  it('5. high confidence, no date or time → inserts + acks, no suggest', async () => {
    mockExtract.mockResolvedValueOnce(
      flightExtraction({ date: null, time: null, confidence: 0.85 }),
    );

    await handleMultimodalIntake(ACTIVE_GROUP, mkImageMsg(ACTIVE_GROUP));

    expect(countDecisions()).toBe(1);
    expect(mockCreateSuggestion).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('6. high confidence, date present but time null → no suggest, ack posted', async () => {
    mockExtract.mockResolvedValueOnce(
      flightExtraction({ date: '2026-05-10', time: null, confidence: 0.9 }),
    );

    await handleMultimodalIntake(ACTIVE_GROUP, mkImageMsg(ACTIVE_GROUP));

    expect(countDecisions()).toBe(1);
    expect(mockCreateSuggestion).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('7. low confidence (< 0.8) → silent drop, no DB, no ack', async () => {
    mockExtract.mockResolvedValueOnce(
      flightExtraction({ confidence: 0.6 }),
    );

    await handleMultimodalIntake(ACTIVE_GROUP, mkImageMsg(ACTIVE_GROUP));

    expect(countDecisions()).toBe(0);
    expect(mockCreateSuggestion).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('8. vision returns null (API error or schema violation) → silent drop', async () => {
    mockExtract.mockResolvedValueOnce(null);

    await handleMultimodalIntake(ACTIVE_GROUP, mkImageMsg(ACTIVE_GROUP));

    expect(countDecisions()).toBe(0);
    expect(mockCreateSuggestion).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('9. vision throws → never rethrows, no DB, no ack', async () => {
    mockExtract.mockRejectedValueOnce(new Error('boom'));

    await expect(
      handleMultimodalIntake(ACTIVE_GROUP, mkImageMsg(ACTIVE_GROUP)),
    ).resolves.toBeUndefined();

    expect(countDecisions()).toBe(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('10. Hebrew group ack uses נרשם + Hebrew type, still single line', async () => {
    mockDetectLang.mockResolvedValueOnce('he');
    mockExtract.mockResolvedValueOnce(flightExtraction());

    await handleMultimodalIntake(ACTIVE_GROUP, mkImageMsg(ACTIVE_GROUP));

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const ackArg = mockSendMessage.mock.calls[0][1] as { text: string };
    expect(ackArg.text).toMatch(/^📌 נרשם: (טיסה|מלון|מסעדה|פעילות|תחבורה|פריט) — /);
    expect(ackArg.text).not.toContain('\n');
  });

  it('11. travelBotActive=false group → no vision, no DB, no ack', async () => {
    mockExtract.mockResolvedValueOnce(flightExtraction());

    await handleMultimodalIntake(INACTIVE_GROUP, mkImageMsg(INACTIVE_GROUP));

    expect(mockExtract).not.toHaveBeenCalled();
    expect(countDecisions()).toBe(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('12. runAfterInsert wiring — fires once with (groupJid, decisionId) matching inserted row', async () => {
    mockExtract.mockResolvedValueOnce(flightExtraction());

    await handleMultimodalIntake(ACTIVE_GROUP, mkImageMsg(ACTIVE_GROUP));

    // Allow the fire-and-forget .catch() microtask to settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRunAfterInsert).toHaveBeenCalledTimes(1);
    const [calledGroup, calledDecisionId] = mockRunAfterInsert.mock.calls[0];
    expect(calledGroup).toBe(ACTIVE_GROUP);

    const row = getDecisionRow()!;
    expect(calledDecisionId).toBe(row.id);
  });
});
