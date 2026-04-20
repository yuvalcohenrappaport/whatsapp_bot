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
    // Plan 37-01 additions — required PostSchema fields.
    project_name: 'TestProject',
    source_snippet: null,
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

// ═════════════════════════════════════════════════════════════════════════
// Plan 36-01 — upload-image (multipart) + confirm-pii routes
// ═════════════════════════════════════════════════════════════════════════

/**
 * Hand-build a multipart/form-data body matching RFC 7578. Avoids pulling in
 * the form-data package — Fastify's inject accepts Buffer + content-type.
 */
function buildMultipartBody(
  boundary: string,
  field: string,
  filename: string,
  contentType: string,
  fileBytes: Buffer,
): Buffer {
  const CRLF = '\r\n';
  const header =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="${field}"; filename="${filename}"${CRLF}` +
    `Content-Type: ${contentType}${CRLF}${CRLF}`;
  const footer = `${CRLF}--${boundary}--${CRLF}`;
  return Buffer.concat([
    Buffer.from(header, 'utf8'),
    fileBytes,
    Buffer.from(footer, 'utf8'),
  ]);
}

function multipartPayload(
  field: string,
  filename: string,
  contentType: string,
  fileBytes: Buffer,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----TestBoundary' + Math.random().toString(16).slice(2);
  const payload = buildMultipartBody(
    boundary,
    field,
    filename,
    contentType,
    fileBytes,
  );
  return {
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    },
  };
}

const MIN_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ...Array(50).fill(0),
]);

describe('linkedin write routes — Plan 36-01 upload-image + confirm-pii', () => {
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

  // ───── upload-image — 6 tests ─────────────────────────────────────────

  it('POST /posts/:id/upload-image → 200 + PostSchema on happy path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        fixturePost({
          id: 'post-xyz',
          status: 'PENDING_PII_REVIEW',
          image: {
            source: 'uploaded',
            url: '/v1/posts/post-xyz/image',
            pii_reviewed: false,
          },
        }),
      ),
    );

    const { payload, headers } = multipartPayload(
      'image',
      'shot.png',
      'image/png',
      MIN_PNG,
    );
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-xyz/upload-image',
      payload,
      headers,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('post-xyz');
    expect(body.status).toBe('PENDING_PII_REVIEW');
    expect(body.image.source).toBe('uploaded');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Upstream URL string (not a URL object — we use string interp for multipart).
    expect(String(calledUrl)).toBe(
      `${PM_AUTHORITY_BASE_URL}/v1/posts/post-xyz/upload-image`,
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('POST /posts/:id/upload-image with no file field → 400 VALIDATION_ERROR, fetch NOT called', async () => {
    // Empty multipart — no file parts at all.
    const boundary = '----EmptyBoundary';
    const payload = Buffer.from(`--${boundary}--\r\n`, 'utf8');
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-xyz/upload-image',
      payload,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(payload.length),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /posts/:id/upload-image with wrong field name → 400 VALIDATION_ERROR, fetch NOT called', async () => {
    const { payload, headers } = multipartPayload(
      'file', // wrong — handler expects 'image'
      'shot.png',
      'image/png',
      MIN_PNG,
    );
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-xyz/upload-image',
      payload,
      headers,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.received).toBe('file');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /posts/:id/upload-image oversize → 413 VALIDATION_ERROR with cap_bytes', async () => {
    // 11 MB payload — the 10 MB limits.fileSize plugin should throw
    // FST_REQ_FILE_TOO_LARGE when toBuffer() drains past the cap.
    const big = Buffer.alloc(11 * 1024 * 1024, 0x41);
    const { payload, headers } = multipartPayload(
      'image',
      'big.png',
      'image/png',
      big,
    );
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-xyz/upload-image',
      payload,
      headers,
    });

    expect(res.statusCode).toBe(413);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.cap_bytes).toBe(10 * 1024 * 1024);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /posts/:id/upload-image upstream 409 STATE_VIOLATION → pass-through', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'STATE_VIOLATION',
            message: 'cannot replace_image post with status PUBLISHED',
            details: {
              action: 'replace_image',
              current_status: 'PUBLISHED',
              allowed_from: ['APPROVED', 'DRAFT', 'PENDING_PII_REVIEW'],
            },
          },
        },
        409,
      ),
    );

    const { payload, headers } = multipartPayload(
      'image',
      'shot.png',
      'image/png',
      MIN_PNG,
    );
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-pub/upload-image',
      payload,
      headers,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('STATE_VIOLATION');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POST /posts/:id/upload-image upstream schema mismatch → 500 INTERNAL_ERROR', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ garbage: true }, 200));

    const { payload, headers } = multipartPayload(
      'image',
      'shot.png',
      'image/png',
      MIN_PNG,
    );
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-xyz/upload-image',
      payload,
      headers,
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  // ───── confirm-pii — 2 tests ──────────────────────────────────────────

  it('POST /posts/:id/confirm-pii → 200 + PostSchema (empty body)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(fixturePost({ id: 'post-xyz', status: 'DRAFT' })),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-xyz/confirm-pii',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('DRAFT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/posts/post-xyz/confirm-pii');
    expect(init.method).toBe('POST');
  });

  it('POST /posts/:id/confirm-pii upstream 409 STATE_VIOLATION → pass-through', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'STATE_VIOLATION',
            message: 'cannot confirm_pii post with status DRAFT',
            details: {
              action: 'confirm_pii',
              current_status: 'DRAFT',
              allowed_from: ['PENDING_PII_REVIEW'],
            },
          },
        },
        409,
      ),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/post-xyz/confirm-pii',
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STATE_VIOLATION');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Plan 38-01 — lesson-runs/generate + projects proxy routes
// ═════════════════════════════════════════════════════════════════════════

describe('linkedin write routes — Plan 38-01 lesson-runs/generate', () => {
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

  it('POST /lesson-runs/generate with valid body → 202 + job_id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ job_id: 'job-gen-1' }, 202),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/lesson-runs/generate',
      payload: {
        project_name: 'my-project',
        perspective: 'yuval',
        language: 'en',
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().job_id).toBe('job-gen-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/lesson-runs/generate');
    expect(init.method).toBe('POST');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.project_name).toBe('my-project');
  });

  it('POST /lesson-runs/generate with missing project_name → 400 VALIDATION_ERROR', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/lesson-runs/generate',
      payload: { language: 'en' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /lesson-runs/generate with upstream 404 → pass-through', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'NOT_FOUND',
            message: "no sequence found for project 'nonexistent' with context",
            details: { project_name: 'nonexistent' },
          },
        },
        404,
      ),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/lesson-runs/generate',
      payload: { project_name: 'nonexistent' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('POST /lesson-runs/generate with topic_hint → forwarded to upstream', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ job_id: 'job-gen-2' }, 202),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/lesson-runs/generate',
      payload: {
        project_name: 'my-project',
        topic_hint: 'focus on scaling',
      },
    });

    expect(res.statusCode).toBe(202);
    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0] as [URL, RequestInit])[1].body as string,
    );
    expect(sentBody.topic_hint).toBe('focus on scaling');
  });

  it('GET /projects → returns project list from upstream', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ projects: ['alpha', 'beta', 'gamma'] }),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/projects',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toEqual(['alpha', 'beta', 'gamma']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/projects');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Plan 44-01 — Route 11: POST /api/linkedin/posts/:id/reschedule
  // ═══════════════════════════════════════════════════════════════════════

  it('POST /posts/:id/reschedule without JWT → 401', async () => {
    // Build a fresh server that always rejects auth (401 response).
    const unauthServer = await buildTestServer(async () => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    });
    try {
      const res = await unauthServer.inject({
        method: 'POST',
        url: '/api/linkedin/posts/abc/reschedule',
        payload: { scheduled_at: '2026-04-29T09:00:00Z' },
      });
      expect(res.statusCode).toBe(401);
      // fetch must NOT be called — auth gate fired before upstream call
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await unauthServer.close();
    }
  });

  it('POST /posts/:id/reschedule with JWT + empty body → 400 VALIDATION_ERROR', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/abc/reschedule',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    // fetch must NOT be called — Zod validation fired before upstream call
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /posts/:id/reschedule with JWT + valid body → 200 + upstream PostDTO', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        fixturePost({ id: 'abc', status: 'APPROVED', scheduled_at: '2026-04-28T03:30:00+00:00' }),
      ),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/abc/reschedule',
      payload: { scheduled_at: '2026-04-25T12:00:00Z' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('abc');
    expect(res.json().status).toBe('APPROVED');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/posts/abc/reschedule');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      scheduled_at: '2026-04-25T12:00:00Z',
    });
  });

  it('POST /posts/:id/reschedule with JWT + valid body, upstream returns 409 STATE_VIOLATION → passthrough 409', async () => {
    const upstreamError = {
      error: {
        code: 'STATE_VIOLATION',
        message: 'cannot reschedule post in status PUBLISHED',
        details: { post_id: 'abc', current_status: 'PUBLISHED' },
      },
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(upstreamError), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts/abc/reschedule',
      payload: { scheduled_at: '2026-04-29T09:00:00Z' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STATE_VIOLATION');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DELETE /api/linkedin/posts/:id — proxy to DELETE /v1/posts/:id
  // ═══════════════════════════════════════════════════════════════════════

  it('DELETE /posts/:id with JWT, upstream returns 204 → proxy returns 204', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    const res = await server.inject({
      method: 'DELETE',
      url: '/api/linkedin/posts/post-xyz',
    });

    expect(res.statusCode).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(calledUrl)).toContain('/v1/posts/post-xyz');
    expect(init.method).toBe('DELETE');
  });

  it('DELETE /posts/:id with JWT, upstream returns 409 STATE_VIOLATION → passthrough 409', async () => {
    const upstreamError = {
      error: {
        code: 'STATE_VIOLATION',
        message: 'cannot delete post in status PUBLISHED',
        details: { post_id: 'post-xyz', current_status: 'PUBLISHED' },
      },
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(upstreamError), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await server.inject({
      method: 'DELETE',
      url: '/api/linkedin/posts/post-xyz',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STATE_VIOLATION');
  });

  it('DELETE /posts/:id with JWT, upstream returns 404 NOT_FOUND → passthrough 404', async () => {
    const upstreamError = {
      error: {
        code: 'NOT_FOUND',
        message: 'post not found',
        details: { post_id: 'unknown-id' },
      },
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(upstreamError), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await server.inject({
      method: 'DELETE',
      url: '/api/linkedin/posts/unknown-id',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Plan 48-02 — POST /api/linkedin/posts (dashboard composer proxy)
// ═════════════════════════════════════════════════════════════════════════

describe('linkedin write routes — Plan 48-02 POST /api/linkedin/posts', () => {
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

  it('POST /api/linkedin/posts happy path → 201 + PostSchema, upstream body forwarded', async () => {
    const created = fixturePost({
      id: 'post-new-1',
      status: 'PENDING_REVIEW',
      project_name: 'my-project',
      content: 'hello world',
      language: 'en',
      content_he: null,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(created, 201));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts',
      payload: {
        title: 'smoke test',
        content: 'hello world',
        language: 'en',
        project_name: 'my-project',
        perspective: 'yuval',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe('post-new-1');
    expect(body.status).toBe('PENDING_REVIEW');
    expect(body.project_name).toBe('my-project');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.pathname).toBe('/v1/posts');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string);
    expect(sent.title).toBe('smoke test');
    expect(sent.content).toBe('hello world');
    expect(sent.project_name).toBe('my-project');
    expect(sent.perspective).toBe('yuval');
  });

  it('POST /api/linkedin/posts with empty content → 400 VALIDATION_ERROR, fetch NEVER called', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts',
      payload: {
        title: 't',
        content: '',
        language: 'en',
        project_name: 'p',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('invalid request body');
    expect(body.error.details.issues).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /api/linkedin/posts with language=he and no content_he → 400 VALIDATION_ERROR citing content_he', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts',
      payload: {
        title: 't',
        content: 'en body',
        content_he: null,
        language: 'he',
        project_name: 'p',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // Cross-field refine puts path:['content_he'] on the issue.
    const issues = body.error.details.issues as Array<{
      path: unknown[];
      message: string;
    }>;
    const hebrewIssue = issues.find((i) => i.path.includes('content_he'));
    expect(hebrewIssue).toBeDefined();
    expect(hebrewIssue!.message).toMatch(/content_he/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /api/linkedin/posts upstream 400 VALIDATION_ERROR → pass-through verbatim', async () => {
    const upstreamEnvelope = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'project not found',
        details: { project_name: 'unknown' },
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(upstreamEnvelope, 400));

    const res = await server.inject({
      method: 'POST',
      url: '/api/linkedin/posts',
      payload: {
        title: 'smoke',
        content: 'hi',
        language: 'en',
        project_name: 'unknown',
        perspective: 'yuval',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(upstreamEnvelope);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/linkedin/posts without auth → 401, upstream fetch NEVER called', async () => {
    const unauthServer = await buildTestServer(async (_req: unknown, reply: unknown) => {
      await (reply as { code: (n: number) => { send: (b: unknown) => void } })
        .code(401)
        .send({
          error: { code: 'UNAUTHORIZED', message: 'missing token', details: {} },
        });
    });
    try {
      const res = await unauthServer.inject({
        method: 'POST',
        url: '/api/linkedin/posts',
        payload: {
          title: 't',
          content: 'hi',
          language: 'en',
          project_name: 'p',
          perspective: 'yuval',
        },
      });
      expect(res.statusCode).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await unauthServer.close();
    }
  });
});
