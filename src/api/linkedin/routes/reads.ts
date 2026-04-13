/**
 * Read-side proxy routes for /api/linkedin/* — plan 34-02.
 *
 * Registers 5 GET endpoints that proxy to pm-authority's v1 HTTP sidecar:
 *   1. GET /api/linkedin/posts                                 → /v1/posts
 *   2. GET /api/linkedin/posts/:id                             → /v1/posts/:id
 *   3. GET /api/linkedin/posts/:id/image                       → /v1/posts/:id/image         (binary stream)
 *   4. GET /api/linkedin/posts/:id/lesson-candidates/:cid/image (binary stream)
 *   5. GET /api/linkedin/jobs/:jobId                            → /v1/jobs/:jobId
 *
 * Contract:
 * - Every route is JWT-protected (onRequest: [fastify.authenticate]).
 * - JSON routes validate the upstream response with a Zod schema;
 *   a schema mismatch becomes a 500 INTERNAL_ERROR envelope (SC#2).
 * - Upstream HTTP errors are passed through verbatim (status + body) via
 *   mapUpstreamErrorToReply — 404s stay 404s with the upstream envelope (SC#3).
 * - Image routes stream the upstream response body directly to the reply
 *   without buffering, preserving content-type and content-length.
 * - All path params are encodeURIComponent-escaped before being interpolated
 *   into the upstream URL — prevents path traversal if a caller smuggles a
 *   slash into an id.
 *
 * This file is consumed by src/api/routes/linkedin.ts via registerReadRoutes().
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { callUpstream } from '../client.js';
import { mapUpstreamErrorToReply } from '../errors.js';
import {
  JobSchema,
  ListPostsQuerySchema,
  PostSchema,
} from '../schemas.js';

/** Timeout tier (ms). JSON reads are fast; image streams (task 2) get 30s. */
const JSON_READ_TIMEOUT_MS = 3_000;

const PostArraySchema = z.array(PostSchema);

export async function registerReadRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // ─── Route 1: list posts ────────────────────────────────────────────────
  fastify.get(
    '/api/linkedin/posts',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = ListPostsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'invalid query',
            details: { issues: parsed.error.issues },
          },
        });
      }
      try {
        const { data } = await callUpstream({
          method: 'GET',
          path: '/v1/posts',
          query: parsed.data.status ? { status: parsed.data.status } : undefined,
          timeoutMs: JSON_READ_TIMEOUT_MS,
          responseSchema: PostArraySchema,
        });
        return data;
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Route 2: get a single post ─────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/api/linkedin/posts/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const { data } = await callUpstream({
          method: 'GET',
          path: `/v1/posts/${encodeURIComponent(id)}`,
          timeoutMs: JSON_READ_TIMEOUT_MS,
          responseSchema: PostSchema,
        });
        return data;
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Route 5: poll a job ────────────────────────────────────────────────
  fastify.get<{ Params: { jobId: string } }>(
    '/api/linkedin/jobs/:jobId',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { jobId } = request.params;
      try {
        const { data } = await callUpstream({
          method: 'GET',
          path: `/v1/jobs/${encodeURIComponent(jobId)}`,
          timeoutMs: JSON_READ_TIMEOUT_MS,
          responseSchema: JobSchema,
        });
        return data;
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );
}

