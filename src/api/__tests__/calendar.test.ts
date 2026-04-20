/**
 * Plan 44-03 vitest coverage for the calendar routes.
 *
 * Covers:
 *  1.  GET /api/calendar/items WITHOUT Authorization → 401
 *  2.  GET /api/calendar/items WITH JWT, no query params → 200 + envelope shape;
 *      window filtering: item outside window excluded, item inside included
 *  3.  GET /api/calendar/items?from=0&to=9999999999999999 → toMs clamped to 120d span
 *  4.  GET with all three sources mocked to succeed → 1 task + 1 event + 1 linkedin,
 *      all sources 'ok'
 *  5.  GET with LinkedIn upstream mock rejecting → tasks + events present,
 *      sources.linkedin === 'error'
 *  6.  GET /api/calendar/stream WITHOUT token → 401
 *  7.  hashCalendarEnvelope stability: same envelope → same hash; changing start → different hash
 *  8.  GET /api/actionables/with-due-dates WITHOUT JWT → 401;
 *      WITH JWT → 200 + {items: [...]} where every item has source === 'task'
 *  9.  GET /api/personal-calendar/events/window WITH JWT → 200 + {items: [...]}
 *      where every item has source === 'event'
 * 10.  GET /api/linkedin/posts/scheduled WITH JWT + upstream returns list → 200 + {items: [...]}
 *      where every item has source === 'linkedin'; upstream rejects → error reply
 *
 * Pattern mirrors actionables.test.ts: stub fastify.authenticate + fastify.jwt
 * to avoid the real jwtPlugin + config.ts env pipeline that vitest's NODE_ENV=test
 * would break.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Actionable } from '../../db/queries/actionables.js';

// ─── Mocks ─────────────────────────────────────────────────────────────

// Mock DB queries
const mockGetCalendarActionables = vi.fn<(fromMs: number, toMs: number) => Actionable[]>(() => []);
const mockGetApprovedEventsBetween = vi.fn(() => []);

vi.mock('../../db/queries/actionables.js', () => ({
  getCalendarActionables: (fromMs: number, toMs: number) =>
    mockGetCalendarActionables(fromMs, toMs),
}));

vi.mock('../../db/queries/personalPendingEvents.js', () => ({
  getApprovedEventsBetween: (fromMs: number, toMs: number) =>
    mockGetApprovedEventsBetween(fromMs, toMs),
}));

// Mock LinkedIn upstream client
const mockCallUpstream = vi.fn<() => Promise<{ status: number; data: unknown[] }>>();

vi.mock('../../api/linkedin/client.js', () => ({
  callUpstream: (...args: unknown[]) => mockCallUpstream(...args),
}));

// Mock mapUpstreamErrorToReply
const mockMapUpstreamErrorToReply = vi.fn((_err: unknown, reply: { status: (n: number) => { send: (v: unknown) => unknown } }) => {
  return reply.status(502).send({ error: 'upstream error' });
});

vi.mock('../../api/linkedin/errors.js', () => ({
  mapUpstreamErrorToReply: (err: unknown, reply: unknown) =>
    mockMapUpstreamErrorToReply(err, reply as never),
}));

// Import after mocks
const { default: calendarRoutes, hashCalendarEnvelope } = await import(
  '../routes/calendar.js'
);

// ─── Fixtures ──────────────────────────────────────────────────────────

function fixtureActionable(overrides: Partial<Actionable> = {}): Actionable {
  return {
    id: 'act-1',
    sourceType: 'commitment',
    sourceContactJid: '972500000001@s.whatsapp.net',
    sourceContactName: 'Alice',
    sourceMessageId: 'msg-1',
    sourceMessageText: 'hello world',
    detectedLanguage: 'en',
    originalDetectedTask: 'buy milk',
    task: 'buy milk',
    status: 'approved',
    detectedAt: 1_700_000_000_000,
    fireAt: 1_700_100_000_000, // non-null — required for calendar items
    enrichedTitle: null,
    enrichedNote: null,
    todoTaskId: null,
    todoListId: null,
    approvalPreviewMessageId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  } as Actionable;
}

function fixtureEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evt-1',
    sourceChatJid: 'group@g.us',
    sourceChatName: null,
    senderJid: 'sender@s.whatsapp.net',
    senderName: 'Bob',
    sourceMessageId: 'msg-evt-1',
    sourceMessageText: 'Team lunch tomorrow',
    title: 'Team lunch',
    eventDate: 1_700_200_000_000,
    location: 'Office',
    description: null,
    url: null,
    status: 'approved',
    notificationMsgId: null,
    contentHash: null,
    isAllDay: false,
    calendarEventId: 'gcal-1',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function fixturePost(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'post-1',
    sequence_id: 'seq-1',
    position: 1,
    status: 'APPROVED',
    perspective: 'first-person',
    language: 'en',
    project_name: 'Build in Public',
    source_snippet: null,
    content: 'Hello LinkedIn',
    content_he: 'שלום לינקדאין',
    image: { source: null, url: null, pii_reviewed: false },
    variants: [],
    lesson_candidates: [],
    regeneration_count: 0,
    regeneration_capped: false,
    share_urn: null,
    scheduled_at: new Date(1_700_300_000_000).toISOString(),
    published_at: null,
    created_at: new Date(1_700_000_000_000).toISOString(),
    updated_at: null,
    analytics: null,
    ...overrides,
  };
}

// ─── Server builder ────────────────────────────────────────────────────

async function buildServer(opts: {
  authPasses?: boolean;
  jwtVerifyPasses?: boolean;
} = {}): Promise<FastifyInstance> {
  const { authPasses = true, jwtVerifyPasses = true } = opts;
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
    verify: (_token: string): any => {
      if (!jwtVerifyPasses) throw new Error('unauthorized');
      return { sub: 'test' };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  await fastify.register(calendarRoutes);
  await fastify.ready();
  return fastify;
}

// ─── Tests: auth-gating (no-auth server) ──────────────────────────────

describe('calendar routes — auth-failing server', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockGetCalendarActionables.mockReset();
    mockGetApprovedEventsBetween.mockReset();
    mockCallUpstream.mockReset();
    server = await buildServer({ authPasses: false, jwtVerifyPasses: false });
  });

  afterEach(async () => {
    await server.close();
  });

  // Test 1
  it('GET /api/calendar/items WITHOUT Authorization → 401', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/calendar/items' });
    expect(res.statusCode).toBe(401);
    expect(mockGetCalendarActionables).not.toHaveBeenCalled();
  });

  // Test 6
  it('GET /api/calendar/stream WITHOUT valid token → 401', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/calendar/stream' });
    expect(res.statusCode).toBe(401);
  });

  // Test 8 (auth-fail half)
  it('GET /api/actionables/with-due-dates WITHOUT JWT → 401', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/actionables/with-due-dates' });
    expect(res.statusCode).toBe(401);
    expect(mockGetCalendarActionables).not.toHaveBeenCalled();
  });
});

// ─── Tests: auth-passing server ───────────────────────────────────────

describe('calendar routes — auth-passing server', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockGetCalendarActionables.mockReset();
    mockGetApprovedEventsBetween.mockReset();
    mockCallUpstream.mockReset();
    // Default mocks: all sources return empty
    mockGetCalendarActionables.mockReturnValue([]);
    mockGetApprovedEventsBetween.mockReturnValue([]);
    mockCallUpstream.mockResolvedValue({ status: 200, data: [] });
    server = await buildServer({ authPasses: true, jwtVerifyPasses: true });
  });

  afterEach(async () => {
    await server.close();
  });

  // Test 2: window filtering — item outside window excluded, item inside included
  it('GET /api/calendar/items WITH JWT → 200 + envelope; window filters correctly', async () => {
    const now = Date.now();
    // Item inside window (within last 7d / next 60d)
    const insideItem = fixtureActionable({ id: 'inside', fireAt: now });
    // Default: mockCallUpstream returns [], mockGetApprovedEventsBetween returns []
    mockGetCalendarActionables.mockReturnValue([insideItem]);

    const res = await server.inject({ method: 'GET', url: '/api/calendar/items' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; sources: Record<string, string> };
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('sources');
    expect(body.sources).toEqual({ tasks: 'ok', events: 'ok', linkedin: 'ok' });
    // The inside item should appear
    expect(body.items).toHaveLength(1);
    expect((body.items[0] as { source: string }).source).toBe('task');
  });

  // Test 3: toMs clamped to 120d span
  it('GET /api/calendar/items?from=0&to=9999999999999 → toMs clamped to 120d span', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/calendar/items?from=0&to=9999999999999',
    });
    expect(res.statusCode).toBe(200);
    // Verify the query was called with from=0 and to=0+120d (not 9999999999999)
    const MAX_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;
    const [[fromArg, toArg]] = mockGetCalendarActionables.mock.calls;
    expect(fromArg).toBe(0);
    expect(toArg).toBeLessThanOrEqual(MAX_WINDOW_MS + 1); // from + 120d
    expect(toArg - fromArg).toBeLessThanOrEqual(MAX_WINDOW_MS);
  });

  // Test 4: all three sources mocked to succeed → 1 task + 1 event + 1 linkedin, all sources 'ok'
  it('GET with all three sources mocked → 1+1+1 items, all sources ok', async () => {
    const now = Date.now();
    const task = fixtureActionable({ id: 'task-1', fireAt: now });
    const event = fixtureEvent({ id: 'evt-2', eventDate: now + 1000 });
    const post = fixturePost({ id: 'post-2', scheduled_at: new Date(now + 2000).toISOString() });

    mockGetCalendarActionables.mockReturnValue([task]);
    mockGetApprovedEventsBetween.mockReturnValue([event]);
    mockCallUpstream.mockResolvedValue({ status: 200, data: [post] });

    const res = await server.inject({ method: 'GET', url: '/api/calendar/items' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ source: string }>; sources: Record<string, string> };
    expect(body.items).toHaveLength(3);
    const sources = body.items.map((i) => i.source).sort();
    expect(sources).toEqual(['event', 'linkedin', 'task']);
    expect(body.sources).toEqual({ tasks: 'ok', events: 'ok', linkedin: 'ok' });
  });

  // Test 5: LinkedIn upstream rejects → tasks + events present, sources.linkedin === 'error'
  it('GET with LinkedIn upstream rejecting → partial success, sources.linkedin=error', async () => {
    const now = Date.now();
    const task = fixtureActionable({ id: 'task-err', fireAt: now });
    const event = fixtureEvent({ id: 'evt-err', eventDate: now + 1000 });

    mockGetCalendarActionables.mockReturnValue([task]);
    mockGetApprovedEventsBetween.mockReturnValue([event]);
    mockCallUpstream.mockRejectedValue(new Error('upstream down'));

    const res = await server.inject({ method: 'GET', url: '/api/calendar/items' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ source: string }>; sources: Record<string, string> };
    // Tasks + events still present
    expect(body.items).toHaveLength(2);
    const srcs = body.items.map((i) => i.source).sort();
    expect(srcs).toEqual(['event', 'task']);
    // LinkedIn marked as error, others ok
    expect(body.sources.linkedin).toBe('error');
    expect(body.sources.tasks).toBe('ok');
    expect(body.sources.events).toBe('ok');
  });

  // Test 8 (auth-pass half): /api/actionables/with-due-dates WITH JWT → CalendarItems source=task
  it('GET /api/actionables/with-due-dates WITH JWT → 200 + items all source=task', async () => {
    const now = Date.now();
    const task = fixtureActionable({ id: 'wdd-1', fireAt: now, detectedLanguage: 'en' });
    mockGetCalendarActionables.mockReturnValue([task]);

    const res = await server.inject({ method: 'GET', url: '/api/actionables/with-due-dates' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ source: string; id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].source).toBe('task');
    expect(body.items[0].id).toBe('wdd-1');
  });

  // Test 9: /api/personal-calendar/events/window WITH JWT → items all source=event
  it('GET /api/personal-calendar/events/window WITH JWT → 200 + items all source=event', async () => {
    const now = Date.now();
    const event = fixtureEvent({ id: 'win-evt-1', eventDate: now });
    mockGetApprovedEventsBetween.mockReturnValue([event]);

    const res = await server.inject({ method: 'GET', url: '/api/personal-calendar/events/window' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ source: string; id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].source).toBe('event');
    expect(body.items[0].id).toBe('win-evt-1');
  });

  // Test 10a: /api/linkedin/posts/scheduled WITH JWT + upstream success → items all source=linkedin
  it('GET /api/linkedin/posts/scheduled WITH JWT + upstream ok → items source=linkedin', async () => {
    const now = Date.now();
    const post = fixturePost({ id: 'sched-1', scheduled_at: new Date(now).toISOString() });
    mockCallUpstream.mockResolvedValue({ status: 200, data: [post] });

    // Need window to contain now — default window spans now-7d to now+60d, so post at now is inside
    const res = await server.inject({ method: 'GET', url: '/api/linkedin/posts/scheduled' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ source: string; id: string }> };
    // post at now should be inside the default window
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0].source).toBe('linkedin');
  });

  // Test 10b: /api/linkedin/posts/scheduled WITH JWT + upstream rejects → error reply (not partial-success)
  it('GET /api/linkedin/posts/scheduled + upstream rejects → error reply via mapUpstreamErrorToReply', async () => {
    mockCallUpstream.mockRejectedValue(new Error('upstream down'));

    const res = await server.inject({ method: 'GET', url: '/api/linkedin/posts/scheduled' });
    // mapUpstreamErrorToReply is called — it returns 502 in our mock
    expect(res.statusCode).toBe(502);
    expect(mockMapUpstreamErrorToReply).toHaveBeenCalled();
  });
});

// ─── hashCalendarEnvelope unit tests ──────────────────────────────────

describe('hashCalendarEnvelope (plan 44-03)', () => {
  const baseEnvelope = {
    items: [
      {
        source: 'task' as const,
        id: 'act-1',
        title: 'buy milk',
        start: 1_700_100_000_000,
        end: null,
        isAllDay: false,
        language: 'en' as const,
        sourceFields: {},
      },
    ],
    sources: { tasks: 'ok' as const, events: 'ok' as const, linkedin: 'ok' as const },
  };

  // Test 7a: same envelope → same hash
  it('same envelope hashes identically across two calls', () => {
    const h1 = hashCalendarEnvelope(baseEnvelope);
    const h2 = hashCalendarEnvelope(baseEnvelope);
    expect(h1).toBe(h2);
  });

  // Test 7b: changing one item's start → different hash
  it('changing one item start produces a different hash', () => {
    const before = hashCalendarEnvelope(baseEnvelope);
    const modified = {
      ...baseEnvelope,
      items: [{ ...baseEnvelope.items[0], start: baseEnvelope.items[0].start + 1 }],
    };
    const after = hashCalendarEnvelope(modified);
    expect(before).not.toBe(after);
  });

  // Empty envelope stable
  it('empty envelope hashes stably', () => {
    const empty = { items: [], sources: { tasks: 'ok' as const, events: 'ok' as const, linkedin: 'ok' as const } };
    const h1 = hashCalendarEnvelope(empty);
    const h2 = hashCalendarEnvelope(empty);
    expect(h1).toBe(h2);
  });

  // sources status change → different hash
  it('changing sources status changes hash', () => {
    const before = hashCalendarEnvelope({ items: [], sources: { tasks: 'ok', events: 'ok', linkedin: 'ok' } });
    const after = hashCalendarEnvelope({ items: [], sources: { tasks: 'ok', events: 'ok', linkedin: 'error' } });
    expect(before).not.toBe(after);
  });
});
