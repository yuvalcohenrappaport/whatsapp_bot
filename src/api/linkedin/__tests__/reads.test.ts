import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import linkedinRoutes from '../../routes/linkedin.js';
import { PM_AUTHORITY_BASE_URL } from '../client.js';
import { PostSchema } from '../schemas.js';

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

  // ─── 10. GET /posts/:id/image → upstream 200 binary ──────────────────
  // (test 9 "no auth → 401" runs on a separate server below)
  it('GET /posts/:id/image streams binary body with upstream content-type preserved', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fetchMock.mockResolvedValueOnce(
      new Response(pngBytes, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(pngBytes.byteLength),
        },
      }),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts/post-abc/image',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-length']).toBe(String(pngBytes.byteLength));
    // Body bytes must match upstream exactly (not JSON-wrapped).
    const bodyBytes = new Uint8Array(res.rawPayload);
    expect(Array.from(bodyBytes)).toEqual(Array.from(pngBytes));

    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    expect(calledUrl.pathname).toBe('/v1/posts/post-abc/image');
  });

  // ─── 11. GET /posts/:id/image → upstream 404 JSON envelope ───────────
  it('GET /posts/:id/image on upstream 404 → 404 with JSON error envelope (not binary)', async () => {
    const envelope = {
      error: {
        code: 'NOT_FOUND',
        message: 'post has no image',
        details: {},
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope, 404));

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts/post-abc/image',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(envelope);
  });

  // ─── 12. GET /posts/:id/lesson-candidates/:cid/image ──────────────────
  it('GET /posts/:id/lesson-candidates/:cid/image uses both params in upstream URL and preserves content-type', async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    fetchMock.mockResolvedValueOnce(
      new Response(jpegBytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/posts/post-abc/lesson-candidates/42/image',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');

    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    expect(calledUrl.pathname).toBe('/v1/posts/post-abc/lesson-candidates/42/image');
  });

  // ─── 13. Path param encoding prevents traversal ───────────────────────
  it('GET /posts/:id URL-encodes unsafe path params (prevents traversal via percent)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(fixturePost()));

    // Note: Fastify's router strips literal slashes inside a param, so the
    // value that actually reaches the handler will NOT itself contain a
    // slash. What we're testing here is that whatever raw value Fastify
    // gives us, we encodeURIComponent-escape it before interpolating into
    // the upstream URL. Use a value with `%` which Fastify passes through.
    await server.inject({
      method: 'GET',
      // `%25` decodes to `%`, which encodeURIComponent re-escapes to `%25`.
      url: '/api/linkedin/posts/weird%25id',
    });

    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    // Encoded in the pathname — not a raw `%` that could confuse the server.
    expect(calledUrl.pathname).toBe('/v1/posts/weird%25id');
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

/**
 * Plan 35-01: PostSchema.analytics mirror (cross-repo contract).
 *
 * Exercises Zod parse directly against four wire shapes pm-authority is
 * allowed to emit after Plan 35-01 landed on the Python side:
 *   - analytics absent   (older pm-authority build during deploy window)
 *   - analytics: null    (no post_analytics row — the default on live data today)
 *   - analytics: object  (full metrics, freshly-fetched)
 *   - analytics: object  (partial nulls — LinkedIn returned only some metrics)
 *
 * These cases bypass Fastify because the contract is a pure schema shape;
 * exercising it via the proxy route would add zero signal over the raw parse.
 */
describe('PostSchema analytics field (Plan 35-01)', () => {
  it('parses cleanly when analytics is absent (older pm-authority build)', () => {
    const livePost = fixturePost({
      id: 'post-analytics-absent',
      status: 'PUBLISHED',
      share_urn: 'urn:li:share:1',
      published_at: '2026-04-10T06:30:00+00:00',
      // analytics key intentionally not set — .optional() must accept this
    });

    const parsed = PostSchema.parse(livePost);
    expect(parsed.analytics).toBeUndefined();
  });

  it('parses cleanly when analytics is explicitly null (no post_analytics row)', () => {
    const post = fixturePost({
      id: 'post-analytics-null',
      status: 'PUBLISHED',
      share_urn: 'urn:li:share:2',
      published_at: '2026-04-10T06:30:00+00:00',
      analytics: null,
    });

    const parsed = PostSchema.parse(post);
    expect(parsed.analytics).toBeNull();
  });

  it('parses cleanly when analytics is populated with full metrics', () => {
    const post = fixturePost({
      id: 'post-analytics-full',
      status: 'PUBLISHED',
      share_urn: 'urn:li:share:3',
      published_at: '2026-04-10T06:30:00+00:00',
      analytics: {
        impressions: 1200,
        reactions: 87,
        comments: 34,
        reshares: 5,
        members_reached: 950,
      },
    });

    const parsed = PostSchema.parse(post);
    expect(parsed.analytics).toEqual({
      impressions: 1200,
      reactions: 87,
      comments: 34,
      reshares: 5,
      members_reached: 950,
    });
  });

  it('parses cleanly when analytics has partial nulls (real wire shape)', () => {
    // Mirrors pm-authority's test_analytics_partial_row_surfaces_nulls —
    // LinkedIn often returns only some metrics on a given fetch.
    const post = fixturePost({
      id: 'post-analytics-partial',
      status: 'PUBLISHED',
      share_urn: 'urn:li:share:4',
      published_at: '2026-04-10T06:30:00+00:00',
      analytics: {
        impressions: null,
        reactions: 42,
        comments: null,
        reshares: null,
        members_reached: null,
      },
    });

    const parsed = PostSchema.parse(post);
    expect(parsed.analytics?.reactions).toBe(42);
    expect(parsed.analytics?.impressions).toBeNull();
    expect(parsed.analytics?.comments).toBeNull();
    expect(parsed.analytics?.reshares).toBeNull();
    expect(parsed.analytics?.members_reached).toBeNull();
  });
});
