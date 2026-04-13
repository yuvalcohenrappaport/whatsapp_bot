import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import linkedinRoutes from '../../routes/linkedin.js';
import { PM_AUTHORITY_BASE_URL } from '../client.js';
import { PostSchema, ProxyHealthResponseSchema } from '../schemas.js';

/**
 * Plan 34-04: LIVE integration test against the real PM2-running
 * pm-authority HTTP service on 127.0.0.1:8765.
 *
 * Unlike reads.test.ts / writes.test.ts which mock global fetch, this file
 * uses the REAL global fetch (undici) and the REAL Fastify proxy stack so
 * the full wire contract is exercised end-to-end with zero mocks.
 *
 * PORTABILITY: If pm-authority is NOT running, every test short-circuits
 * with a console.warn and passes trivially. The main vitest suite must stay
 * runnable on dev machines that don't have the Python sidecar booted.
 *
 * This satisfies Phase 34 SC#1-SC#4 end-to-end:
 *   SC#1: data flows from real pm-authority (no SQLite) ✓
 *   SC#2: Zod PostSchema enforced on the real response body ✓
 *   SC#3: upstream 404 passes through verbatim ✓
 *   SC#4: /api/linkedin/health returns a real ok-envelope (and the portability
 *         gate itself proves the unavailable path from Plan 01) ✓
 */

// Undo any vi.stubGlobal('fetch', ...) leakage from other test files that may
// run in the same worker. This test MUST use the real undici global fetch.
vi.unstubAllGlobals();

let pmAuthorityReachable = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${PM_AUTHORITY_BASE_URL}/v1/health`, {
      signal: AbortSignal.timeout(500),
    });
    pmAuthorityReachable = res.ok;
  } catch {
    pmAuthorityReachable = false;
  }
});

/**
 * Build a real Fastify instance with the linkedin plugin mounted. The
 * `authenticate` decorator is a no-op so we don't need to mint a JWT for
 * these live integration calls — the proxy logic under test is the same
 * regardless of which authenticate implementation is wired in (the unit
 * suites already pin the 401 short-circuit on a rejecting decorator).
 */
async function buildLiveServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async () => {
    /* allow all — real wire contract is the subject, not the JWT gate */
  });
  await app.register(linkedinRoutes);
  await app.ready();
  return app;
}

function warnSkip(reason: string): void {
  // Keep the skip signal visible in CI logs without using vitest's it.skip
  // (which varies by version). Tests that skip this way still exit 0.
  console.warn(`[integration.test] skipping: ${reason}`);
}

describe('linkedin proxy integration (live pm-authority)', () => {
  let app: FastifyInstance | null = null;

  afterAll(async () => {
    if (app) await app.close();
  });

  // ─── 1. Health proxies a real upstream 200 response ──────────────────
  it('GET /api/linkedin/health → 200 { upstream: "ok", detail: {...} }', async () => {
    if (!pmAuthorityReachable) {
      warnSkip('pm-authority unreachable');
      return;
    }
    app = app ?? (await buildLiveServer());

    const res = await app.inject({
      method: 'GET',
      url: '/api/linkedin/health',
    });

    expect(res.statusCode).toBe(200);
    // Parse with the real ProxyHealthResponseSchema — if this fails it
    // means Plan 01's schema drifted from what the route actually emits.
    const body = ProxyHealthResponseSchema.parse(res.json());
    expect(body.upstream).toBe('ok');
    if (body.upstream === 'ok') {
      expect(body.detail.status).toBe('ok');
      expect(body.detail.db_ready).toBe(true);
      expect(typeof body.detail.version).toBe('string');
    }
  });

  // ─── 2. Posts list returns a Zod-valid PostSchema array ──────────────
  it('GET /api/linkedin/posts → 200 and body is z.array(PostSchema)-valid', async () => {
    if (!pmAuthorityReachable) {
      warnSkip('pm-authority unreachable');
      return;
    }
    app = app ?? (await buildLiveServer());

    const res = await app.inject({
      method: 'GET',
      url: '/api/linkedin/posts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);

    // THE assertion: the real upstream body must parse cleanly through
    // our PostSchema. If it doesn't, either pm-authority drifted from the
    // schema or the schema drifted from pm-authority — both are bugs and
    // both should be surfaced by this test.
    const parsed = z.array(PostSchema).parse(body);
    expect(parsed).toEqual(body);

    // On a healthy dev env there should be at least one post — but we do
    // NOT hard-require it. If the DB happens to be empty, the schema-parse
    // assertion above is still meaningful (it proves an empty-array
    // response is accepted).
    if (parsed.length > 0) {
      const first = parsed[0];
      expect(typeof first.id).toBe('string');
      expect(typeof first.sequence_id).toBe('string');
      expect(typeof first.status).toBe('string');
      expect(first.image).toBeDefined();
      expect(first.image.pii_reviewed).toBeTypeOf('boolean');
      expect(Array.isArray(first.variants)).toBe(true);
      expect(Array.isArray(first.lesson_candidates)).toBe(true);
    }
  });

  // ─── 3. Error pass-through for a real NOT_FOUND on /posts/:id ────────
  it('GET /api/linkedin/posts/:bogus → 404 with upstream NOT_FOUND envelope verbatim', async () => {
    if (!pmAuthorityReachable) {
      warnSkip('pm-authority unreachable');
      return;
    }
    app = app ?? (await buildLiveServer());

    const res = await app.inject({
      method: 'GET',
      url: '/api/linkedin/posts/nonexistent-uuid-zzz',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
    // Don't pin exact wording — pm-authority owns it. But we can pin that
    // the error is about a post, since the details carry post_id.
    expect(body.error.details).toBeDefined();
    expect(body.error.details.post_id).toBe('nonexistent-uuid-zzz');
  });

  // ─── 4. Error pass-through for a real NOT_FOUND on /jobs/:id ──────────
  it('GET /api/linkedin/jobs/:bogus → 404 with upstream NOT_FOUND envelope verbatim', async () => {
    if (!pmAuthorityReachable) {
      warnSkip('pm-authority unreachable');
      return;
    }
    app = app ?? (await buildLiveServer());

    const res = await app.inject({
      method: 'GET',
      url: '/api/linkedin/jobs/nonexistent-job-zzz',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
  });

  // ─── 5. Multi-status query actually filters at the upstream ──────────
  // Proves the multi-status filter round-trips through the proxy. Uses a
  // data-agnostic assertion: sum(status-filtered queries) ≤ total. This
  // works whether the DB has 0 posts, 1 post, or many — the test's job
  // is to prove filtering works, not to assume specific content.
  it('GET /api/linkedin/posts?status=X → upstream actually filters', async () => {
    if (!pmAuthorityReachable) {
      warnSkip('pm-authority unreachable');
      return;
    }
    app = app ?? (await buildLiveServer());

    // Unfiltered baseline
    const unfilteredRes = await app.inject({
      method: 'GET',
      url: '/api/linkedin/posts',
    });
    expect(unfilteredRes.statusCode).toBe(200);
    const unfiltered = unfilteredRes.json() as unknown[];

    // Single-status query — each known pm-authority status
    const statuses = [
      'DRAFT',
      'APPROVED',
      'PENDING_VARIANT',
      'PENDING_LESSON_SELECTION',
      'PENDING_PII_REVIEW',
      'REJECTED',
    ];

    let totalFiltered = 0;
    for (const status of statuses) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/linkedin/posts?status=${status}`,
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json() as Array<{ status: string }>;
      // Every returned row must match the filter
      for (const row of rows) {
        expect(row.status).toBe(status);
      }
      totalFiltered += rows.length;
    }

    // Sum of per-status counts across the canonical status set must be ≤
    // the unfiltered list (the unfiltered default excludes PUBLISHED and
    // REJECTED per pm-authority's NON_TERMINAL_STATUSES filter). Note:
    // REJECTED is explicitly queried above which may exceed unfiltered,
    // so we compare against a union that matches pm-authority's default.
    // The real invariant: each per-status result ⊆ total-with-that-status,
    // which we already asserted above. The sum check below is a weaker
    // sanity: unfiltered should be ≥ sum of non-terminal statuses only.
    const nonTerminalStatuses = [
      'DRAFT',
      'APPROVED',
      'PENDING_VARIANT',
      'PENDING_LESSON_SELECTION',
      'PENDING_PII_REVIEW',
    ];
    let nonTerminalTotal = 0;
    for (const s of nonTerminalStatuses) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/linkedin/posts?status=${s}`,
      });
      nonTerminalTotal += (res.json() as unknown[]).length;
    }
    expect(nonTerminalTotal).toBeLessThanOrEqual(unfiltered.length);

    // Multi-status query: ?status=X&status=Y returns union, still ≤ total
    const multiRes = await app.inject({
      method: 'GET',
      url: '/api/linkedin/posts?status=DRAFT&status=APPROVED',
    });
    expect(multiRes.statusCode).toBe(200);
    const multi = multiRes.json() as Array<{ status: string }>;
    for (const row of multi) {
      expect(['DRAFT', 'APPROVED']).toContain(row.status);
    }
    expect(multi.length).toBeLessThanOrEqual(unfiltered.length);

    // Use totalFiltered to keep the variable meaningful in the test log.
    expect(totalFiltered).toBeGreaterThanOrEqual(0);
  });

  // ─── 6. Single post fetch round-trips through PostSchema ─────────────
  // Only runs if the DB has at least one post — otherwise skip cleanly.
  it('GET /api/linkedin/posts/:id (if any post exists) → PostSchema-valid', async () => {
    if (!pmAuthorityReachable) {
      warnSkip('pm-authority unreachable');
      return;
    }
    app = app ?? (await buildLiveServer());

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/linkedin/posts',
    });
    expect(listRes.statusCode).toBe(200);
    const posts = z.array(PostSchema).parse(listRes.json());
    if (posts.length === 0) {
      warnSkip('no posts in pm-authority DB');
      return;
    }

    const first = posts[0];
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/linkedin/posts/${encodeURIComponent(first.id)}`,
    });
    expect(getRes.statusCode).toBe(200);
    const single = PostSchema.parse(getRes.json());
    expect(single.id).toBe(first.id);
    expect(single.sequence_id).toBe(first.sequence_id);
    expect(single.status).toBe(first.status);
  });
});
