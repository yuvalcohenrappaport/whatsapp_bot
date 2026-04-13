import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import linkedinRoutes from '../../routes/linkedin.js';
import { PM_AUTHORITY_BASE_URL } from '../client.js';

/**
 * Plan 34-03: write-side proxy routes.
 *
 * Mocks global fetch and uses fastify.inject() to hit the 8 POST routes.
 * Same harness shape as reads.test.ts (plan 34-02).
 *
 * Coverage:
 *   Tasks 1-3 (fast sync mutations): approve, reject, edit
 *   - happy paths + upstream body mirror
 *   - Zod body validation failures → 400 VALIDATION_ERROR, fetch NOT called
 *   - .strict() rejects extra fields
 *   - upstream STATE_VIOLATION (409) pass-through
 *   - upstream NOT_FOUND (404) pass-through
 *
 *   Tasks 4-8 (async 202 mutations + mixed pick-variant):
 *   - regenerate + REGEN_CAPPED (409) pass-through
 *   - pick-lesson + LESSON_ALREADY_PICKED (409) pass-through + missing-field 400
 *   - replace-image + missing-field 400
 *   - lesson-runs happy path + optional forwarding
 *   - pick-variant FAST (200 Post) AND SLOW (202 JobAccepted) branches
 *   - pick-variant schema mismatch both branches → 500
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Minimal PostDTO satisfying PostSchema. Mirrors the fixture in reads.test.ts.
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

describe('linkedin write routes (plan 34-03)', () => {
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

  // ═══════════════════════════════════════════════════════════════════════
  // Task 1 — fast sync mutations
  // ═══════════════════════════════════════════════════════════════════════

  // ─── 1. POST /approve happy path ─────────────────────────────────────
  it('POST /posts/:id/approve → upstream POST with no body, returns 200 PostSchema', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(fixturePost({ id: 'post-xyz', status: 'APPROVED' })),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-xyz/approve',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('post-xyz');
    expect(res.json().status).toBe('APPROVED');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/posts/post-xyz/approve');
    expect(init.method).toBe('POST');
    // No body on approve.
    expect(init.body).toBeUndefined();
  });

  // ─── 2. POST /reject happy path ──────────────────────────────────────
  it('POST /posts/:id/reject → upstream POST with no body, returns 200 PostSchema', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(fixturePost({ id: 'post-xyz', status: 'REJECTED' })),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-xyz/reject',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REJECTED');

    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/posts/post-xyz/reject');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  // ─── 3. POST /edit happy path with content only ──────────────────────
  it('POST /posts/:id/edit with {content} → upstream body matches input, 200 PostSchema', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(fixturePost({ id: 'p1', content: 'new text' })),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/edit',
      payload: { content: 'new text' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe('new text');

    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/posts/p1/edit');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'new text' });
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
  });

  // ─── 4. POST /edit with content + content_he ─────────────────────────
  it('POST /posts/:id/edit with {content, content_he} → both fields forwarded', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(fixturePost({ id: 'p1', content: 'new', content_he: 'חדש' })),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/edit',
      payload: { content: 'new', content_he: 'חדש' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().content_he).toBe('חדש');

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      content: 'new',
      content_he: 'חדש',
    });
  });

  // ─── 5. POST /edit with empty content → 400 VALIDATION_ERROR, no fetch ─
  it('POST /posts/:id/edit with empty content → 400 VALIDATION_ERROR, fetch NEVER called', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/edit',
      payload: { content: '' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('invalid request body');
    expect(body.error.details.issues).toBeDefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── 6. POST /edit with extra field → 400 (strict schema) ────────────
  it('POST /posts/:id/edit with extra field → 400 VALIDATION_ERROR (EditRequestSchema is .strict)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/edit',
      payload: { content: 'hi', bogus: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── 7. POST /approve upstream STATE_VIOLATION 409 pass-through ──────
  it('POST /approve on upstream 409 STATE_VIOLATION → 409 pass-through verbatim', async () => {
    const envelope = {
      error: {
        code: 'STATE_VIOLATION',
        message: 'post is not in DRAFT state',
        details: { current: 'APPROVED' },
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope, 409));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/approve',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(envelope);
  });

  // ─── 8. POST /edit upstream 404 pass-through ─────────────────────────
  it('POST /edit on upstream 404 NOT_FOUND → 404 pass-through verbatim', async () => {
    const envelope = {
      error: {
        code: 'NOT_FOUND',
        message: 'post not found',
        details: {},
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope, 404));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/missing/edit',
      payload: { content: 'hi' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(envelope);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Task 2 — async 202 mutations + mixed pick-variant
  // ═══════════════════════════════════════════════════════════════════════

  // ─── 9. POST /regenerate → 202 JobAccepted ───────────────────────────
  it('POST /posts/:id/regenerate → upstream 202 {job_id}, returns 202 JobAcceptedSchema', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ job_id: 'abc' }, 202));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/regenerate',
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ job_id: 'abc' });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/posts/p1/regenerate');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  // ─── 10. POST /regenerate upstream 409 REGEN_CAPPED pass-through ─────
  it('POST /regenerate on upstream 409 REGEN_CAPPED → 409 pass-through verbatim', async () => {
    const envelope = {
      error: {
        code: 'REGEN_CAPPED',
        message: 'regeneration cap of 5 reached',
        details: { count: 5 },
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope, 409));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/regenerate',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(envelope);
  });

  // ─── 11. POST /pick-lesson happy path → 202 ──────────────────────────
  it('POST /posts/:id/pick-lesson with {candidate_id} → 202 JobAcceptedSchema', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ job_id: 'j2' }, 202));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/pick-lesson',
      payload: { candidate_id: 42 },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ job_id: 'j2' });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/posts/p1/pick-lesson');
    expect(JSON.parse(init.body as string)).toEqual({ candidate_id: 42 });
  });

  // ─── 12. POST /pick-lesson missing field → 400 VALIDATION_ERROR ──────
  it('POST /pick-lesson without candidate_id → 400 VALIDATION_ERROR, fetch NEVER called', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/pick-lesson',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── 13. POST /pick-lesson upstream 409 LESSON_ALREADY_PICKED ────────
  it('POST /pick-lesson on upstream 409 LESSON_ALREADY_PICKED → 409 pass-through verbatim', async () => {
    const envelope = {
      error: {
        code: 'LESSON_ALREADY_PICKED',
        message: 'a lesson has already been picked for this post',
        details: { picked_candidate_id: 7 },
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope, 409));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/pick-lesson',
      payload: { candidate_id: 42 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(envelope);
  });

  // ─── 14. POST /replace-image happy path + missing-field 400 ──────────
  it('POST /posts/:id/replace-image happy path → 202, missing image_path → 400', async () => {
    // Happy path
    fetchMock.mockResolvedValueOnce(jsonResponse({ job_id: 'j3' }, 202));
    const okRes = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/replace-image',
      payload: { image_path: '/tmp/foo.png' },
    });
    expect(okRes.statusCode).toBe(202);
    expect(okRes.json()).toEqual({ job_id: 'j3' });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      image_path: '/tmp/foo.png',
    });

    // Missing image_path
    fetchMock.mockClear();
    const badRes = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/replace-image',
      payload: {},
    });
    expect(badRes.statusCode).toBe(400);
    expect(badRes.json().error.code).toBe('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── 15. POST /lesson-runs happy path with optional fields forwarded ─
  it('POST /lesson-runs with full body → 202, upstream receives all fields', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ job_id: 'lr1' }, 202));

    const payload = {
      source_sequence_id: 'seq-111',
      chosen_lesson: 'Ship small, learn fast.',
      perspective: 'yuval',
      language: 'en',
    };
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/lesson-runs',
      payload,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ job_id: 'lr1' });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.toString()).toBe(`${PM_AUTHORITY_BASE_URL}/v1/lesson-runs`);
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  // ─── 15b. POST /lesson-runs without optional fields → still 202 ──────
  it('POST /lesson-runs with only required fields → 202, optional fields absent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ job_id: 'lr2' }, 202));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/lesson-runs',
      payload: {
        source_sequence_id: 'seq-222',
        chosen_lesson: 'Another lesson',
      },
    });

    expect(res.statusCode).toBe(202);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      source_sequence_id: 'seq-222',
      chosen_lesson: 'Another lesson',
    });
  });

  // ─── 15c. POST /lesson-runs missing chosen_lesson → 400 ──────────────
  it('POST /lesson-runs without chosen_lesson → 400 VALIDATION_ERROR', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/lesson-runs',
      payload: { source_sequence_id: 'seq-222' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── 16. POST /pick-variant FAST PATH (200 PostSchema) ───────────────
  it('POST /posts/:id/pick-variant FAST PATH: upstream 200 PostSchema → 200 PostSchema', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(fixturePost({ id: 'p1', status: 'PENDING_LESSON_SELECTION' })),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/pick-variant',
      payload: { variant_id: 2 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('p1');
    expect(res.json().status).toBe('PENDING_LESSON_SELECTION');

    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/posts/p1/pick-variant');
    expect(JSON.parse(init.body as string)).toEqual({ variant_id: 2 });
  });

  // ─── 17. POST /pick-variant SLOW PATH (202 JobAccepted) ──────────────
  it('POST /posts/:id/pick-variant SLOW PATH: upstream 202 JobAccepted → 202 JobAcceptedSchema', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ job_id: 'image-job-1' }, 202));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/pick-variant',
      payload: { variant_id: 2 },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ job_id: 'image-job-1' });
  });

  // ─── 18a. pick-variant FAST path schema mismatch → 500 ───────────────
  it('POST /pick-variant: upstream 200 body fails PostSchema → 500 INTERNAL_ERROR', async () => {
    // Wrong shape for PostSchema — missing required `id`, `sequence_id`, etc.
    fetchMock.mockResolvedValueOnce(jsonResponse({ not: 'a post' }, 200));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/pick-variant',
      payload: { variant_id: 2 },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('upstream response schema mismatch');
    expect(body.error.details.path).toBe('/v1/posts/p1/pick-variant');
  });

  // ─── 18b. pick-variant SLOW path schema mismatch → 500 ───────────────
  it('POST /pick-variant: upstream 202 body fails JobAcceptedSchema → 500 INTERNAL_ERROR', async () => {
    // 202 without a `job_id` → fails JobAcceptedSchema in the route handler.
    fetchMock.mockResolvedValueOnce(jsonResponse({ totally: 'wrong' }, 202));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/pick-variant',
      payload: { variant_id: 2 },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('upstream response schema mismatch');
    expect(body.error.details.path).toBe('/v1/posts/:id/pick-variant (202)');
  });

  // ─── 18c. pick-variant upstream 409 VARIANT_ALREADY_PICKED ───────────
  it('POST /pick-variant on upstream 409 VARIANT_ALREADY_PICKED → 409 pass-through verbatim', async () => {
    const envelope = {
      error: {
        code: 'VARIANT_ALREADY_PICKED',
        message: 'a variant has already been picked for this post',
        details: {},
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope, 409));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/pick-variant',
      payload: { variant_id: 2 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(envelope);
  });

  // ─── Extra: path param encoding on a write route ─────────────────────
  it('POST /posts/:id/approve URL-encodes unsafe path params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(fixturePost({ id: 'weird%id' })));

    await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/weird%25id/approve',
    });

    const [calledUrl] = fetchMock.mock.calls[0] as [URL];
    expect(calledUrl.pathname).toBe('/v1/posts/weird%25id/approve');
  });
});

// ─── Auth gate test (separate server with rejecting authenticate) ───────
describe('linkedin write routes — auth gate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let server: FastifyInstance;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
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

  it('POST /posts/:id/edit without auth → 401 and upstream fetch is NEVER called', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/p1/edit',
      payload: { content: 'hi' },
    });

    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /lesson-runs without auth → 401 and upstream fetch is NEVER called', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/lesson-runs',
      payload: {
        source_sequence_id: 'seq-111',
        chosen_lesson: 'hi',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
