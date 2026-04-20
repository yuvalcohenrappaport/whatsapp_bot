import { google, type calendar_v3 } from 'googleapis';
import pino from 'pino';
import { config } from '../config.js';
import { getOAuth2Client } from './personalCalendarService.js';

const logger = pino({ level: config.LOG_LEVEL });

// Palette mirrors Phase 46's hashListColor palette for per-source visual consistency.
const CALENDAR_PALETTE = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-fuchsia-500',
];

export function hashCalendarColor(calendarId: string): string {
  // djb2 over calendarId — stable per Google (renames do NOT change the id).
  let h = 5381;
  for (let i = 0; i < calendarId.length; i++) {
    h = ((h << 5) + h) ^ calendarId.charCodeAt(i);
  }
  return CALENDAR_PALETTE[Math.abs(h) % CALENDAR_PALETTE.length];
}

export type GcalCalendarMeta = {
  id: string;
  name: string; // summary field
  accessRole: string; // 'owner' | 'writer' | 'reader' | 'freeBusyReader'
  colorId: string | null;
  primary: boolean;
  color: string; // derived tailwind bg class from hashCalendarColor
};

export type GcalCalendarItem = {
  id: string; // event id (unique after singleEvents expansion)
  calendarId: string;
  calendarName: string;
  colorId: string | null;
  title: string;
  startMs: number;
  endMs: number | null;
  isAllDay: boolean;
  htmlLink: string | null; // e.g. https://www.google.com/calendar/event?eid=...
  etag: string | null;
};

function getCalClient(): calendar_v3.Calendar | null {
  const auth = getOAuth2Client();
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

/**
 * List every calendar the owner has access to, filtered to owned/writable only.
 * Returns empty array if OAuth is not configured.
 */
export async function listOwnerCalendars(): Promise<GcalCalendarMeta[]> {
  const client = getCalClient();
  if (!client) {
    logger.warn('listOwnerCalendars: OAuth2 client not available');
    return [];
  }

  const res = await client.calendarList.list({
    maxResults: 250,
    showDeleted: false,
    showHidden: false,
  });
  const items = res.data.items ?? [];

  return items
    .filter(
      (c) => c.id && (c.accessRole === 'owner' || c.accessRole === 'writer'),
    )
    .map((c) => ({
      id: c.id!,
      name: c.summary ?? c.id!,
      accessRole: c.accessRole ?? 'reader',
      colorId: c.colorId ?? null,
      primary: !!c.primary,
      color: hashCalendarColor(c.id!),
    }));
}

/**
 * Fetch all events across all owned/writable calendars within [fromMs, toMs].
 * Recurring events are expanded via singleEvents: true.
 * All-day events carry isAllDay: true and end is mapped to an inclusive ms
 * (Google's all-day end is exclusive — e.g. a one-day Tue event returns
 * end.date='Wed', so we subtract 1 ms so it does not bleed into Wed on the grid).
 * Per-calendar fetch failures are swallowed with a warn log.
 */
export async function listEventsInWindow(
  fromMs: number,
  toMs: number,
): Promise<GcalCalendarItem[]> {
  const client = getCalClient();
  if (!client) return [];

  const calendars = await listOwnerCalendars();
  if (calendars.length === 0) return [];

  const timeMin = new Date(fromMs).toISOString();
  const timeMax = new Date(toMs).toISOString();

  const perCalendar = await Promise.allSettled(
    calendars.map(async (cal) => {
      const events: GcalCalendarItem[] = [];
      let pageToken: string | undefined;

      do {
        const res = await client.events.list({
          calendarId: cal.id,
          timeMin,
          timeMax,
          singleEvents: true, // expand recurring — GCAL-02
          showDeleted: false,
          orderBy: 'startTime',
          maxResults: 250,
          pageToken,
        });

        for (const ev of res.data.items ?? []) {
          if (!ev.id || !ev.start) continue;
          const isAllDay = !!ev.start.date && !ev.start.dateTime;

          let startMs: number;
          let endMs: number | null = null;

          if (isAllDay) {
            // start.date and end.date are YYYY-MM-DD in the calendar's TZ.
            // Parse as midnight local-to-bot (Asia/Jerusalem) so it lines up
            // on the IST grid — matches the convention used elsewhere.
            startMs = new Date(`${ev.start.date}T00:00:00+03:00`).getTime();
            if (ev.end?.date) {
              // Google's all-day end is EXCLUSIVE — e.g. Tue→Wed for a single Tue event.
              // Subtract 1 ms to make it inclusive so the pill renders on Tue only.
              const endExclusiveMs = new Date(
                `${ev.end.date}T00:00:00+03:00`,
              ).getTime();
              endMs = endExclusiveMs - 1;
            }
          } else {
            startMs = new Date(ev.start.dateTime!).getTime();
            endMs = ev.end?.dateTime
              ? new Date(ev.end.dateTime).getTime()
              : null;
          }

          // Window clip (Google sometimes returns events whose start is slightly outside
          // the window when the full recurring span crosses it).
          if (startMs > toMs || (endMs !== null && endMs < fromMs)) continue;

          events.push({
            id: ev.id,
            calendarId: cal.id,
            calendarName: cal.name,
            colorId: ev.colorId ?? cal.colorId ?? null,
            title: ev.summary ?? '(No title)',
            startMs,
            endMs,
            isAllDay,
            htmlLink: ev.htmlLink ?? null,
            etag: ev.etag ?? null,
          });
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      return events;
    }),
  );

  const out: GcalCalendarItem[] = [];
  perCalendar.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      out.push(...r.value);
    } else {
      logger.warn(
        { err: r.reason, calendarId: calendars[idx]?.id },
        'gcal per-calendar fetch failed; continuing with other calendars',
      );
    }
  });
  return out;
}
