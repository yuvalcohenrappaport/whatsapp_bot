import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock config + db + ai BEFORE importing the module under test ─────────────
// briefingCron imports config (for LOG_LEVEL), the db query helpers, and the
// ai provider (for the Gemini tz fallback). All three are mocked so the
// tests stay offline and deterministic.
vi.mock('../../config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    GEMINI_API_KEY: 'fake',
    GEMINI_MODEL: 'gemini-2.5-flash',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../db/queries/tripMemory.js', () => ({
  getActiveContextsForBriefing: vi.fn().mockReturnValue([]),
  getTripContext: vi.fn().mockReturnValue(null),
  upsertTripContext: vi.fn(),
}));

const generateTextMock = vi.fn().mockResolvedValue('Atlantic/Reykjavik');
vi.mock('../../ai/provider.js', () => ({
  generateText: generateTextMock,
}));

const { resolveDestinationTz, isInBriefingWindow, dateInTz } = await import(
  '../briefingCron.js'
);

beforeEach(() => {
  generateTextMock.mockClear();
});

describe('resolveDestinationTz', () => {
  it('resolves "rome" → Europe/Rome from table (exact lowercase match)', async () => {
    expect(await resolveDestinationTz('Rome')).toBe('Europe/Rome');
  });

  it('resolves with partial match "central rome" → Europe/Rome', async () => {
    expect(await resolveDestinationTz('central Rome')).toBe('Europe/Rome');
  });

  it('uses cached tz when provided (skips table + Gemini entirely)', async () => {
    expect(await resolveDestinationTz('Unknown City', 'Pacific/Auckland')).toBe(
      'Pacific/Auckland',
    );
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('resolves multi-word "tel aviv" from the table', async () => {
    expect(await resolveDestinationTz('Tel Aviv')).toBe('Asia/Jerusalem');
  });

  it('falls back to Gemini for unlisted destination and returns IANA string', async () => {
    generateTextMock.mockResolvedValueOnce('Atlantic/Reykjavik');
    const tz = await resolveDestinationTz('Reykjavik');
    expect(tz).toBe('Atlantic/Reykjavik');
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it('defaults to Asia/Jerusalem when Gemini returns a non-IANA string', async () => {
    generateTextMock.mockResolvedValueOnce('not a valid tz');
    const tz = await resolveDestinationTz('Nowhere-ville');
    expect(tz).toBe('Asia/Jerusalem');
  });

  it('defaults to Asia/Jerusalem when Gemini throws', async () => {
    generateTextMock.mockRejectedValueOnce(new Error('network'));
    const tz = await resolveDestinationTz('Nowhere-ville');
    expect(tz).toBe('Asia/Jerusalem');
  });
});

describe('dateInTz', () => {
  it('returns YYYY-MM-DD in the given IANA tz', () => {
    // 2026-05-10T22:00:00Z = 2026-05-11 00:00 Asia/Jerusalem (UTC+2 → UTC+3 DST)
    const t = Date.parse('2026-05-10T22:00:00Z');
    expect(dateInTz(t, 'Asia/Jerusalem')).toBe('2026-05-11');
    // Same moment, but in Los Angeles it's still 2026-05-10.
    expect(dateInTz(t, 'America/Los_Angeles')).toBe('2026-05-10');
  });
});

describe('isInBriefingWindow', () => {
  // Fixed moment: 2026-05-10T06:02:00Z. In Rome (Europe/Rome, CEST = UTC+2)
  // this is 08:02 local. Chosen so the mid-window tests don't need to worry
  // about DST transitions (DST started 2026-03-29 and ends 2026-10-25).
  const NOW_ROME_0802 = Date.parse('2026-05-10T06:02:00Z');

  it('returns true — time within 7min of briefing_time, date in window', () => {
    expect(
      isInBriefingWindow({
        nowMs: NOW_ROME_0802,
        destTz: 'Europe/Rome',
        startDate: '2026-05-10',
        endDate: '2026-05-15',
        briefingTime: '08:00',
        lastBriefingDate: null,
      }),
    ).toBe(true);
  });

  it('returns false — already briefed today (dedup guard)', () => {
    expect(
      isInBriefingWindow({
        nowMs: NOW_ROME_0802,
        destTz: 'Europe/Rome',
        startDate: '2026-05-10',
        endDate: '2026-05-15',
        briefingTime: '08:00',
        lastBriefingDate: '2026-05-10',
      }),
    ).toBe(false);
  });

  it('returns true on day-before-travel (start_date − 1)', () => {
    expect(
      isInBriefingWindow({
        nowMs: NOW_ROME_0802,
        destTz: 'Europe/Rome',
        startDate: '2026-05-11', // trip starts tomorrow
        endDate: '2026-05-15',
        briefingTime: '08:00',
        lastBriefingDate: null,
      }),
    ).toBe(true);
  });

  it('returns false when today < start_date − 1', () => {
    expect(
      isInBriefingWindow({
        nowMs: NOW_ROME_0802,
        destTz: 'Europe/Rome',
        startDate: '2026-05-15',
        endDate: '2026-05-20',
        briefingTime: '08:00',
        lastBriefingDate: null,
      }),
    ).toBe(false);
  });

  it('returns false when today > end_date', () => {
    expect(
      isInBriefingWindow({
        nowMs: NOW_ROME_0802,
        destTz: 'Europe/Rome',
        startDate: '2026-05-01',
        endDate: '2026-05-09',
        briefingTime: '08:00',
        lastBriefingDate: null,
      }),
    ).toBe(false);
  });

  it('returns false — 10min outside ±7 window', () => {
    // 2026-05-10T06:10:00Z = 08:10 Europe/Rome — 10 min past target 08:00.
    const NOW_0810 = Date.parse('2026-05-10T06:10:00Z');
    expect(
      isInBriefingWindow({
        nowMs: NOW_0810,
        destTz: 'Europe/Rome',
        startDate: '2026-05-10',
        endDate: '2026-05-15',
        briefingTime: '08:00',
        lastBriefingDate: null,
      }),
    ).toBe(false);
  });

  it('handles Israel DST correctly (Asia/Jerusalem summer = UTC+3)', () => {
    // 2026-07-01T05:01:00Z = 08:01 Asia/Jerusalem during summer DST.
    const NOW_IL = Date.parse('2026-07-01T05:01:00Z');
    expect(
      isInBriefingWindow({
        nowMs: NOW_IL,
        destTz: 'Asia/Jerusalem',
        startDate: '2026-07-01',
        endDate: '2026-07-07',
        briefingTime: '08:00',
        lastBriefingDate: null,
      }),
    ).toBe(true);
  });

  it('defaults to 08:00 when briefing_time is null', () => {
    expect(
      isInBriefingWindow({
        nowMs: NOW_ROME_0802,
        destTz: 'Europe/Rome',
        startDate: '2026-05-10',
        endDate: '2026-05-15',
        briefingTime: null,
        lastBriefingDate: null,
      }),
    ).toBe(true);
  });

  it('returns false when start_date or end_date is null', () => {
    expect(
      isInBriefingWindow({
        nowMs: NOW_ROME_0802,
        destTz: 'Europe/Rome',
        startDate: null,
        endDate: '2026-05-15',
        briefingTime: '08:00',
        lastBriefingDate: null,
      }),
    ).toBe(false);
    expect(
      isInBriefingWindow({
        nowMs: NOW_ROME_0802,
        destTz: 'Europe/Rome',
        startDate: '2026-05-10',
        endDate: null,
        briefingTime: '08:00',
        lastBriefingDate: null,
      }),
    ).toBe(false);
  });

  it('returns true at exact 7-min boundary (edge case, upper)', () => {
    // 2026-05-10T06:07:00Z = 08:07 Europe/Rome — exactly at ±7 boundary.
    const NOW_0807 = Date.parse('2026-05-10T06:07:00Z');
    expect(
      isInBriefingWindow({
        nowMs: NOW_0807,
        destTz: 'Europe/Rome',
        startDate: '2026-05-10',
        endDate: '2026-05-15',
        briefingTime: '08:00',
        lastBriefingDate: null,
      }),
    ).toBe(true);
  });
});
