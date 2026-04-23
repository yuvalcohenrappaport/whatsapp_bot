/**
 * Phase 47 Plan 01 — vitest coverage for /api/google-calendar/* routes.
 *
 * Covers 10 cases:
 *  1.  GET /api/google-calendar/calendars WITHOUT JWT → 401
 *  2.  GET /api/google-calendar/calendars WITH JWT → 200 + filtered owner/writer
 *  3.  GET /api/google-calendar/calendars — 503 when listOwnerCalendars throws
 *  4.  GET /api/google-calendar/events WITHOUT JWT → 401
 *  5.  GET /api/google-calendar/events WITH JWT → 200 + items source=gcal
 *  6.  GET /api/google-calendar/events — dedup drops linked event ids
 *  7.  GET /api/google-calendar/events — all-day event: isAllDay=true, end preserved
 *  8.  GET /api/google-calendar/events — Hebrew title → language='he'
 *  9.  GET /api/google-calendar/events — sourceFields carries gcal metadata + readOnly=true
 *  10. GET /api/google-calendar/events — graceful error on listEventsInWindow throw
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ─── Mock src/config.js to avoid the Zod env pipeline under NODE_ENV=test ──
vi.mock('../../config.js', () => ({
  config: {
    NODE_ENV: 'development',
    LOG_LEVEL: 'silent',
  },
}));

// ─── Mocks for gcalService + dedup query ──────────────────────────────────
type GcalCalendarItem = {
  id: string;
  calendarId: string;
  calendarName: string;
  colorId: string | null;
  title: string;
  startMs: number;
  endMs: number | null;
  isAllDay: boolean;
  htmlLink: string | null;
  etag: string | null;
};

type GcalCalendarMeta = {
  id: string;
  name: string;
  accessRole: string;
  colorId: string | null;
  primary: boolean;
  color: string;
};

const mockListOwnerCalendars = vi.fn<() => Promise<GcalCalendarMeta[]>>(async () => []);
const mockListEventsInWindow = vi.fn<
  (fromMs: number, toMs: number) => Promise<GcalCalendarItem[]>
>(async () => []);

vi.mock('../../calendar/gcalService.js', () => ({
  listOwnerCalendars: () => mockListOwnerCalendars(),
  listEventsInWindow: (fromMs: number, toMs: number) =>
    mockListEventsInWindow(fromMs, toMs),
  hashCalendarColor: (calendarId: string) => {
    // djb2 deterministic — duplicate of prod impl so tests assert on the real derived value
    let h = 5381;
    for (let i = 0; i < calendarId.length; i++) {
      h = ((h << 5) + h) ^ calendarId.charCodeAt(i);
    }
    const palette = [
      'bg-emerald-500',
      'bg-sky-500',
      'bg-violet-500',
      'bg-amber-500',
      'bg-rose-500',
      'bg-teal-500',
      'bg-orange-500',
      'bg-fuchsia-500',
    ];
    return palette[Math.abs(h) % palette.length];
  },
}));

const mockGetLinkedCalendarEventIds = vi.fn<(fromMs: number, toMs: number) => Set<string>>(
  () => new Set<string>(),
);

vi.mock('../../db/queries/personalPendingEvents.js', () => ({
  getLinkedCalendarEventIds: (fromMs: number, toMs: number) =>
    mockGetLinkedCalendarEventIds(fromMs, toMs),
}));

// Import AFTER mocks
const { default: googleCalendarRoutes } = await import(
  '../routes/googleCalendar.js'
);

// ─── Fixtures ─────────────────────────────────────────────────────────────

function fixtureCalendarMeta(overrides: Partial<GcalCalendarMeta> = {}): GcalCalendarMeta {
  return {
    id: 'primary@group.calendar.google.com',
    name: 'Primary',
    accessRole: 'owner',
    colorId: '7',
    primary: true,
    color: 'bg-sky-500',
    ...overrides,
  };
}

function fixtureGcalEvent(overrides: Partial<GcalCalendarItem> = {}): GcalCalendarItem {
  return {
    id: 'ev-1',
    calendarId: 'primary@group.calendar.google.com',
    calendarName: 'Primary',
    colorId: '11',
    title: 'Coffee with Bob',
    startMs: 1_800_000_000_000,
    endMs: 1_800_003_600_000,
    isAllDay: false,
    htmlLink: 'https://www.google.com/calendar/event?eid=abc',
    etag: 'W/"etag-1"',
    ...overrides,
  };
}

// ─── Server builder ───────────────────────────────────────────────────────

async function buildServer(opts: { authPasses?: boolean } = {}): Promise<FastifyInstance> {
  const { authPasses = true } = opts;
  const fastify = Fastify({ logger: false });
  fastify.decorate(
    'authenticate',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: any, reply: any) => {
      if (!authPasses) {
        await reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  );
  fastify.decorate('jwt', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    verify: (_token: string): any => ({ sub: 'test' }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  await fastify.register(googleCalendarRoutes);
  await fastify.ready();
  return fastify;
}

// ─── Tests: auth-failing server ───────────────────────────────────────────

describe('googleCalendar routes — auth-failing server', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockListOwnerCalendars.mockReset();
    mockListEventsInWindow.mockReset();
    mockGetLinkedCalendarEventIds.mockReset();
    mockListOwnerCalendars.mockResolvedValue([]);
    mockListEventsInWindow.mockResolvedValue([]);
    mockGetLinkedCalendarEventIds.mockReturnValue(new Set<string>());
    server = await buildServer({ authPasses: false });
  });

  afterEach(async () => {
    await server.close();
  });

  // 1
  it('GET /api/google-calendar/calendars WITHOUT JWT → 401', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/calendars',
    });
    expect(res.statusCode).toBe(401);
    expect(mockListOwnerCalendars).not.toHaveBeenCalled();
  });

  // 4
  it('GET /api/google-calendar/events WITHOUT JWT → 401', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/events',
    });
    expect(res.statusCode).toBe(401);
    expect(mockListEventsInWindow).not.toHaveBeenCalled();
  });
});

// ─── Tests: auth-passing server ───────────────────────────────────────────

describe('googleCalendar routes — auth-passing server', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockListOwnerCalendars.mockReset();
    mockListEventsInWindow.mockReset();
    mockGetLinkedCalendarEventIds.mockReset();
    mockListOwnerCalendars.mockResolvedValue([]);
    mockListEventsInWindow.mockResolvedValue([]);
    mockGetLinkedCalendarEventIds.mockReturnValue(new Set<string>());
    server = await buildServer({ authPasses: true });
  });

  afterEach(async () => {
    await server.close();
  });

  // 2
  it('GET /api/google-calendar/calendars WITH JWT → 200 + { calendars: [...] }', async () => {
    const primary = fixtureCalendarMeta({ id: 'a@x', name: 'Primary', accessRole: 'owner' });
    const writer = fixtureCalendarMeta({ id: 'b@x', name: 'Shared', accessRole: 'writer', primary: false });
    mockListOwnerCalendars.mockResolvedValue([primary, writer]);

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/calendars',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { calendars: GcalCalendarMeta[] };
    expect(body).toHaveProperty('calendars');
    expect(body.calendars).toHaveLength(2);
    expect(body.calendars.map((c) => c.accessRole).sort()).toEqual(['owner', 'writer']);
  });

  // 3
  it('GET /api/google-calendar/calendars — 503 + { error: gcal_unavailable } when listOwnerCalendars throws', async () => {
    mockListOwnerCalendars.mockRejectedValue(new Error('boom'));

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/calendars',
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: string };
    expect(body.error).toBe('gcal_unavailable');
  });

  // 5
  it('GET /api/google-calendar/events WITH JWT → items mapped with source=gcal', async () => {
    const ev = fixtureGcalEvent({ id: 'ev-5', title: 'Lunch' });
    mockListEventsInWindow.mockResolvedValue([ev]);

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/events',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ source: string; id: string; title: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].source).toBe('gcal');
    expect(body.items[0].id).toBe('ev-5');
    expect(body.items[0].title).toBe('Lunch');
  });

  // 6
  it('GET /api/google-calendar/events — dedup drops events whose id is in getLinkedCalendarEventIds', async () => {
    const dup = fixtureGcalEvent({ id: 'ev-dup-1', title: 'Linked to local row' });
    const ok = fixtureGcalEvent({ id: 'ev-ok-2', title: 'Normal' });
    mockListEventsInWindow.mockResolvedValue([dup, ok]);
    mockGetLinkedCalendarEventIds.mockReturnValue(new Set(['ev-dup-1']));

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/events',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('ev-ok-2');
  });

  // 7
  it('GET /api/google-calendar/events — all-day event: isAllDay=true, end preserved from service (-1ms already applied)', async () => {
    const startMs = new Date('2026-05-05T00:00:00+03:00').getTime();
    const endExclusive = new Date('2026-05-06T00:00:00+03:00').getTime();
    const inclusiveEndMs = endExclusive - 1;
    const allDay = fixtureGcalEvent({
      id: 'ev-ad-1',
      title: 'Holiday',
      startMs,
      endMs: inclusiveEndMs,
      isAllDay: true,
    });
    mockListEventsInWindow.mockResolvedValue([allDay]);

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/events',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ isAllDay: boolean; start: number; end: number | null }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].isAllDay).toBe(true);
    expect(body.items[0].start).toBe(startMs);
    expect(body.items[0].end).toBe(inclusiveEndMs);
  });

  // 8
  it('GET /api/google-calendar/events — Hebrew title gets language=he', async () => {
    const hebrewTitle = 'פגישה עם רון'; // Meeting with Ron
    const ev = fixtureGcalEvent({ id: 'ev-he', title: hebrewTitle });
    mockListEventsInWindow.mockResolvedValue([ev]);

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/events',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ language: string; title: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].language).toBe('he');
    expect(body.items[0].title).toBe(hebrewTitle);
  });

  // 9
  it('GET /api/google-calendar/events — sourceFields carries calendarId, calendarName, colorId, color, readOnly=true', async () => {
    const ev = fixtureGcalEvent({
      id: 'ev-src',
      calendarId: 'work@x',
      calendarName: 'Work',
      colorId: '9',
      htmlLink: 'https://example/evt',
      etag: 'W/"xyz"',
    });
    mockListEventsInWindow.mockResolvedValue([ev]);

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/events',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ sourceFields: Record<string, unknown> }>;
    };
    const fields = body.items[0].sourceFields;
    expect(fields.calendarId).toBe('work@x');
    expect(fields.calendarName).toBe('Work');
    expect(fields.colorId).toBe('9');
    expect(fields.color).toMatch(/^bg-/);
    expect(fields.sourceColor).toMatch(/^bg-/);
    expect(fields.readOnly).toBe(true);
    expect(fields.htmlLink).toBe('https://example/evt');
  });

  // 10
  it('GET /api/google-calendar/events — graceful: returns { items: [], error: gcal_unavailable } status 200 when listEventsInWindow throws', async () => {
    mockListEventsInWindow.mockRejectedValue(new Error('gcal down'));

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-calendar/events',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; error?: string };
    expect(body.items).toEqual([]);
    expect(body.error).toBe('gcal_unavailable');
  });
});
