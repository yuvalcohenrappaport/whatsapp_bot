/**
 * SSE stream route for /api/linkedin/queue/stream — plan 35-02.
 *
 * Contract:
 * - JWT-protected via ?token=<jwt> query string. EventSource cannot set
 *   custom headers, so we mirror the /api/status/stream pattern and verify
 *   the token manually before opening the SSE connection. A missing or
 *   invalid token returns 401 with an error body.
 * - Immediately after auth, writes SSE framing headers (text/event-stream +
 *   no-cache + keep-alive), flushes them, and enters the polling loop.
 * - Every POLL_INTERVAL_MS (3 seconds) the loop hits pm-authority's
 *   GET /v1/posts (default non-terminal filter) via the existing callUpstream
 *   helper, sha1-hashes a stable subset of each post, and emits an
 *   `event: queue.updated` frame iff the hash changed since the last emit.
 * - The FIRST successful poll always emits (seeds the client state).
 * - A heartbeat `: ping\n\n` comment frame is written every HEARTBEAT_INTERVAL_MS
 *   (15 seconds) regardless of content changes — keeps reverse proxies from
 *   dropping idle connections.
 * - On upstream error (timeout, connection refused, schema mismatch, 5xx),
 *   the loop logs a warning and KEEPS RUNNING. The next 3s tick may succeed.
 *   No event is emitted on error — stale data is better than crashing the stream.
 * - When the client disconnects (`request.raw.on('close')`), the interval
 *   is cleared and any in-flight fetch is left to abort on its own timeout
 *   (Node 20 + AbortSignal.timeout cleans up automatically).
 *
 * Why polling instead of pushing from pm-authority:
 *   - pm-authority's writes (ReviewManager, generator) are synchronous
 *     Python calls that don't emit events. Adding an event bus is Phase 36+
 *     scope if ever.
 *   - Localhost calls are ~5ms; 3s polling = 0.17% CPU for a single worker.
 *   - Catches state changes driven by CLI (generate.py, review/cli.py)
 *     without any plumbing.
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { callUpstream, SchemaMismatchError, UpstreamError } from '../client.js';
import { PostSchema } from '../schemas.js';
import type { Post } from '../schemas.js';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 3_000; // same as interval — prevents pileup
const HEARTBEAT_INTERVAL_MS = 15_000;

const PostArraySchema = z.array(PostSchema);

/**
 * Stable content hash of a post list — catches every UI-visible change
 * (status, content, variant count, lesson count, image url) but ignores
 * fields that would cause spurious re-emits (e.g. analytics.fetched_at
 * drifts for published posts every refresh-cycle in future phases).
 */
export function hashPosts(posts: Post[]): string {
  const stable = posts.map((p) => [
    p.id,
    p.status,
    p.content.slice(0, 100),
    p.variants.length,
    p.lesson_candidates.length,
    p.image?.url ?? null,
  ]);
  return createHash('sha1').update(JSON.stringify(stable)).digest('hex');
}

/** Marshalling: turn an array of posts into an SSE event frame. */
function buildQueueUpdatedFrame(posts: Post[]): string {
  const payload = JSON.stringify({ posts });
  return `event: queue.updated\ndata: ${payload}\n\n`;
}

export async function registerStreamRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get('/api/linkedin/queue/stream', async (request, reply) => {
    // ─── JWT gate (EventSource can't send headers) ─────────────────────
    const { token } = request.query as { token?: string };
    try {
      fastify.jwt.verify(token ?? '');
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // ─── SSE framing ────────────────────────────────────────────────────
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    // X-Accel-Buffering: no tells nginx (if ever deployed behind it) to
    // stream instead of buffering. Cheap defense, no cost.
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    // ─── Per-connection state ───────────────────────────────────────────
    let lastHash: string | null = null;
    let closed = false;

    const writeFrame = (frame: string): void => {
      if (closed) return;
      try {
        reply.raw.write(frame);
      } catch {
        // Writing to a dead socket — mark closed and let the cleanup fire.
        closed = true;
      }
    };

    // ─── Upstream poll + emit ───────────────────────────────────────────
    const pollOnce = async (): Promise<void> => {
      if (closed) return;
      try {
        const { data: posts } = await callUpstream({
          method: 'GET',
          path: '/v1/posts',
          timeoutMs: POLL_TIMEOUT_MS,
          responseSchema: PostArraySchema,
        });
        const hash = hashPosts(posts);
        if (hash !== lastHash) {
          lastHash = hash;
          writeFrame(buildQueueUpdatedFrame(posts));
        }
      } catch (err) {
        // Swallow and keep polling — the next tick may succeed.
        // Do NOT emit an event; the client's last-known-good state
        // stays on screen.
        const label =
          err instanceof SchemaMismatchError
            ? 'schema_mismatch'
            : err instanceof UpstreamError
              ? err.kind
              : 'unknown';
        fastify.log.warn(
          { err, label },
          '[linkedin-stream] upstream poll failed; will retry',
        );
      }
    };

    // Kick off the first poll immediately — seeds the client state.
    void pollOnce();

    const pollInterval = setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);

    const heartbeatInterval = setInterval(() => {
      writeFrame(': ping\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    // ─── Cleanup on client disconnect ───────────────────────────────────
    request.raw.on('close', () => {
      closed = true;
      clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
    });
  });
}
