import * as cron from 'node-cron';
import pino from 'pino';
import { config } from '../config.js';
import {
  getActiveContextsForBriefing,
  upsertTripContext,
  getTripContext,
} from '../db/queries/tripMemory.js';
import { generateText } from '../ai/provider.js';
import type { BriefingInput } from '../groups/dayOfBriefing.js';

const logger = pino({ level: config.LOG_LEVEL });

let scheduled: cron.ScheduledTask | null = null;

// ─── Timezone lookup table (top ~50 destinations) ────────────────────────────
// Keys are lowercase. Partial matches (e.g. "central rome" → "Europe/Rome")
// are handled by checking if the destination contains any key.
// CONTEXT_LOCKED in .planning/phases/54-proactive-day-of-intelligence/54-CONTEXT.md
// — do not rename or split into a separate file without updating the context.
const TZ_TABLE: Record<string, string> = {
  // Europe
  rome: 'Europe/Rome',
  milan: 'Europe/Rome',
  florence: 'Europe/Rome',
  paris: 'Europe/Paris',
  london: 'Europe/London',
  berlin: 'Europe/Berlin',
  amsterdam: 'Europe/Amsterdam',
  barcelona: 'Europe/Madrid',
  madrid: 'Europe/Madrid',
  lisbon: 'Europe/Lisbon',
  vienna: 'Europe/Vienna',
  prague: 'Europe/Prague',
  budapest: 'Europe/Budapest',
  warsaw: 'Europe/Warsaw',
  athens: 'Europe/Athens',
  istanbul: 'Europe/Istanbul',
  copenhagen: 'Europe/Copenhagen',
  stockholm: 'Europe/Stockholm',
  oslo: 'Europe/Oslo',
  helsinki: 'Europe/Helsinki',
  zurich: 'Europe/Zurich',
  geneva: 'Europe/Zurich',
  brussels: 'Europe/Brussels',
  // Americas
  'new york': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  miami: 'America/New_York',
  chicago: 'America/Chicago',
  toronto: 'America/Toronto',
  'mexico city': 'America/Mexico_City',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  'sao paulo': 'America/Sao_Paulo',
  'rio de janeiro': 'America/Sao_Paulo',
  // Asia-Pacific
  tokyo: 'Asia/Tokyo',
  osaka: 'Asia/Tokyo',
  kyoto: 'Asia/Tokyo',
  bangkok: 'Asia/Bangkok',
  singapore: 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  beijing: 'Asia/Shanghai',
  shanghai: 'Asia/Shanghai',
  seoul: 'Asia/Seoul',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  dubai: 'Asia/Dubai',
  doha: 'Asia/Qatar',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  // Africa / Middle East
  cairo: 'Africa/Cairo',
  'tel aviv': 'Asia/Jerusalem',
  jerusalem: 'Asia/Jerusalem',
  marrakech: 'Africa/Casablanca',
  nairobi: 'Africa/Nairobi',
};

const DEFAULT_TZ = 'Asia/Jerusalem';
const DEFAULT_BRIEFING_TIME = '08:00';
const BRIEFING_WINDOW_MIN = 7; // ± minutes around briefing_time

/**
 * Resolve destination string → IANA timezone name.
 *
 * Resolution order:
 *   1. Cached `metadata.tz` if caller passed one — always wins (avoids a
 *      needless Gemini call once we've already resolved this trip).
 *   2. Exact lowercase lookup in `TZ_TABLE`.
 *   3. Partial match — destination string contains a known table key.
 *   4. Gemini one-shot fallback (returns raw IANA tz string).
 *   5. `DEFAULT_TZ` on Gemini failure — briefing never silently dies.
 *
 * The caller is responsible for caching the returned value in
 * `tripContexts.metadata.tz` so subsequent ticks short-circuit at step 1.
 */
export async function resolveDestinationTz(
  destination: string,
  cachedTz?: string | null,
): Promise<string> {
  if (cachedTz) return cachedTz;

  const normalized = destination.trim().toLowerCase();
  if (!normalized) return DEFAULT_TZ;

  // Exact hit.
  const exact = TZ_TABLE[normalized];
  if (exact) return exact;

  // Partial — destination contains a known key.
  for (const [key, tz] of Object.entries(TZ_TABLE)) {
    if (normalized.includes(key)) return tz;
  }

  // Gemini fallback — single short prompt, extract raw IANA tz string.
  try {
    const response = await generateText({
      systemPrompt:
        'You are a timezone lookup assistant. Respond with ONLY the IANA timezone name ' +
        '(e.g. "Europe/Rome", "America/New_York") for the given destination. ' +
        'No explanation, no punctuation, just the tz string.',
      messages: [{ role: 'user', content: destination }],
    });

    const tz = response?.trim();
    if (tz && /^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/.test(tz)) {
      return tz;
    }
    logger.warn(
      { destination, tz },
      'Gemini tz fallback returned non-IANA string — defaulting',
    );
  } catch (err) {
    logger.warn(
      { err, destination },
      'Gemini tz fallback threw — defaulting to Asia/Jerusalem',
    );
  }

  return DEFAULT_TZ;
}

// ─── Window check helpers ────────────────────────────────────────────────────

/**
 * Return today's date string (`YYYY-MM-DD`) in the given IANA tz. Uses
 * Intl.DateTimeFormat so no external tz lib is required.
 */
export function dateInTz(nowMs: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));

  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/**
 * Return current time-of-day in the given IANA tz expressed as minutes since
 * midnight (0–1439). Used for briefing-window math.
 */
function minutesOfDayInTz(nowMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(nowMs));

  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
  }
  // Intl may emit "24" at midnight in some locales — clamp to 0.
  if (hour === 24) hour = 0;
  return hour * 60 + minute;
}

function parseHHMM(s: string): { h: number; m: number } {
  const [hs, ms] = s.split(':');
  return { h: parseInt(hs ?? '0', 10) || 0, m: parseInt(ms ?? '0', 10) || 0 };
}

/** Subtract one day from a YYYY-MM-DD string, preserving the format. */
function yyyymmddMinusOneDay(dateStr: string): string {
  // Use UTC to avoid host-tz DST surprises. The subtraction is date-only.
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Check whether this trip should be briefed right now:
 *   - today (in destTz) ∈ [start_date − 1day, end_date]
 *   - local time-of-day in destTz is within ± BRIEFING_WINDOW_MIN of briefingTime
 *   - lastBriefingDate ≠ today (dedup guard)
 *
 * Returns false if any required field is missing — the cron will just skip
 * the row. Malformed rows get picked up for repair by the dashboard.
 */
export function isInBriefingWindow(opts: {
  nowMs: number;
  destTz: string;
  startDate: string | null;
  endDate: string | null;
  briefingTime: string | null;
  lastBriefingDate: string | null;
}): boolean {
  const { nowMs, destTz, startDate, endDate, briefingTime, lastBriefingDate } =
    opts;

  if (!startDate || !endDate) return false;

  const todayInTz = dateInTz(nowMs, destTz);

  // Dedup — if we already briefed today (in destination-tz), skip.
  if (lastBriefingDate && lastBriefingDate === todayInTz) return false;

  // Date window: [start_date − 1, end_date] (inclusive).
  const windowStart = yyyymmddMinusOneDay(startDate);
  if (todayInTz < windowStart) return false;
  if (todayInTz > endDate) return false;

  // Time window: |now − briefingTime| ≤ BRIEFING_WINDOW_MIN minutes.
  const target = parseHHMM(briefingTime ?? DEFAULT_BRIEFING_TIME);
  const targetMinutes = target.h * 60 + target.m;
  const nowMinutes = minutesOfDayInTz(nowMs, destTz);
  if (Math.abs(nowMinutes - targetMinutes) > BRIEFING_WINDOW_MIN) return false;

  return true;
}

// ─── Orchestrator stub ───────────────────────────────────────────────────────
//
// Plan 03 lands `src/groups/dayOfBriefing.ts` which exports `runDayOfBriefing`.
// During Wave 1 (this plan) the file doesn't exist yet, so we use a dynamic
// import wrapped in try/catch. Tests can also inject an orchestrator via DI
// to bypass module resolution entirely.

async function defaultOrchestrator(input: BriefingInput): Promise<void> {
  const mod = (await import('../groups/dayOfBriefing.js')) as {
    runDayOfBriefing?: (input: BriefingInput) => Promise<void>;
  };
  if (typeof mod.runDayOfBriefing !== 'function') {
    throw new Error(
      'dayOfBriefing.runDayOfBriefing not exported — module shape unexpected',
    );
  }
  await mod.runDayOfBriefing(input);
}

/**
 * One cron tick: iterate all active trips, resolve destination-tz (cached in
 * metadata), check the briefing window, call the orchestrator, and persist
 * `last_briefing_date` on success.
 *
 * `nowMs` defaults to `Date.now()`. `orchestrator` is a DI seam for tests.
 */
export async function runBriefingCheckOnce(
  nowMs: number = Date.now(),
  orchestrator: (input: BriefingInput) => Promise<void> = defaultOrchestrator,
): Promise<{ checked: number; triggered: number }> {
  const rows = getActiveContextsForBriefing();
  let triggered = 0;

  for (const row of rows) {
    if (!row.destination) continue;

    let meta: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        meta = JSON.parse(row.metadata) as Record<string, unknown>;
      } catch {
        // Malformed metadata — treat as empty, don't crash the tick.
        meta = {};
      }
    }

    const cachedTz =
      typeof meta.tz === 'string' ? (meta.tz as string) : null;
    const destTz = await resolveDestinationTz(row.destination, cachedTz);

    // If we freshly resolved a tz (wasn't cached), persist it so subsequent
    // ticks skip the lookup.
    if (!cachedTz && destTz) {
      const nextMeta = { ...meta, tz: destTz };
      upsertTripContext(row.groupJid, {
        metadata: JSON.stringify(nextMeta),
      });
      meta = nextMeta;
    }

    const lastBriefingDate =
      typeof meta.last_briefing_date === 'string'
        ? (meta.last_briefing_date as string)
        : null;

    if (
      !isInBriefingWindow({
        nowMs,
        destTz,
        startDate: row.startDate,
        endDate: row.endDate,
        briefingTime: row.briefingTime,
        lastBriefingDate,
      })
    ) {
      continue;
    }

    const todayInDestTz = dateInTz(nowMs, destTz);

    const coords =
      meta.coords &&
      typeof meta.coords === 'object' &&
      typeof (meta.coords as { lat?: unknown }).lat === 'number' &&
      typeof (meta.coords as { lon?: unknown }).lon === 'number'
        ? (meta.coords as { lat: number; lon: number })
        : null;

    try {
      await orchestrator({
        groupJid: row.groupJid,
        destination: row.destination,
        calendarId: row.calendarId,
        destTz,
        todayIso: todayInDestTz,
        coords,
        openWeatherApiKey: config.OPENWEATHER_API_KEY ?? null,
      });

      // Re-read metadata from DB before patching — another worker may have
      // touched the row between our read and the orchestrator call.
      const fresh = getTripContext(row.groupJid);
      let latestMeta: Record<string, unknown> = {};
      if (fresh?.metadata) {
        try {
          latestMeta = JSON.parse(fresh.metadata) as Record<string, unknown>;
        } catch {
          latestMeta = {};
        }
      }

      upsertTripContext(row.groupJid, {
        metadata: JSON.stringify({
          ...latestMeta,
          last_briefing_date: todayInDestTz,
        }),
      });
      triggered++;
    } catch (err) {
      logger.error(
        { err, groupJid: row.groupJid },
        'Briefing orchestrator threw — will retry on next tick',
      );
    }
  }

  if (triggered > 0) {
    logger.info(
      { checked: rows.length, triggered },
      'Briefing cron tick complete',
    );
  }
  return { checked: rows.length, triggered };
}

/**
 * Register the 15-min cron that fires `runBriefingCheckOnce`. Idempotent —
 * calling twice stops the previous task first. Mirrors `initArchiveTripsCron`.
 */
export function initBriefingCron(): void {
  if (scheduled) {
    scheduled.stop();
    scheduled = null;
  }

  scheduled = cron.schedule(
    '*/15 * * * *',
    () => {
      runBriefingCheckOnce().catch((err) => {
        logger.error({ err }, 'Briefing cron handler threw');
      });
    },
    { timezone: 'Asia/Jerusalem' },
  );
  logger.info('Briefing cron initialized (every 15 min, Asia/Jerusalem)');
}
