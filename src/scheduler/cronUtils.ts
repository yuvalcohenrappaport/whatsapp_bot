/**
 * Cron utilities for recurring scheduled messages.
 *
 * CRITICAL: Do NOT use node-cron getNextRun() — it has a documented bug
 * for weekday expressions in v4.2.1 (returns dates years in the future).
 * See 32-RESEARCH.md Pitfall 1.
 */

// ─── Build cron expression from cadence + timestamp ──────────────────────────

export function buildCronExpression(
  cadence: 'daily' | 'weekly' | 'monthly',
  scheduledAtMs: number,
  timezone: string = 'Asia/Jerusalem',
): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    day: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(scheduledAtMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';

  const hour = parseInt(get('hour'));
  const minute = parseInt(get('minute'));
  const day = parseInt(get('day'));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = weekdays.indexOf(get('weekday')); // 0-6

  switch (cadence) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${weekday}`;
    case 'monthly':
      return `${minute} ${hour} ${day} * *`;
  }
}

// ─── Get next occurrence from cron expression (DST-safe) ─────────────────────

export function getNextOccurrence(cronExpr: string, tz: string = 'Asia/Jerusalem'): number | null {
  const cronParts = cronExpr.trim().split(/\s+/);
  const minute = parseInt(cronParts[0]);
  const hour = parseInt(cronParts[1]);
  const dom = cronParts[2] === '*' ? null : parseInt(cronParts[2]); // day-of-month
  const dow = cronParts[4] === '*' ? null : parseInt(cronParts[4]); // 0=Sun…6=Sat

  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const fmtHHMM = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  for (let daysAhead = 0; daysAhead <= 400; daysAhead++) {
    const probe = new Date(now.getTime() + daysAhead * 86_400_000);
    const dateParts = fmtDate.formatToParts(probe);
    const getD = (type: string) => dateParts.find((p) => p.type === type)?.value ?? '';

    const year = parseInt(getD('year'));
    const month = parseInt(getD('month'));
    const day = parseInt(getD('day'));
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekday = weekdays.indexOf(getD('weekday'));

    if (dom !== null && dom !== day) continue;
    if (dow !== null && dow !== weekday) continue;

    // Find UTC ms for year/month/day at hour:minute in tz (handles DST ambiguity)
    const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    let utcMs: number | null = null;
    for (let offsetMin = -840; offsetMin <= 840; offsetMin++) {
      const tryMs = naiveUtcMs - offsetMin * 60_000;
      const p = fmtHHMM.formatToParts(new Date(tryMs));
      const getP = (type: string) => parseInt(p.find((x) => x.type === type)?.value ?? '0');
      if (
        getP('year') === year &&
        getP('month') === month &&
        getP('day') === day &&
        getP('hour') === hour &&
        getP('minute') === minute
      ) {
        utcMs = tryMs;
        break;
      }
    }

    if (utcMs !== null && utcMs > now.getTime() + 60_000) {
      return utcMs;
    }
  }
  return null;
}

// ─── Derive cadence label from cron expression ───────────────────────────────

export function getCadenceFromCron(
  cronExpression: string | null,
): 'daily' | 'weekly' | 'monthly' | null {
  if (!cronExpression) return null;
  const parts = cronExpression.trim().split(/\s+/);
  if (parts[2] !== '*') return 'monthly';
  if (parts[4] !== '*') return 'weekly';
  return 'daily';
}
