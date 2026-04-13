import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import linkedinRoutes from '../../routes/linkedin.js';

/**
 * Phase 34 SC#4 guard: /api/linkedin/health MUST always return HTTP 200
 * with a stable discriminated-union body. These tests pin the five failure
 * modes (up, refused, timeout, upstream 5xx, schema mismatch) so a future
 * refactor can't accidentally let a 503 or a spinning request leak through
 * to the dashboard.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function buildTestServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  // Stub fastify.authenticate so we don't need a real JWT in tests. This
  // matches the real decorator signature (onRequest hook that 401s).
  fastify.decorate('authenticate', async () => {
    /* always pass */
  });
  await fastify.register(linkedinRoutes);
  await fastify.ready();
  return fastify;
}

describe('GET /api/linkedin/health', () => {
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

  it('upstream healthy → 200 {upstream:"ok", detail:{...}}', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ok', version: '0.1.0', db_ready: true }),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      upstream: 'ok',
      detail: { status: 'ok', version: '0.1.0', db_ready: true },
    });
  });

  it('upstream connection refused → 200 {upstream:"unavailable", reason:"connection_refused"}', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    const fetchErr = Object.assign(new TypeError('fetch failed'), { cause });
    fetchMock.mockRejectedValueOnce(fetchErr);

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      upstream: 'unavailable',
      reason: 'connection_refused',
    });
  });

  it('upstream timeout (AbortError) → 200 {upstream:"unavailable", reason:"timeout"}', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortErr);

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      upstream: 'unavailable',
      reason: 'timeout',
    });
  });

  it('upstream returns 500 → 200 {upstream:"unavailable", reason:"upstream_5xx"}', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'db exploded',
            details: {},
          },
        },
        500,
      ),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      upstream: 'unavailable',
      reason: 'upstream_5xx',
    });
  });

  it('upstream returns 503 → 200 {upstream:"unavailable", reason:"upstream_5xx"} (same bucket)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: { code: 'UNAVAILABLE', message: 'warming up', details: {} },
        },
        503,
      ),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      upstream: 'unavailable',
      reason: 'upstream_5xx',
    });
  });

  it('upstream returns garbage JSON (wrong shape) → 200 {upstream:"unavailable", reason:"schema_mismatch"}', async () => {
    // Valid JSON but doesn't match HealthUpstreamSchema
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ hello: 'world', status: 42 }),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/linkedin/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      upstream: 'unavailable',
      reason: 'schema_mismatch',
    });
  });

  it('health request aims at /v1/health on PM_AUTHORITY_BASE_URL with a short timeout', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ok', version: '0.1.0', db_ready: true }),
    );

    await server.inject({
      method: 'GET',
      url: '/api/linkedin/health',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/v1/health');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    // AbortSignal.timeout() creates an AbortSignal — we can't inspect the
    // actual timeout value, but we can verify a signal was passed.
    expect(init.signal).toBeDefined();
  });
});
