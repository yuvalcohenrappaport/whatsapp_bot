/**
 * Phase 46 Plan 01 vitest coverage for the new Google Tasks proxy routes:
 *   GET /api/google-tasks/lists
 *   GET /api/google-tasks/items?from=<ms>&to=<ms>
 *
 * Uses the same fastify.inject() + stubbed-authenticate/jwt pattern as
 * actionablesWriteActions.test.ts (plan 45-02) + actionables.test.ts
 * (plan 43-01) so vitest's NODE_ENV='test' Zod-enum pipeline in config.ts
 * never trips.
 *
 * 10 cases total:
 *   1. /lists — 401 without JWT
 *   2. /lists — 200 + mapped payload (title → name)
 *   3. /lists — 503 when getAllTaskLists throws
 *   4. /items — 401 without JWT
 *   5. /items — 200 + CalendarItem shape
 *   6. /items — dedup: item whose id is in approvedTodoTaskIds dropped
 *   7. /items — todoService layer already filters completed (sim: empty []
 *              returned when caller would have emitted only completed rows)
 *   8. /items — todoService layer already filters out-of-window (sim: empty
 *              [] returned when caller would have emitted only out-of-window)
 *   9. /items — Hebrew title → language='he'
 *  10. /items — gtasks_unavailable graceful 200 + { items: [], error }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ─── Mocks ─────────────────────────────────────────────────────────────

const mockGetAllTaskLists = vi.fn<
  () => Promise<
    Array<{
      id: string;
      title: string;
      etag: string | null;
      updated: string | null;
    }>
  >
>();
const mockGetTaskItemsInWindow = vi.fn<
  (fromMs: number, toMs: number) => Promise<
    Array<{
      id: string;
      listId: string;
      listName: string;
      title: string;
      dueMs: number;
      etag: string | null;
      updated: string | null;
    }>
  >
>();

vi.mock('../../todo/todoService.js', () => ({
  getAllTaskLists: () => mockGetAllTaskLists(),
  getTaskItemsInWindow: (fromMs: number, toMs: number) =>
    mockGetTaskItemsInWindow(fromMs, toMs),
}));

const mockGetApprovedActionableTodoTaskIds = vi.fn<
  (fromMs: number, toMs: number) => Set<string>
>(() => new Set<string>());

vi.mock('../../db/queries/actionables.js', () => ({
  getApprovedActionableTodoTaskIds: (fromMs: number, toMs: number) =>
    mockGetApprovedActionableTodoTaskIds(fromMs, toMs),
}));

vi.mock('../../config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    USER_JID: '972500000001@s.whatsapp.net',
  },
}));

// Routes must be imported AFTER all vi.mock calls.
const { default: googleTasksRoutes } = await import('../routes/googleTasks.js');

// ─── Test server builder ───────────────────────────────────────────────

async function buildTestServer(authPasses = true): Promise<FastifyInstance> {
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
  await fastify.register(googleTasksRoutes);
  await fastify.ready();
  return fastify;
}

// ─── Shared reset ──────────────────────────────────────────────────────

beforeEach(() => {
  mockGetAllTaskLists.mockReset();
  mockGetTaskItemsInWindow.mockReset();
  mockGetApprovedActionableTodoTaskIds.mockReset();
  mockGetApprovedActionableTodoTaskIds.mockReturnValue(new Set<string>());
});

// ══════════════════════════════════════════════════════════════════════
// /lists
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/google-tasks/lists', () => {
  let server: FastifyInstance;
  afterEach(async () => {
    await server.close();
  });

  // 1. 401 without JWT
  it('401 without Authorization', async () => {
    server = await buildTestServer(false);
    const res = await server.inject({
      method: 'GET',
      url: '/api/google-tasks/lists',
    });
    expect(res.statusCode).toBe(401);
    expect(mockGetAllTaskLists).not.toHaveBeenCalled();
  });

  // 2. 200 + mapped payload
  it('200 with JWT → returns mapped { id, name, etag, updated }', async () => {
    server = await buildTestServer(true);
    mockGetAllTaskLists.mockResolvedValueOnce([
      {
        id: 'list-A',
        title: 'My Tasks',
        etag: 'etag-1',
        updated: '2026-04-21T10:00:00.000Z',
      },
      { id: 'list-B', title: 'Groceries', etag: null, updated: null },
    ]);
    const res = await server.inject({
      method: 'GET',
      url: '/api/google-tasks/lists',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      lists: [
        {
          id: 'list-A',
          name: 'My Tasks',
          etag: 'etag-1',
          updated: '2026-04-21T10:00:00.000Z',
        },
        { id: 'list-B', name: 'Groceries', etag: null, updated: null },
      ],
    });
  });

  // 3. 503 when getAllTaskLists throws
  it('503 gtasks_unavailable when upstream throws', async () => {
    server = await buildTestServer(true);
    mockGetAllTaskLists.mockRejectedValueOnce(new Error('boom'));
    const res = await server.inject({
      method: 'GET',
      url: '/api/google-tasks/lists',
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'gtasks_unavailable' });
  });
});

// ══════════════════════════════════════════════════════════════════════
// /items
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/google-tasks/items', () => {
  let server: FastifyInstance;
  afterEach(async () => {
    await server.close();
  });

  // 4. 401 without JWT
  it('401 without Authorization', async () => {
    server = await buildTestServer(false);
    const res = await server.inject({
      method: 'GET',
      url: '/api/google-tasks/items?from=0&to=9999999999999',
    });
    expect(res.statusCode).toBe(401);
    expect(mockGetTaskItemsInWindow).not.toHaveBeenCalled();
  });

  // 5. 200 + CalendarItem shape
  it('200 → projects items to CalendarItem with source=gtasks + sourceFields', async () => {
    server = await buildTestServer(true);
    mockGetTaskItemsInWindow.mockResolvedValueOnce([
      {
        id: 'task-1',
        listId: 'list-A',
        listName: 'My Tasks',
        title: 'Buy milk',
        dueMs: 1_745_000_000_000,
        etag: 'etag-task-1',
        updated: '2026-04-21T10:00:00.000Z',
      },
    ]);

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-tasks/items?from=0&to=9999999999999',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    const [it] = body.items;
    expect(it).toMatchObject({
      source: 'gtasks',
      id: 'task-1',
      title: 'Buy milk',
      start: 1_745_000_000_000,
      end: null,
      isAllDay: false,
      language: 'en',
    });
    const sourceFields = it.sourceFields as Record<string, unknown>;
    expect(sourceFields).toMatchObject({
      listId: 'list-A',
      listName: 'My Tasks',
      etag: 'etag-task-1',
      updated: '2026-04-21T10:00:00.000Z',
    });
    // Color should be a bg-*-500 Tailwind class from the shared 8-slot palette.
    expect(sourceFields.color).toMatch(/^bg-[a-z]+-500$/);
    // sourceColor should equal color (both derived from the same hash).
    expect(sourceFields.sourceColor).toBe(sourceFields.color);
  });

  // 6. dedup: item in approvedTodoTaskIds dropped
  it('dedup: item whose id matches a live approved actionable is dropped', async () => {
    server = await buildTestServer(true);
    mockGetTaskItemsInWindow.mockResolvedValueOnce([
      {
        id: 'task-mirrored',
        listId: 'list-A',
        listName: 'My Tasks',
        title: 'Already mirrored',
        dueMs: 1_745_000_000_000,
        etag: null,
        updated: null,
      },
      {
        id: 'task-fresh',
        listId: 'list-A',
        listName: 'My Tasks',
        title: 'Not mirrored',
        dueMs: 1_745_000_000_000,
        etag: null,
        updated: null,
      },
    ]);
    mockGetApprovedActionableTodoTaskIds.mockReturnValueOnce(
      new Set<string>(['task-mirrored']),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-tasks/items?from=0&to=9999999999999',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('task-fresh');
  });

  // 7. completed items excluded by todoService layer (no upstream emit)
  it('completed items never arrive from todoService — route returns []', async () => {
    server = await buildTestServer(true);
    // Simulate: todoService already filtered out status='completed'.
    mockGetTaskItemsInWindow.mockResolvedValueOnce([]);

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-tasks/items?from=0&to=9999999999999',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  // 8. out-of-window items excluded by todoService layer
  it('out-of-window items never arrive from todoService — route returns []', async () => {
    server = await buildTestServer(true);
    // Simulate: todoService already clipped to the window.
    mockGetTaskItemsInWindow.mockResolvedValueOnce([]);

    const narrowFrom = 1_745_000_000_000;
    const narrowTo = 1_745_000_000_001;
    const res = await server.inject({
      method: 'GET',
      url: `/api/google-tasks/items?from=${narrowFrom}&to=${narrowTo}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
    // Verify the window was forwarded to todoService unchanged.
    expect(mockGetTaskItemsInWindow).toHaveBeenCalledWith(narrowFrom, narrowTo);
  });

  // 9. Hebrew title → language='he'
  it('Hebrew title is detected as language=he', async () => {
    server = await buildTestServer(true);
    mockGetTaskItemsInWindow.mockResolvedValueOnce([
      {
        id: 'task-he',
        listId: 'list-A',
        listName: 'משימות שלי',
        title: 'לקנות חלב',
        dueMs: 1_745_000_000_000,
        etag: null,
        updated: null,
      },
    ]);
    const res = await server.inject({
      method: 'GET',
      url: '/api/google-tasks/items?from=0&to=9999999999999',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ language: string }> };
    expect(body.items[0].language).toBe('he');
  });

  // 10. graceful gtasks_unavailable → 200 { items: [], error }
  it('gtasks_unavailable: upstream throw → 200 {items:[], error}', async () => {
    server = await buildTestServer(true);
    mockGetTaskItemsInWindow.mockRejectedValueOnce(
      new Error('Google Tasks client not available'),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/google-tasks/items?from=0&to=9999999999999',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [],
      error: 'gtasks_unavailable',
    });
  });
});
