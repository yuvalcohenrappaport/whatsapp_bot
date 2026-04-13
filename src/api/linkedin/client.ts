/**
 * Upstream HTTP client for the pm-authority v1 API.
 *
 * Wraps the native global `fetch` (Node 20 / undici) with:
 * - Per-call AbortSignal.timeout — no shared defaults, callers specify.
 * - Response body Zod validation (via opt-in responseSchema).
 * - Error classification (http | timeout | connection_refused | network | parse).
 * - SchemaMismatchError distinct from UpstreamError so routes can map it
 *   to HTTP 500 rather than passing it through as if pm-authority failed.
 *
 * The route layer catches these errors and translates them via
 * mapUpstreamErrorToReply() (see ./errors.ts).
 */
import type { z } from 'zod';

export const PM_AUTHORITY_BASE_URL =
  process.env.PM_AUTHORITY_BASE_URL ?? 'http://127.0.0.1:8765';

export type UpstreamErrorKind =
  | 'http'
  | 'timeout'
  | 'connection_refused'
  | 'network'
  | 'parse';

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly kind: UpstreamErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class SchemaMismatchError extends Error {
  constructor(
    public readonly path: string,
    public readonly zodIssues: unknown,
    public readonly rawBody: unknown,
  ) {
    super(`Upstream response schema mismatch at ${path}`);
    this.name = 'SchemaMismatchError';
  }
}

export interface CallUpstreamOptions<TResp> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Leading slash, e.g. '/v1/posts'. */
  path: string;
  query?: Record<string, string | string[] | undefined>;
  /** JSON-serializable body (omitted for GET). */
  body?: unknown;
  /** Required — callers MUST pick a timeout tier. */
  timeoutMs: number;
  responseSchema: z.ZodType<TResp>;
  /**
   * If set, ONLY these 2xx statuses are validated against responseSchema.
   * Other 2xx statuses return raw parsed JSON unchecked. Useful for
   * 202 JobAccepted vs 200 Post where both are success but different shapes.
   */
  validateStatuses?: number[];
}

interface UndiciError extends Error {
  cause?: { code?: string } & Record<string, unknown>;
}

/**
 * Classify a thrown fetch error into our kind taxonomy. The caller is
 * responsible for wrapping this into an UpstreamError (we return the parts).
 */
function classifyFetchFailure(err: unknown): {
  kind: UpstreamErrorKind;
  message: string;
} {
  if (err instanceof Error && err.name === 'AbortError') {
    return { kind: 'timeout', message: 'upstream request timed out' };
  }
  // Node's AbortSignal.timeout rejects with a TimeoutError (DOMException).
  if (err instanceof Error && err.name === 'TimeoutError') {
    return { kind: 'timeout', message: 'upstream request timed out' };
  }
  const cause = (err as UndiciError)?.cause?.code;
  if (cause === 'ECONNREFUSED') {
    return {
      kind: 'connection_refused',
      message: 'pm-authority is not reachable',
    };
  }
  const msg =
    err instanceof Error ? err.message : 'unknown fetch failure';
  return { kind: 'network', message: msg };
}

function buildUrl(
  path: string,
  query?: Record<string, string | string[] | undefined>,
): URL {
  const url = new URL(path, PM_AUTHORITY_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.append(key, value);
      }
    }
  }
  return url;
}

async function readErrorBody(response: Response): Promise<unknown> {
  // Try JSON first (pm-authority always emits JSON envelopes on errors).
  // Fall back to text if the upstream sent something unexpected.
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return await response.text().catch(() => null);
    }
  }
  try {
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Make a JSON request to pm-authority with timeout + schema validation.
 *
 * @throws UpstreamError on non-2xx, timeout, connection refusal, network errors, parse errors.
 * @throws SchemaMismatchError on 2xx where the body fails responseSchema.parse().
 */
export async function callUpstream<TResp>(
  opts: CallUpstreamOptions<TResp>,
): Promise<{ status: number; data: TResp }> {
  const url = buildUrl(opts.path, opts.query);
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.method !== 'GET' && opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: opts.method,
      headers,
      body,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const { kind, message } = classifyFetchFailure(err);
    throw new UpstreamError(0, null, kind, message);
  }

  if (!response.ok) {
    const errBody = await readErrorBody(response);
    throw new UpstreamError(
      response.status,
      errBody,
      'http',
      `upstream ${opts.method} ${opts.path} returned ${response.status}`,
    );
  }

  // 2xx success — read and (optionally) validate the JSON body.
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid JSON';
    throw new UpstreamError(
      response.status,
      null,
      'parse',
      `upstream ${opts.path} returned non-JSON body: ${msg}`,
    );
  }

  const shouldValidate =
    opts.validateStatuses === undefined ||
    opts.validateStatuses.includes(response.status);

  if (!shouldValidate) {
    return { status: response.status, data: parsed as TResp };
  }

  const result = opts.responseSchema.safeParse(parsed);
  if (!result.success) {
    throw new SchemaMismatchError(opts.path, result.error.issues, parsed);
  }
  return { status: response.status, data: result.data };
}

/**
 * Raw streaming helper for binary responses (e.g. images). Does NOT parse
 * the body — the caller is responsible for piping `response.body` to the
 * Fastify reply. Errors are still classified the same way.
 */
export async function streamUpstream(
  method: 'GET',
  path: string,
  opts: { timeoutMs: number },
): Promise<Response> {
  const url = buildUrl(path);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const { kind, message } = classifyFetchFailure(err);
    throw new UpstreamError(0, null, kind, message);
  }
  if (!response.ok) {
    const errBody = await readErrorBody(response);
    throw new UpstreamError(
      response.status,
      errBody,
      'http',
      `upstream ${method} ${path} returned ${response.status}`,
    );
  }
  return response;
}
