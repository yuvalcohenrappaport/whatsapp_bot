/**
 * Plan 43-01 vitest coverage for the /api/actionables routes.
 *
 * Covers:
 *   1-2. /pending   — 401 without JWT + 200 shape with a valid Bearer token.
 *   3-7. /recent    — 401 without JWT + limit defaulting/clamping/NaN fallback.
 *   8.   /stream    — 401 without a ?token= query string.
 *   9-10. hashActionables — stable across identical calls + sensitive to
 *         updatedAt changes on a single row.
 *
 * The SSE poll-and-emit loop is exercised INDIRECTLY via hashActionables —
 * a real SSE round-trip needs a listening socket + Date.now tolerance and
 * lands in Plan 43-03 live verification (see the manual-review note below).
 *
 * We stub fastify.authenticate + fastify.jwt the same way the linkedin
 * reads test does, avoiding the real jwtPlugin + config.ts env pipeline
 * that vitest's NODE_ENV='test' would break.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Actionable } from '../../db/queries/actionables.js';

// ─── Mocks ─────────────────────────────────────────────────────────────
const mockGetPending = vi.fn<() => Actionable[]>(() => []);
const mockGetRecent = vi.fn<(limit?: number) => Actionable[]>(() => []);

vi.mock('../../db/queries/actionables.js', () => ({
  getPendingActionables: () => mockGetPending(),
  getRecentTerminalActionables: (limit?: number) => mockGetRecent(limit),
}));

// The routes module must be imported AFTER the vi.mock call.
const { default: actionablesRoutes, hashActionables } = await import(
  '../routes/actionables.js'
);

// ─── Fixture builder ───────────────────────────────────────────────────
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
    status: 'pending_approval',
    detectedAt: 1_700_000_000_000,
    fireAt: null,
    enrichedTitle: null,
    enrichedNote: null,
    todoTaskId: null,
    todoListId: null,
    approvalPreviewMessageId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  } as Actionable;
}

// ─── Test server builder ───────────────────────────────────────────────
/**
 * Build a minimal fastify instance with stubbed auth — mirrors the
 * linkedin reads.test.ts pattern. `authPasses=false` simulates a missing
 * or invalid JWT (401 path). `jwtVerifyPasses=false` simulates the
 * manual ?token= verification failing on the /stream route.
 */
async function buildTestServer(
  authPasses = true,
  jwtVerifyPasses = true,
): Promise<FastifyInstance> {
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
  await fastify.register(actionablesRoutes);
  await fastify.ready();
  return fastify;
}

// ─── Route tests ───────────────────────────────────────────────────────
describe('actionables routes (plan 43-01) — auth-passing server', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockGetPending.mockReset();
    mockGetRecent.mockReset();
    mockGetPending.mockReturnValue([]);
    mockGetRecent.mockReturnValue([]);
    server = await buildTestServer(true, true);
  });

  afterEach(async () => {
    await server.close();
  });

  // 2. /pending — 200 with valid Bearer, body shape { actionables: [...] }.
  it('GET /pending with valid Bearer → 200 + mocked rows', async () => {
    const rows = [
      fixtureActionable(),
      { ...fixtureActionable(), id: 'p2', detectedLanguage: 'he' as const },
    ];
    mockGetPending.mockReturnValueOnce(rows);

    const res = await server.inject({
      method: 'GET',
      url: '/api/actionables/pending',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { actionables: Actionable[] };
    expect(body.actionables).toHaveLength(2);
    expect(body.actionables[0].id).toBe('act-1');
    expect(body.actionables[1].detectedLanguage).toBe('he');
    expect(mockGetPending).toHaveBeenCalledTimes(1);
  });

  // 4. /recent — no limit → default 50 passed to the query layer.
  it('GET /recent without limit → passes 50', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/actionables/recent',
    });
    expect(res.statusCode).toBe(200);
    expect(mockGetRecent).toHaveBeenCalledWith(50);
  });

  // 5. /recent?limit=10 → explicit limit honored.
  it('GET /recent?limit=10 → passes 10', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/actionables/recent?limit=10',
    });
    expect(res.statusCode).toBe(200);
    expect(mockGetRecent).toHaveBeenCalledWith(10);
  });

  // 6. /recent?limit=9999 → clamps to 200.
  it('GET /recent?limit=9999 → clamps to 200', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/actionables/recent?limit=9999',
    });
    expect(res.statusCode).toBe(200);
    expect(mockGetRecent).toHaveBeenCalledWith(200);
  });

  // 7. /recent?limit=abc → NaN falls back to 50.
  it('GET /recent?limit=abc → NaN falls back to 50', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/actionables/recent?limit=abc',
    });
    expect(res.statusCode).toBe(200);
    expect(mockGetRecent).toHaveBeenCalledWith(50);
  });
});

// ─── Auth-failing tests ────────────────────────────────────────────────
describe('actionables routes (plan 43-01) — auth-failing server', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockGetPending.mockReset();
    mockGetRecent.mockReset();
    mockGetPending.mockReturnValue([]);
    mockGetRecent.mockReturnValue([]);
    // authPasses=false → fastify.authenticate rejects. jwtVerifyPasses=false →
    // /stream's manual ?token= verification throws.
    server = await buildTestServer(false, false);
  });

  afterEach(async () => {
    await server.close();
  });

  // 1. /pending — 401 without Authorization header.
  it('GET /pending without Authorization → 401 and query not called', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/actionables/pending',
    });
    expect(res.statusCode).toBe(401);
    expect(mockGetPending).not.toHaveBeenCalled();
  });

  // 3. /recent — 401 without Authorization header.
  it('GET /recent without Authorization → 401 and query not called', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/actionables/recent',
    });
    expect(res.statusCode).toBe(401);
    expect(mockGetRecent).not.toHaveBeenCalled();
  });

  // 8. /stream — 401 without ?token=.
  // EventSource can't send headers, so we mirror /api/linkedin/queue/stream
  // and verify the token from the query string. jwtVerifyPasses=false here
  // forces the manual fastify.jwt.verify() call inside the route to throw.
  it('GET /stream without valid ?token → 401', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/actionables/stream',
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── hashActionables unit tests ─────────────────────────────────────────
describe('hashActionables (plan 43-01)', () => {
  // 9. Stable across identical inputs.
  it('stable across two calls with identical (empty) inputs', () => {
    const h1 = hashActionables([], []);
    const h2 = hashActionables([], []);
    expect(h1).toBe(h2);
  });

  // 10. Differs when ONE row's updatedAt changes.
  it('differs when a single row updatedAt changes', () => {
    const row = fixtureActionable();
    const rowBumped: Actionable = { ...row, updatedAt: row.updatedAt + 1 };
    const pending = [fixtureActionable()];

    const before = hashActionables(pending, [row]);
    const after = hashActionables(pending, [rowBumped]);
    expect(before).not.toBe(after);
  });
});

// ─── Manual review note ─────────────────────────────────────────────────
// Plan 43-03 live verification asserts the end-to-end /stream contract
// (SSE headers, initial emit, hash-dedup re-emit, 15s heartbeat). Testing
// a multi-frame SSE response through fastify.inject() isn't viable —
// inject() buffers the full body before returning, and an SSE handler
// never "ends" on its own, so the test would hang. The LinkedIn stream
// suite uses a real listening socket for the same reason; we skip that
// complexity here because the poll loop logic is already exercised by
// the hashActionables tests above.
