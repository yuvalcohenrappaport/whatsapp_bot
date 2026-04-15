/**
 * Tests for /api/linkedin/queue/stream — plan 35-02.
 *
 * Uses a real Fastify listen() + http.get combo so we can observe
 * streaming SSE frames; fastify.inject() buffers the whole response
 * and doesn't help for this use case.
 *
 * Global fetch is stubbed to return fixed Post lists. The ~25s of
 * wall-clock waits across the suite are deliberate — SSE timers are
 * real Node intervals and faking them would require mocking the http
 * stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import http from 'node:http';
import { hashPosts, registerStreamRoutes } from '../routes/stream.js';
import type { Post } from '../schemas.js';

// ─── Test helpers ─────────────────────────────────────────────────────────

/**
 * Build a minimal PostDTO-shaped plain object (matches pm-authority wire
 * format: snake_case + ISO-with-offset timestamps). Typed as `any` because
 * the wire shape uses strings where Post has string-unions etc — the schema
 * is permissive and the hash function only reads a handful of fields.
 */
function makePost(overrides: Record<string, unknown> = {}): Post {
  return {
    id: 'post-1',
    sequence_id: 'seq-1',
    position: 1,
    status: 'DRAFT',
    perspective: 'yuval',
    language: 'en',
    // Plan 37-01 additions
    project_name: 'TestProject',
    source_snippet: null,
    content: 'Hello world',
    content_he: null,
    image: { source: null, url: null, pii_reviewed: true },
    variants: [],
    lesson_candidates: [],
    regeneration_count: 0,
    regeneration_capped: false,
    share_urn: null,
    scheduled_at: null,
    published_at: null,
    created_at: '2026-04-01T10:00:00+00:00',
    updated_at: null,
    ...overrides,
  } as unknown as Post;
}

function mockUpstreamResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function buildTestServer(
  options: {
    verifyToken?: (token: string) => void;
  } = {},
): Promise<{ server: FastifyInstance; port: number }> {
  const fastify = Fastify({ logger: false });
  // Stub fastify.jwt.verify — the stream route calls it manually.
  const verify = options.verifyToken ?? ((_t: string) => void 0);
  (fastify as unknown as { jwt: { verify: (t: string) => void } }).jwt = {
    verify,
  };
  await registerStreamRoutes(fastify);
  await fastify.listen({ host: '127.0.0.1', port: 0 });
  const addr = fastify.server.address();
  if (typeof addr !== 'object' || addr === null) {
    throw new Error('fastify did not return an address');
  }
  return { server: fastify, port: addr.port };
}

/**
 * Open an SSE connection and read for `maxMs` milliseconds, then destroy
 * and return the concatenated buffer. Works for both streaming responses
 * (200 text/event-stream) and short responses (401 JSON).
 */
function readSseFrames(
  port: number,
  path: string,
  opts: { maxMs?: number; maxBytes?: number } = {},
): Promise<{ body: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const maxMs = opts.maxMs ?? 500;
    const maxBytes = opts.maxBytes ?? 256_000;
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: { accept: 'text/event-stream' },
      },
      (res) => {
        let buf = '';
        const statusCode = res.statusCode ?? 0;
        const timer = setTimeout(() => {
          res.destroy();
          resolve({ body: buf, statusCode });
        }, maxMs);
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          if (buf.length >= maxBytes) {
            clearTimeout(timer);
            res.destroy();
            resolve({ body: buf, statusCode });
          }
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ body: buf, statusCode });
        });
        res.on('error', (err) => {
          clearTimeout(timer);
          // Socket destroyed mid-stream is the normal close path — only
          // reject on a genuine error before any bytes arrived.
          if (buf.length > 0) resolve({ body: buf, statusCode });
          else reject(err);
        });
      },
    );
    req.on('error', reject);
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/linkedin/queue/stream — JWT gate', () => {
  let server: FastifyInstance;
  let port: number;

  beforeEach(async () => {
    const built = await buildTestServer({
      verifyToken: (token) => {
        if (token !== 'valid-token') throw new Error('bad token');
      },
    });
    server = built.server;
    port = built.port;
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns 401 when token is missing', async () => {
    const { body, statusCode } = await readSseFrames(
      port,
      '/api/linkedin/queue/stream',
      { maxMs: 300 },
    );
    expect(statusCode).toBe(401);
    expect(body).toMatch(/Unauthorized/);
  });

  it('returns 401 when token is invalid', async () => {
    const { body, statusCode } = await readSseFrames(
      port,
      '/api/linkedin/queue/stream?token=wrong',
      { maxMs: 300 },
    );
    expect(statusCode).toBe(401);
    expect(body).toMatch(/Unauthorized/);
  });
});

describe('GET /api/linkedin/queue/stream — SSE emission', () => {
  let server: FastifyInstance;
  let port: number;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    const built = await buildTestServer({ verifyToken: () => void 0 });
    server = built.server;
    port = built.port;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await server.close();
  });

  it('emits `queue.updated` on initial successful poll', async () => {
    const posts = [makePost({ id: 'a' }), makePost({ id: 'b' })];
    fetchMock.mockResolvedValue(mockUpstreamResponse(posts));

    const { body, statusCode } = await readSseFrames(
      port,
      '/api/linkedin/queue/stream?token=t',
      { maxMs: 800 },
    );

    expect(statusCode).toBe(200);
    expect(body).toContain('event: queue.updated');
    expect(body).toContain('"posts"');
    expect(body).toContain('"id":"a"');
    expect(body).toContain('"id":"b"');
  });

  it('does NOT re-emit when upstream response is unchanged', async () => {
    const posts = [makePost({ id: 'a', status: 'DRAFT' })];
    fetchMock.mockResolvedValue(mockUpstreamResponse(posts));

    // Read for ~5.5s — should see initial emit + second poll at t=3s that
    // produces the same hash and does NOT emit.
    const { body } = await readSseFrames(
      port,
      '/api/linkedin/queue/stream?token=t',
      { maxMs: 5_500 },
    );

    const queueUpdatedCount = (body.match(/event: queue\.updated/g) ?? [])
      .length;
    expect(queueUpdatedCount).toBe(1);
  }, 10_000);

  it('re-emits when upstream response changes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockUpstreamResponse([makePost({ id: 'a', status: 'DRAFT' })]),
      )
      .mockResolvedValue(
        mockUpstreamResponse([
          makePost({ id: 'a', status: 'PENDING_VARIANT' }),
        ]),
      );

    const { body } = await readSseFrames(
      port,
      '/api/linkedin/queue/stream?token=t',
      { maxMs: 5_500 },
    );

    const queueUpdatedCount = (body.match(/event: queue\.updated/g) ?? [])
      .length;
    expect(queueUpdatedCount).toBeGreaterThanOrEqual(2);
    expect(body).toContain('DRAFT');
    expect(body).toContain('PENDING_VARIANT');
  }, 10_000);

  it('keeps polling when upstream fails (no crash, then recovery emit)', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(
        mockUpstreamResponse([makePost({ id: 'recovery' })]),
      );

    const { body } = await readSseFrames(
      port,
      '/api/linkedin/queue/stream?token=t',
      { maxMs: 5_500 },
    );

    expect(body).toContain('event: queue.updated');
    expect(body).toContain('recovery');
  }, 10_000);

  it('emits heartbeat comment lines during idle periods', async () => {
    fetchMock.mockResolvedValue(
      mockUpstreamResponse([makePost({ id: 'hb' })]),
    );

    const { body } = await readSseFrames(
      port,
      '/api/linkedin/queue/stream?token=t',
      { maxMs: 16_000 },
    );

    // Comment line format is `: ping\n\n`
    expect(body).toContain(': ping');
  }, 20_000);
});

describe('hashPosts — unit test for the stable hash function', () => {
  it('returns the same hash for the same content', () => {
    const posts = [makePost({ id: 'a', content: 'x' })];
    expect(hashPosts(posts)).toBe(hashPosts(posts));
  });

  it('changes hash when status changes', () => {
    const a = [makePost({ id: 'a', status: 'DRAFT' })];
    const b = [makePost({ id: 'a', status: 'APPROVED' })];
    expect(hashPosts(a)).not.toBe(hashPosts(b));
  });

  it('changes hash when variants.length changes', () => {
    const a = [makePost({ id: 'a', variants: [] })];
    const b = [
      makePost({
        id: 'a',
        variants: [
          {
            id: 1,
            kind: 'contrarian',
            content: 'variant 1',
            image_prompt: null,
            selected: false,
          },
        ],
      }),
    ];
    expect(hashPosts(a)).not.toBe(hashPosts(b));
  });

  it('ignores changes beyond the first 100 chars of content', () => {
    const short = 'x'.repeat(100) + 'A';
    const shortB = 'x'.repeat(100) + 'B';
    const a = [makePost({ id: 'a', content: short })];
    const b = [makePost({ id: 'a', content: shortB })];
    expect(hashPosts(a)).toBe(hashPosts(b));
  });
});
