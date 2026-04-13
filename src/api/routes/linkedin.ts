/**
 * Fastify plugin mounting the /api/linkedin/* proxy routes.
 *
 * Plan 34-01 only wires the ONE special route — /api/linkedin/health.
 * Plans 34-02 and 34-03 extend this file with read and write endpoints.
 *
 * All routes in this plugin are JWT-guarded via fastify.authenticate
 * (registered by src/api/plugins/jwt.ts).
 */
import type { FastifyInstance } from 'fastify';
import {
  callUpstream,
  SchemaMismatchError,
  UpstreamError,
} from '../linkedin/client.js';
import { registerReadRoutes } from '../linkedin/routes/reads.js';
import { registerWriteRoutes } from '../linkedin/routes/writes.js';
import {
  HealthUpstreamSchema,
  ProxyHealthResponseSchema,
} from '../linkedin/schemas.js';

export default async function linkedinRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/linkedin/health
  //
  // PHASE 34 SC#4 — this endpoint MUST always return HTTP 200 with a
  // stable discriminated-union body, even when pm-authority is down /
  // timing out / returning garbage. The dashboard polls this to decide
  // whether to render a degraded banner, so it needs a reliable
  // "upstream unavailable" signal rather than a spinning request or a 503.
  fastify.get(
    '/api/linkedin/health',
    { onRequest: [fastify.authenticate] },
    async () => {
      try {
        const { data } = await callUpstream({
          method: 'GET',
          path: '/v1/health',
          timeoutMs: 1000,
          responseSchema: HealthUpstreamSchema,
        });
        return ProxyHealthResponseSchema.parse({
          upstream: 'ok',
          detail: data,
        });
      } catch (err) {
        // Map any error from /v1/health into a stable degraded shape.
        let reason:
          | 'connection_refused'
          | 'timeout'
          | 'upstream_5xx'
          | 'schema_mismatch'
          | 'unknown' = 'unknown';

        if (err instanceof SchemaMismatchError) {
          reason = 'schema_mismatch';
        } else if (err instanceof UpstreamError) {
          switch (err.kind) {
            case 'timeout':
              reason = 'timeout';
              break;
            case 'connection_refused':
              reason = 'connection_refused';
              break;
            case 'http':
              // Any HTTP error from /v1/health means "upstream is effectively
              // down for our purposes" — surface that uniformly as upstream_5xx.
              reason = 'upstream_5xx';
              break;
            case 'network':
            case 'parse':
              reason = 'unknown';
              break;
          }
        }

        return ProxyHealthResponseSchema.parse({
          upstream: 'unavailable',
          reason,
        });
      }
    },
  );

  // ─── Plan 34-02: read-side proxy routes ─────────────────────────────────
  // Registers GET /posts, /posts/:id, /posts/:id/image,
  // /posts/:id/lesson-candidates/:cid/image, /jobs/:jobId.
  await registerReadRoutes(fastify);

  // ─── Plan 34-03: write-side proxy routes ───────────────────────────────
  // Registers POST /posts/:id/{approve,reject,edit,regenerate,pick-variant,
  // pick-lesson,replace-image} and POST /lesson-runs.
  await registerWriteRoutes(fastify);
}
