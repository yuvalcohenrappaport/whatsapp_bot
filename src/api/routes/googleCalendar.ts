/**
 * Phase 47 Plan 01 — Google Calendar read layer.
 *
 * Two JWT-gated routes exposing the owner's Google Calendars to the dashboard:
 *
 *   GET /api/google-calendar/calendars
 *     Returns every calendar the owner has owner/writer access to, mapped
 *     to { id, name, accessRole, colorId, primary, color } shape.
 *
 *   GET /api/google-calendar/events?from=<ms>&to=<ms>
 *     Returns CalendarItem[] with source='gcal' across all owned/writable
 *     calendars within the window. Recurring events are expanded via
 *     singleEvents: true, all-day events carry isAllDay + inclusive end.
 *     Events whose id matches an approved personal_pending_events.calendar_event_id
 *     are dropped from the payload (GCAL-05 server-side dedup).
 *
 * Also exports fetchGcalCalendarItems() for the unified aggregator (Plan 47-02)
 * to reuse the projection + dedup logic without going through HTTP.
 */
import type { FastifyInstance } from 'fastify';
import type { CalendarItem } from './calendar.js';
import {
  listOwnerCalendars,
  listEventsInWindow,
  hashCalendarColor,
  type GcalCalendarItem,
} from '../../calendar/gcalService.js';
import { getLinkedCalendarEventIds } from '../../db/queries/personalPendingEvents.js';

// ─── Window parser (copied inline from calendar.ts — same shape) ───────────
const DEFAULT_FROM_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TO_OFFSET_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;

function parseWindow(q: {
  from?: string;
  to?: string;
}): { fromMs: number; toMs: number } {
  const now = Date.now();
  let fromMs = parseInt(q.from ?? '', 10);
  let toMs = parseInt(q.to ?? '', 10);
  if (!Number.isFinite(fromMs)) fromMs = now - DEFAULT_FROM_OFFSET_MS;
  if (!Number.isFinite(toMs)) toMs = now + DEFAULT_TO_OFFSET_MS;
  if (toMs - fromMs > MAX_WINDOW_MS) toMs = fromMs + MAX_WINDOW_MS;
  return { fromMs, toMs };
}

// ─── Projection helper (gcal → CalendarItem shape) ─────────────────────────
function projectGcalItem(ev: GcalCalendarItem): CalendarItem {
  return {
    source: 'gcal',
    id: ev.id,
    title: ev.title,
    start: ev.startMs,
    end: ev.endMs,
    isAllDay: ev.isAllDay,
    language: /[֐-׿]/.test(ev.title) ? 'he' : 'en',
    sourceFields: {
      calendarId: ev.calendarId,
      calendarName: ev.calendarName,
      colorId: ev.colorId,
      color: hashCalendarColor(ev.calendarId),
      sourceColor: hashCalendarColor(ev.calendarId),
      htmlLink: ev.htmlLink,
      etag: ev.etag,
      readOnly: true, // GCAL-06 — dashboard MUST respect this flag
    },
  };
}

/**
 * Internal helper for the unified aggregator (Plan 47-02). Same logic as
 * GET /api/google-calendar/events but returns the CalendarItem[] directly
 * (no HTTP, no auth — auth is enforced at the aggregator's own route boundary).
 */
export async function fetchGcalCalendarItems(
  fromMs: number,
  toMs: number,
): Promise<CalendarItem[]> {
  const [events, linkedIds] = await Promise.all([
    listEventsInWindow(fromMs, toMs),
    Promise.resolve().then(() => getLinkedCalendarEventIds(fromMs, toMs)),
  ]);
  // Dedup — GCAL-05
  const kept = events.filter((e) => !linkedIds.has(e.id));
  return kept.map(projectGcalItem);
}

export default async function googleCalendarRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/google-calendar/calendars
  fastify.get(
    '/api/google-calendar/calendars',
    { onRequest: [fastify.authenticate] },
    async (_req, reply) => {
      try {
        const cals = await listOwnerCalendars();
        return { calendars: cals };
      } catch (err) {
        fastify.log.warn({ err }, 'gcal listOwnerCalendars failed');
        return reply.status(503).send({ error: 'gcal_unavailable' });
      }
    },
  );

  // GET /api/google-calendar/events?from=<ms>&to=<ms>
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/google-calendar/events',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { fromMs, toMs } = parseWindow(request.query);
      try {
        const items = await fetchGcalCalendarItems(fromMs, toMs);
        return { items };
      } catch (err) {
        fastify.log.warn({ err }, 'gcal fetchGcalCalendarItems failed');
        // Match the 46-01 pattern: graceful 200 with empty items + error code
        // so the aggregator's partial-failure logic stays uniform across sources.
        return { items: [], error: 'gcal_unavailable' };
      }
    },
  );
}
