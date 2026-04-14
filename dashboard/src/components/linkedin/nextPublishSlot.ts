/**
 * Compute the next LinkedIn publish slot — next Tuesday, Wednesday, or
 * Thursday at 06:30 Asia/Jerusalem. Pure function; no React, no deps.
 *
 * Why this matters: the status strip displays a countdown to the next slot.
 * We want it correct across DST transitions (Israel swaps between IDT/IST
 * in late March + late October) without pulling in date-fns-tz.
 *
 * Approach: for a given `now`, walk forward day-by-day (0..7) and find the
 * first Tue/Wed/Thu where 06:30 Jerusalem is still strictly in the future.
 * Compute the absolute UTC instant for (target_date, 06:30 Jerusalem) via
 * a two-pass offset correction — robust for DST.
 */

const JERUSALEM = 'Asia/Jerusalem';

const PUBLISH_DAYS = new Set<number>([2, 3, 4]); // 0=Sun … 2=Tue, 3=Wed, 4=Thu
const PUBLISH_HOUR = 6;
const PUBLISH_MINUTE = 30;

interface JerusalemParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun … 6=Sat
}

/**
 * Return the Jerusalem-local wall-clock parts of a UTC instant.
 */
function jerusalemParts(instant: Date): JerusalemParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: JERUSALEM,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl may return hour '24' at midnight — normalize.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday as string] ?? 0,
  };
}

/**
 * Given (year, month, day) in Jerusalem local time, compute the UTC Date
 * instant whose Jerusalem-local wall clock is (hour, minute, second=0).
 *
 * Uses an iterative correction because the offset between Jerusalem and UTC
 * depends on the date itself (DST). Converges in at most a couple of passes.
 */
function jerusalemWallClockToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // Initial guess treating the wall clock as UTC and subtracting 2h (winter).
  let guess = new Date(Date.UTC(year, month - 1, day, hour - 2, minute, 0, 0));
  for (let i = 0; i < 4; i++) {
    const parts = jerusalemParts(guess);
    const actualMinutesFromMidnight = parts.hour * 60 + parts.minute;
    const targetMinutesFromMidnight = hour * 60 + minute;
    const dateMatches =
      parts.year === year && parts.month === month && parts.day === day;
    if (dateMatches && actualMinutesFromMidnight === targetMinutesFromMidnight) {
      return guess;
    }
    // Correction based on delta between target and current Jerusalem wall clock.
    const targetUTC = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const actualUTC = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    );
    const delta = targetUTC - actualUTC;
    if (delta === 0) return guess;
    guess = new Date(guess.getTime() + delta);
  }
  return guess;
}

/**
 * Return the next Tue/Wed/Thu 06:30 Asia/Jerusalem strictly after `now`.
 */
export function nextPublishSlot(now: Date = new Date()): Date {
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const probe = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const parts = jerusalemParts(probe);
    if (!PUBLISH_DAYS.has(parts.weekday)) continue;
    const slot = jerusalemWallClockToUTC(
      parts.year,
      parts.month,
      parts.day,
      PUBLISH_HOUR,
      PUBLISH_MINUTE,
    );
    if (slot.getTime() > now.getTime()) return slot;
  }
  // Should never happen — 7 days always contains at least one Tue/Wed/Thu.
  throw new Error('nextPublishSlot: no slot found in next 7 days');
}

/**
 * Human-friendly label for the slot: "Next: Tue, Apr 15 · 06:30 IDT".
 * IDT/IST determined from the slot's Jerusalem offset (UTC+3 = IDT, UTC+2 = IST).
 */
export function formatSlotLabel(slot: Date): string {
  const dayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: JERUSALEM,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(slot);
  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: JERUSALEM,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(slot);
  // Offset tag (IDT/IST)
  const parts = jerusalemParts(slot);
  const localUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  const offsetMs = localUTC - slot.getTime();
  const tag = offsetMs === 3 * 60 * 60 * 1000 ? 'IDT' : 'IST';
  return `Next: ${dayStr} · ${timeStr} ${tag}`;
}

/**
 * Countdown string for the slot relative to now: "in 2d 14h" or "in 3h 12m"
 * or "in less than a minute". If slot is in the past, returns "now".
 */
export function formatCountdown(slot: Date, now: Date = new Date()): string {
  const diffMs = slot.getTime() - now.getTime();
  if (diffMs <= 0) return 'now';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m`;
  return 'in less than a minute';
}

// Manual smoke check (not a real test — dashboard has no vitest):
//   console.log(formatSlotLabel(nextPublishSlot(new Date('2026-04-13T12:00:00Z'))));
//   // Expect: "Next: Tue, Apr 14 · 06:30 IDT"
//   console.log(formatSlotLabel(nextPublishSlot(new Date('2026-04-17T00:00:00Z'))));
//   // Expect: "Next: Tue, Apr 21 · 06:30 IDT"
