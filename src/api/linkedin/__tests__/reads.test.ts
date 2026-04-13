import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import linkedinRoutes from '../../routes/linkedin.js';
import { PM_AUTHORITY_BASE_URL } from '../client.js';

/**
 * Plan 34-02: read-side proxy routes.
 *
 * Mocks global fetch and uses fastify.inject() to hit the 5 GET routes.
 * The /api/linkedin/health route is also registered by linkedinRoutes, but
 * these tests don't exercise it (covered by health.test.ts).
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Build a minimal PostDTO that satisfies PostSchema. Field names mirror
 * pm-authority's Pydantic PostDTO exactly (snake_case, ISO timestamps).
 */
function fixturePost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'post-aaa',
    sequence_id: 'seq-111',
    position: 1,
    status: 'DRAFT',
    perspective: 'yuval',
    language: 'en',
    content: 'hello world',
    content_he: null,
    image: { source: null, url: null, pii_reviewed: false },
    variants: [],
    lesson_candidates: [],
    regeneration_count: 0,
    regeneration_capped: false,
    share_urn: null,
    scheduled_at: null,
    published_at: null,
    created_at: '2025-01-01T00:00:00+00:00',
    updated_at: null,
    ...overrides,
  };
}

function fixtureJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-abc',
    kind: 'regenerate',
    status: 'running',
    result: null,
    error: null,
    started_at: '2025-01-01T00:00:00+00:00',
    finished_at: null,
    ...overrides,
  };
}

/**
 * Build a test server with a stub authenticate decorator (always passes).
 * Individual tests that exercise the 401 path build their own server with
 * an authenticate decorator that rejects.
 */
async function buildTestServer(
  authenticate: () => Promise<void> = async () => {
    /* always pass */
  },
): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  fastify.decorate('authenticate', authenticate);
  await fastify.register(linkedinRoutes);
  await fastify.ready();
  return fastify;
}

describe('linkedin read routes (plan 34-02)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let server: FastifyInstance;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    server = await buildTestServer();
  });

  afterEach(async () => {
    await server.close();
    vi.unstubAllGlobals();
  });

  // ─── 1. GET /api/linkedin/posts (no query) ────────────────────────────
  it('GET /posts (no query) → upstream /v1/posts without query string, returns array', async () => {
    const posts = [fixturePost({ id: 'p1' }), fixturePost({ id: 'p2' })];
    fetchMock.mockResolvedValueOnce(jsonResponse(posts));

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    expect(res.json()[0].id).toBe('p1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toBe(`${PM_AUTHORITY_BASE_URL}/v1/posts`);
  });

  // ─── 2. GET /api/linkedin/posts?status=DRAFT ──────────────────────────
  it('GET /posts?status=DRAFT → upstream URL has single status param', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([fixturePost()]));

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts?status=DRAFT',
    });

    expect(res.statusCode).toBe(200);
    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toBe(
      `${PM_AUTHORITY_BASE_URL}/v1/posts?status=DRAFT`,
    );
  });

  // ─── 3. GET /api/linkedin/posts?status=DRAFT&status=APPROVED ──────────
  it('GET /posts?status=DRAFT&status=APPROVED → repeated param (NOT comma-joined)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([fixturePost()]));

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts?status=DRAFT&status=APPROVED',
    });

    expect(res.statusCode).toBe(200);
    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    // Must be two separate ?status= params, in order.
    const params = Array.from(calledUrl.searchParams.entries());
    expect(params).toEqual([
      ['status', 'DRAFT'],
      ['status', 'APPROVED'],
    ]);
    // And the literal URL string must NOT contain a comma-joined form.
    expect(calledUrl.toString()).toContain('status=DRAFT&status=APPROVED');
    expect(calledUrl.toString()).not.toContain('DRAFT%2CAPPROVED');
  });

  // ─── 4. Schema mismatch on /posts response ────────────────────────────
  it('GET /posts when upstream returns a malformed post array → 500 INTERNAL_ERROR schema mismatch', async () => {
    // Upstream returns an object instead of an array → should fail z.array(PostSchema)
    fetchMock.mockResolvedValueOnce(jsonResponse({ not: 'an array' }));

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts',
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('upstream response schema mismatch');
    expect(body.error.details.path).toBe('/v1/posts');
  });

  // ─── 5. GET /posts/:id → upstream 200 ─────────────────────────────────
  it('GET /posts/:id on upstream 200 → returns the post', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(fixturePost({ id: 'post-xyz' })),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts/post-xyz',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('post-xyz');

    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    expect(calledUrl.pathname).toBe('/v1/posts/post-xyz');
  });

  // ─── 6. GET /posts/:id → upstream 404 passthrough ─────────────────────
  it('GET /posts/:id on upstream 404 → dashboard receives 404 with upstream envelope verbatim', async () => {
    const envelope = {
      error: {
        code: 'NOT_FOUND',
        message: 'post xyz not found',
        details: {},
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope, 404));

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts/xyz',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(envelope);
  });

  // ─── 7. GET /posts/:id → connection refused → 503 UNAVAILABLE ─────────
  it('GET /posts/:id when pm-authority is unreachable → 503 UNAVAILABLE', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8765'), {
      code: 'ECONNREFUSED',
    });
    const fetchErr = Object.assign(new TypeError('fetch failed'), { cause });
    fetchMock.mockRejectedValueOnce(fetchErr);

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts/any-id',
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe('UNAVAILABLE');
    expect(body.error.message).toBe('pm-authority is not reachable');
  });

  // ─── 8. GET /jobs/:jobId → upstream 200 ────────────────────────────────
  it('GET /jobs/:jobId on upstream 200 → returns JobSchema-valid body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(fixtureJob({ id: 'job-xyz', status: 'succeeded' })),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/jobs/job-xyz',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('job-xyz');
    expect(body.status).toBe('succeeded');

    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    expect(calledUrl.pathname).toBe('/v1/jobs/job-xyz');
  });

});

// ─── Auth gate test (separate server with rejecting authenticate) ───────
describe('linkedin read routes — auth gate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let server: FastifyInstance;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // authenticate that ALWAYS rejects — mirrors @fastify/jwt's 401 behavior.
    server = await buildTestServer(async (_req: unknown, reply: unknown) => {
      await (reply as { code: (n: number) => { send: (b: unknown) => void } })
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'missing token', details: {} } });
    });
  });

  afterEach(async () => {
    await server.close();
    vi.unstubAllGlobals();
  });

  // ─── 9. GET /posts without auth → 401 ─────────────────────────────────
  it('GET /posts without a valid token → 401 and upstream fetch is NEVER called', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts',
    });

    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
