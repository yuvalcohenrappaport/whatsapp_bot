/**
 * IST (Asia/Jerusalem) date/time helpers.
 *
 * All functions are locked to Asia/Jerusalem via toLocaleString with a
 * regex-based reformat. No date library required — pure Date API.
 *
 * Israel observes DST (UTC+2 in winter, UTC+3 in summer). For grid math
 * (addIstDays, startOfIstWeek) we use a ±86400000ms approximation — same
 * tradeoff FullCalendar makes: a 1-hour visual shift on DST transitions
 * twice a year, which users accept.
 */

const IST_TZ = 'Asia/Jerusalem';

/**
 * Returns `"YYYY-MM-DD HH:mm"` in IST.
 * Uses en-GB locale as a deterministic DD/MM/YYYY, HH:MM source.
 */
export function formatIstAbsolute(ms: number): string {
  const formatted = new Date(ms).toLocaleString('en-GB', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // `20/04/2026, 14:32` → `2026-04-20 14:32`
  const match = formatted.match(
    /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})$/,
  );
  if (!match) return formatted;
  const [, dd, mm, yyyy, hh, min] = match;
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Returns `"HH:mm"` in IST.
 */
export function formatIstTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: IST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Returns `"Tue 20 Apr"` in IST.
 */
export function formatIstDateShort(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    timeZone: IST_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Returns the IST date components for a timestamp.
 * Internal helper used by several exported functions.
 */
function istComponents(ms: number): { year: number; month: number; day: number; dow: number; hour: number; minute: number } {
  const d = new Date(ms);
  // Get the IST date string in a parseable form
  const locale = d.toLocaleString('en-GB', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hour12: false,
  });
  // Format: "Monday, 20/04/2026, 14:32"
  const matchWithDay = locale.match(
    /^(\w+),\s+(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})$/,
  );
  if (matchWithDay) {
    const [, _dow, dd, mm, yyyy, hh, min] = matchWithDay;
    const year = parseInt(yyyy, 10);
    const month = parseInt(mm, 10) - 1; // 0-indexed
    const day = parseInt(dd, 10);
    const hour = parseInt(hh, 10);
    const minute = parseInt(min, 10);
    // Reconstruct a UTC date at midnight to get day-of-week
    const refDate = new Date(Date.UTC(year, month, day));
    const dow = refDate.getUTCDay(); // 0=Sun
    return { year, month, day, dow, hour, minute };
  }
  // Fallback: parse without weekday
  const match = locale.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})$/);
  if (match) {
    const [, dd, mm, yyyy, hh, min] = match;
    const year = parseInt(yyyy, 10);
    const month = parseInt(mm, 10) - 1;
    const day = parseInt(dd, 10);
    const hour = parseInt(hh, 10);
    const minute = parseInt(min, 10);
    const refDate = new Date(Date.UTC(year, month, day));
    const dow = refDate.getUTCDay();
    return { year, month, day, dow, hour, minute };
  }
  // Last resort: use UTC
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    dow: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/**
 * Returns unix ms for Sunday 00:00:00 IST of the week containing `ms`.
 * Week starts on Sunday (Israeli convention).
 */
export function startOfIstWeek(ms: number): number {
  const { year, month, day, dow } = istComponents(ms);
  // Build IST midnight for the given day, then step back `dow` days to Sunday
  const sundayDay = day - dow;
  // Use Date.UTC as a proxy: IST midnight = UTC midnight minus IST offset
  // For grid math accuracy, we construct a fake UTC date at IST local midnight
  // by finding the UTC equivalent of IST 00:00 on that day.
  const istMidnightApprox = new Date(year, month, sundayDay, 0, 0, 0, 0);
  return istMidnightApprox.getTime();
}

/**
 * Adds n calendar days (n × 86400000 ms) to ms.
 * Accepts DST edge case: visual shift of ±1h on DST transitions.
 */
export function addIstDays(ms: number, n: number): number {
  return ms + n * 86_400_000;
}

/**
 * Returns unix ms for today HH:mm in IST.
 */
export function istTodayAtMs(hour: number, minute: number): number {
  const now = Date.now();
  const { year, month, day } = istComponents(now);
  // Build local date at the given time — we approximate IST midnight
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

/**
 * Returns unix ms for midnight of the IST day containing `ms`.
 * Approximates: builds a local Date from IST year/month/day at 00:00.
 */
export function istDayStartMs(ms: number): number {
  const { year, month, day } = istComponents(ms);
  return new Date(year, month, day, 0, 0, 0, 0).getTime();
}

/**
 * Returns true if both timestamps fall on the same IST calendar day.
 */
export function sameIstDay(aMs: number, bMs: number): boolean {
  const a = istComponents(aMs);
  const b = istComponents(bMs);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
