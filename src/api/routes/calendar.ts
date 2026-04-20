/**
 * Unified calendar read + SSE surface (Phase 44 Plan 03).
 *
 * Registers FIVE routes:
 *
 *   GET /api/calendar/items?from=<ms>&to=<ms>
 *     Returns a unified CalendarEnvelope over tasks + events + LinkedIn posts
 *     within the date window. Used by the SSE poller and any non-hot code path.
 *     Auth: Authorization: Bearer <jwt> (via fastify.authenticate).
 *
 *   GET /api/calendar/stream?token=<jwt>
 *     SSE channel emitting `event: calendar.updated` with the full unified
 *     payload whenever any source's content changes, polling at 3s.
 *     Auth: ?token= query string (EventSource can't set headers).
 *
 *   GET /api/actionables/with-due-dates?from=<ms>&to=<ms>
 *     Per-source initial-load endpoint for tasks only.
 *     Returns { items: CalendarItem[] } where every item has source='task'.
 *
 *   GET /api/personal-calendar/events/window?from=<ms>&to=<ms>
 *     Per-source initial-load endpoint for personal events only.
 *     Returns { items: CalendarItem[] } where every item has source='event'.
 *     NOTE: registered as /window sub-path because the base
 *     /api/personal-calendar/events path is already occupied by the existing
 *     status-filtered list endpoint (personalCalendar.ts route 6).
 *
 *   GET /api/linkedin/posts/scheduled?from=<ms>&to=<ms>
 *     Per-source initial-load endpoint for LinkedIn posts only.
 *     Returns { items: CalendarItem[] } where every item has source='linkedin'.
 *
 * Window defaults + clamping (shared helper, same for all five routes):
 *   from  → now - 7 days (if missing or non-finite)
 *   to    → now + 60 days (if missing or non-finite)
 *   max span → 120 days (to is clamped to from + 120d if wider)
 *
 * Partial failure (unified route + SSE only): Promise.allSettled means if one
 * source errors, the others still appear. sources.<x> is set to 'error' and
 * the client shows a per-source banner. The per-source GETs surface errors
 * directly to the caller.
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import {
  getCalendarActionables,
  type Actionable,
} from '../../db/queries/actionables.js';
import { getApprovedEventsBetween } from '../../db/queries/personalPendingEvents.js';
import { callUpstream } from '../linkedin/client.js';
import { mapUpstreamErrorToReply } from '../linkedin/errors.js';
import { PostSchema } from '../linkedin/schemas.js';
import { z } from 'zod';
import { fetchGcalCalendarItems } from './googleCalendar.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_FROM_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TO_OFFSET_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarSource = 'task' | 'event' | 'linkedin' | 'gtasks' | 'gcal';
export type CalendarItem = {
  source: CalendarSource;
  id: string;
  title: string;
  start: number;         // unix ms
  end: number | null;   // unix ms, null for point-in-time
  isAllDay: boolean;
  language: 'he' | 'en' | 'mixed';
  sourceFields: Record<string, unknown>; // source-specific payload for the client
};
export type SourceStatus = 'ok' | 'error';
export type CalendarEnvelope = {
  items: CalendarItem[];
  sources: {
    tasks: SourceStatus;
    events: SourceStatus;
    linkedin: SourceStatus;
    gcal: SourceStatus; // NEW — GCAL-03
  };
};

// ─── Window parser (shared across all five routes) ───────────────────────────

function parseWindow(q: { from?: string; to?: string }): { fromMs: number; toMs: number } {
  const now = Date.now();
  let fromMs = parseInt(q.from ?? '', 10);
  let toMs = parseInt(q.to ?? '', 10);
  if (!Number.isFinite(fromMs)) fromMs = now - DEFAULT_FROM_OFFSET_MS;
  if (!Number.isFinite(toMs)) toMs = now + DEFAULT_TO_OFFSET_MS;
  if (toMs - fromMs > MAX_WINDOW_MS) toMs = fromMs + MAX_WINDOW_MS;
  return { fromMs, toMs };
}

// ─── Per-source projection helpers ───────────────────────────────────────────

function projectTasks(rows: Actionable[]): CalendarItem[] {
  return rows.map((a) => ({
    source: 'task' as const,
    id: a.id,
    title: a.enrichedTitle ?? a.task,
    start: a.fireAt!, // getCalendarActionables already filters NOT NULL
    end: null,
    isAllDay: false,
    language: a.detectedLanguage as 'he' | 'en',
    sourceFields: {
      status: a.status,
      todoTaskId: a.todoTaskId,
      enrichedNote: a.enrichedNote,
      sourceContactName: a.sourceContactName,
    },
  }));
}

type PersonalEvent = ReturnType<typeof getApprovedEventsBetween>[number];

function projectEvents(rows: PersonalEvent[]): CalendarItem[] {
  return rows.map((e) => ({
    source: 'event' as const,
    id: e.id,
    title: e.title,
    start: e.eventDate,
    end: e.isAllDay ? null : e.eventDate + 60 * 60 * 1000, // default 1h span
    isAllDay: !!e.isAllDay,
    language: /[\u0590-\u05FF]/.test(e.title) ? ('he' as const) : ('en' as const),
    sourceFields: {
      location: e.location,
      description: e.description,
      calendarEventId: e.calendarEventId ?? null,
    },
  }));
}

import type { Post } from '../linkedin/schemas.js';

function projectLinkedin(posts: Post[], fromMs: number, toMs: number): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const p of posts) {
    if (!p.scheduled_at) continue;
    const scheduledMs = new Date(p.scheduled_at).getTime();
    if (scheduledMs < fromMs || scheduledMs > toMs) continue;
    items.push({
      source: 'linkedin' as const,
      id: p.id,
      title: p.content_he ?? p.content,
      start: scheduledMs,
      end: null,
      isAllDay: false,
      language: p.content_he ? 'he' : 'en',
      sourceFields: {
        status: p.status,
        content: p.content,
        content_he: p.content_he ?? null,
        image_urn: p.image?.url ?? null,
      },
    });
  }
  return items;
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

async function fetchCalendarWindow(fromMs: number, toMs: number): Promise<CalendarEnvelope> {
  const [tasksRes, eventsRes, linkedinRes, gcalRes] = await Promise.allSettled([
    Promise.resolve().then(() => getCalendarActionables(fromMs, toMs)),
    Promise.resolve().then(() => getApprovedEventsBetween(fromMs, toMs)),
    callUpstream({
      method: 'GET',
      path: `/v1/posts?status=APPROVED`,
      timeoutMs: 5_000,
      responseSchema: z.array(PostSchema),
    }).then(({ data }) => data),
    fetchGcalCalendarItems(fromMs, toMs),
  ]);

  const items: CalendarItem[] = [];
  const sources: CalendarEnvelope['sources'] = {
    tasks: 'ok',
    events: 'ok',
    linkedin: 'ok',
    gcal: 'ok',
  };

  if (tasksRes.status === 'fulfilled') {
    items.push(...projectTasks(tasksRes.value));
  } else {
    sources.tasks = 'error';
  }

  if (eventsRes.status === 'fulfilled') {
    items.push(...projectEvents(eventsRes.value));
  } else {
    sources.events = 'error';
  }

  if (linkedinRes.status === 'fulfilled') {
    items.push(...projectLinkedin(linkedinRes.value, fromMs, toMs));
  } else {
    sources.linkedin = 'error';
  }

  if (gcalRes.status === 'fulfilled') {
    items.push(...gcalRes.value);
  } else {
    sources.gcal = 'error';
  }

  // Sort by start asc so the client can binary-search into the day grid.
  items.sort((a, b) => a.start - b.start);

  return { items, sources };
}

/**
 * Stable content hash over a CalendarEnvelope. Exported so the vitest suite
 * can assert stability + change-detection without spinning up a real SSE
 * connection.
 */
export function hashCalendarEnvelope(env: CalendarEnvelope): string {
  const compact = env.items.map((i) => [
    i.source,
    i.id,
    i.title,
    i.start,
    i.end,
    i.isAllDay ? 1 : 0,
  ]);
  const statusBits = `${env.sources.tasks}:${env.sources.events}:${env.sources.linkedin}:${env.sources.gcal}`;
  return createHash('sha1').update(JSON.stringify([compact, statusBits])).digest('hex');
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default async function calendarRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── GET /api/calendar/items — unified REST endpoint ─────────────────
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/calendar/items',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { fromMs, toMs } = parseWindow(request.query);
      return fetchCalendarWindow(fromMs, toMs);
    },
  );

  // ─── GET /api/actionables/with-due-dates — per-source tasks ──────────
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/actionables/with-due-dates',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { fromMs, toMs } = parseWindow(request.query);
      const rows = getCalendarActionables(fromMs, toMs);
      return { items: projectTasks(rows) };
    },
  );

  // ─── GET /api/personal-calendar/events/window — per-source events ────
  // NOTE: registered as /window sub-path because the base
  // /api/personal-calendar/events is already occupied by the status-filtered
  // list route in personalCalendar.ts. Path documented in 44-03-SUMMARY.md.
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/personal-calendar/events/window',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { fromMs, toMs } = parseWindow(request.query);
      const rows = getApprovedEventsBetween(fromMs, toMs);
      return { items: projectEvents(rows) };
    },
  );

  // ─── GET /api/linkedin/posts/scheduled — per-source LinkedIn posts ───
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/linkedin/posts/scheduled',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { fromMs, toMs } = parseWindow(request.query);
      try {
        const { data } = await callUpstream({
          method: 'GET',
          path: `/v1/posts?status=APPROVED`,
          timeoutMs: 5_000,
          responseSchema: z.array(PostSchema),
        });
        return { items: projectLinkedin(data, fromMs, toMs) };
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── GET /api/calendar/stream — SSE ──────────────────────────────────
  fastify.get('/api/calendar/stream', async (request, reply) => {
    // JWT gate — EventSource can't send headers, so we verify the
    // ?token=<jwt> query string manually (same pattern as /api/actionables/stream).
    const { token } = request.query as { token?: string };
    try {
      fastify.jwt.verify(token ?? '');
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    let lastHash: string | null = null;
    let closed = false;
    const now0 = Date.now();
    // Stream window is same as REST default — 67-day span around now.
    const fromMs = now0 - DEFAULT_FROM_OFFSET_MS;
    const toMs = now0 + DEFAULT_TO_OFFSET_MS;

    const write = (frame: string): void => {
      if (closed) return;
      try {
        reply.raw.write(frame);
      } catch {
        closed = true;
      }
    };

    const pollOnce = async (): Promise<void> => {
      if (closed) return;
      try {
        const env = await fetchCalendarWindow(fromMs, toMs);
        const h = hashCalendarEnvelope(env);
        if (h !== lastHash) {
          lastHash = h;
          write(`event: calendar.updated\ndata: ${JSON.stringify(env)}\n\n`);
        }
      } catch (err) {
        fastify.log.warn({ err }, '[calendar-stream] poll failed; will retry');
      }
    };

    await pollOnce();
    const poll = setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);
    const hb = setInterval(() => {
      write(': ping\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    request.raw.on('close', () => {
      closed = true;
      clearInterval(poll);
      clearInterval(hb);
    });
  });
}
