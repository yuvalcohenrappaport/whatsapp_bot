import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  callUpstream,
  UpstreamError,
  SchemaMismatchError,
  PM_AUTHORITY_BASE_URL,
} from '../client.js';
import { mapUpstreamErrorToReply } from '../errors.js';

const TestSchema = z.object({ status: z.literal('ok'), version: z.string() });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('callUpstream', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the correct URL with a single query param', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ok', version: '0.1.0' }),
    );

    await callUpstream({
      method: 'GET',
      path: '/v1/posts',
      query: { status: 'APPROVED' },
      timeoutMs: 3000,
      responseSchema: TestSchema,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    expect(calledUrl).toBeInstanceOf(URL);
    expect(calledUrl.toString()).toBe(
      `${PM_AUTHORITY_BASE_URL}/v1/posts?status=APPROVED`,
    );
  });

  it('builds the correct URL with a repeated (array) query param', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ok', version: '0.1.0' }),
    );

    await callUpstream({
      method: 'GET',
      path: '/v1/posts',
      query: { status: ['APPROVED', 'DRAFT'] },
      timeoutMs: 3000,
      responseSchema: TestSchema,
    });

    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    // URLSearchParams preserves insertion order for repeated keys
    const params = Array.from(calledUrl.searchParams.entries());
    expect(params).toEqual([
      ['status', 'APPROVED'],
      ['status', 'DRAFT'],
    ]);
  });

  it('passes request body as JSON with content-type header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ok', version: '0.1.0' }, 200),
    );

    await callUpstream({
      method: 'POST',
      path: '/v1/posts/123/edit',
      body: { content: 'hello', content_he: null },
      timeoutMs: 5000,
      responseSchema: TestSchema,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"content":"hello","content_he":null}');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('omits body for GET requests', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ok', version: '0.1.0' }),
    );

    await callUpstream({
      method: 'GET',
      path: '/v1/health',
      body: { should: 'be ignored' },
      timeoutMs: 1000,
      responseSchema: TestSchema,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBeUndefined();
  });

  it('throws SchemaMismatchError when a 2xx body fails responseSchema validation', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'weird', version: 123 }),
    );

    await expect(
      callUpstream({
        method: 'GET',
        path: '/v1/health',
        timeoutMs: 1000,
        responseSchema: TestSchema,
      }),
    ).rejects.toBeInstanceOf(SchemaMismatchError);
  });

  it('throws UpstreamError{kind:http} with status + body on a 404 with a valid error envelope', async () => {
    const envelope = {
      error: {
        code: 'NOT_FOUND',
        message: 'post not found',
        details: {},
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope, 404));

    let caught: unknown;
    try {
      await callUpstream({
        method: 'GET',
        path: '/v1/posts/nope',
        timeoutMs: 3000,
        responseSchema: TestSchema,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UpstreamError);
    const err = caught as UpstreamError;
    expect(err.kind).toBe('http');
    expect(err.status).toBe(404);
    expect(err.body).toEqual(envelope);
  });

  it('throws UpstreamError{kind:connection_refused} when fetch rejects with cause.code === ECONNREFUSED', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8765'), {
      code: 'ECONNREFUSED',
    });
    const fetchErr = Object.assign(new TypeError('fetch failed'), { cause });
    fetchMock.mockRejectedValueOnce(fetchErr);

    let caught: unknown;
    try {
      await callUpstream({
        method: 'GET',
        path: '/v1/health',
        timeoutMs: 1000,
        responseSchema: TestSchema,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UpstreamError);
    const err = caught as UpstreamError;
    expect(err.kind).toBe('connection_refused');
  });

  it('throws UpstreamError{kind:timeout} when fetch rejects with AbortError', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortErr);

    let caught: unknown;
    try {
      await callUpstream({
        method: 'GET',
        path: '/v1/health',
        timeoutMs: 1,
        responseSchema: TestSchema,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UpstreamError);
    expect((caught as UpstreamError).kind).toBe('timeout');
  });

  it('throws UpstreamError{kind:timeout} when fetch rejects with TimeoutError (Node AbortSignal.timeout)', async () => {
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeoutErr);

    let caught: unknown;
    try {
      await callUpstream({
        method: 'GET',
        path: '/v1/health',
        timeoutMs: 1,
        responseSchema: TestSchema,
      });
    } catch (err) {
      caught = err;
    }

    expect((caught as UpstreamError).kind).toBe('timeout');
  });

  it('throws UpstreamError{kind:network} for other fetch TypeErrors', async () => {
    const err = new TypeError('fetch failed');
    fetchMock.mockRejectedValueOnce(err);

    let caught: unknown;
    try {
      await callUpstream({
        method: 'GET',
        path: '/v1/health',
        timeoutMs: 1000,
        responseSchema: TestSchema,
      });
    } catch (e) {
      caught = e;
    }

    expect((caught as UpstreamError).kind).toBe('network');
  });

  it('skips validation for statuses not in validateStatuses', async () => {
    // 202 JobAccepted — not in validateStatuses, so the weird body should NOT throw.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'abc' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await callUpstream({
      method: 'POST',
      path: '/v1/posts/x/regenerate',
      timeoutMs: 5000,
      responseSchema: TestSchema, // would fail on the 202 body, but we opt out
      validateStatuses: [200],
    });

    expect(res.status).toBe(202);
    expect(res.data).toEqual({ job_id: 'abc' });
  });
});

describe('mapUpstreamErrorToReply', () => {
  function mockReply() {
    const reply = {
      status: vi.fn(),
      send: vi.fn(),
    } as unknown as {
      status: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    };
    reply.status.mockReturnValue(reply);
    reply.send.mockReturnValue(reply);
    return reply;
  }

  it('passes HTTP errors through verbatim (status + body)', () => {
    const envelope = { error: { code: 'STATE_VIOLATION', message: 'bad', details: {} } };
    const err = new UpstreamError(409, envelope, 'http', 'upstream 409');
    const reply = mockReply();

    mapUpstreamErrorToReply(err, reply as never);

    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(envelope);
  });

  it('maps timeout to 504 UPSTREAM_FAILURE', () => {
    const err = new UpstreamError(0, null, 'timeout', 'timed out');
    const reply = mockReply();
    mapUpstreamErrorToReply(err, reply as never);
    expect(reply.status).toHaveBeenCalledWith(504);
    const body = reply.send.mock.calls[0][0];
    expect(body.error.code).toBe('UPSTREAM_FAILURE');
  });

  it('maps connection_refused to 503 UNAVAILABLE', () => {
    const err = new UpstreamError(0, null, 'connection_refused', 'nope');
    const reply = mockReply();
    mapUpstreamErrorToReply(err, reply as never);
    expect(reply.status).toHaveBeenCalledWith(503);
    const body = reply.send.mock.calls[0][0];
    expect(body.error.code).toBe('UNAVAILABLE');
  });

  it('maps network errors to 502 UPSTREAM_FAILURE', () => {
    const err = new UpstreamError(0, null, 'network', 'fetch failed');
    const reply = mockReply();
    mapUpstreamErrorToReply(err, reply as never);
    expect(reply.status).toHaveBeenCalledWith(502);
    const body = reply.send.mock.calls[0][0];
    expect(body.error.code).toBe('UPSTREAM_FAILURE');
  });

  it('maps parse errors to 502 UPSTREAM_FAILURE', () => {
    const err = new UpstreamError(0, null, 'parse', 'bad json');
    const reply = mockReply();
    mapUpstreamErrorToReply(err, reply as never);
    expect(reply.status).toHaveBeenCalledWith(502);
  });

  it('maps SchemaMismatchError to 500 INTERNAL_ERROR with path + issues', () => {
    const err = new SchemaMismatchError(
      '/v1/posts/123',
      [{ message: 'expected string' }],
      { id: 123 },
    );
    const reply = mockReply();
    mapUpstreamErrorToReply(err, reply as never);
    expect(reply.status).toHaveBeenCalledWith(500);
    const body = reply.send.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.details.path).toBe('/v1/posts/123');
    expect(body.error.details.issues).toEqual([{ message: 'expected string' }]);
  });

  it('rethrows unknown error types so Fastify default handler catches them', () => {
    const reply = mockReply();
    const weird = new Error('surprise');
    expect(() => mapUpstreamErrorToReply(weird, reply as never)).toThrow(weird);
  });
});
