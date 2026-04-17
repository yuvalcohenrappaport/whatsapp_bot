/**
 * Write-side proxy routes for /api/linkedin/* — plan 34-03.
 *
 * Registers 8 POST endpoints that proxy mutations to the pm-authority v1
 * HTTP sidecar. Three are synchronous and return the updated PostSchema;
 * five are asynchronous and return 202 JobAcceptedSchema; one (pick-variant)
 * is mixed (200 Post OR 202 JobAccepted depending on whether image gen is
 * required).
 *
 *   1. POST /api/linkedin/posts/:id/approve        → sync  PostSchema
 *   2. POST /api/linkedin/posts/:id/reject         → sync  PostSchema
 *   3. POST /api/linkedin/posts/:id/edit           → sync  PostSchema (body: EditRequestSchema)
 *   4. POST /api/linkedin/posts/:id/regenerate     → 202   JobAcceptedSchema
 *   5. POST /api/linkedin/posts/:id/pick-variant   → mixed 200 Post | 202 JobAccepted
 *   6. POST /api/linkedin/posts/:id/pick-lesson    → 202   JobAcceptedSchema (body: PickLessonRequestSchema)
 *   7. POST /api/linkedin/posts/:id/replace-image  → 202   JobAcceptedSchema (body: ReplaceImageRequestSchema)
 *   8. POST /api/linkedin/lesson-runs              → 202   JobAcceptedSchema (body: StartLessonRunRequestSchema)
 *
 * Contract:
 * - Every route is JWT-protected (onRequest: [fastify.authenticate]).
 * - Request bodies are Zod-validated BEFORE the upstream call. Zod failures
 *   produce a 400 VALIDATION_ERROR envelope shaped identically to
 *   pm-authority's so the dashboard's error discriminator needs no special
 *   case for "who validated first".
 * - Upstream HTTP errors are passed through verbatim (status + body) via
 *   mapUpstreamErrorToReply — REGEN_CAPPED stays 409, STATE_VIOLATION stays
 *   409, LESSON_ALREADY_PICKED stays 409, etc. (SC#3).
 * - Upstream response schema mismatches become 500 INTERNAL_ERROR (SC#2).
 * - All path params are encodeURIComponent-escaped before being interpolated
 *   into the upstream URL.
 *
 * Consumed by src/api/routes/linkedin.ts via registerWriteRoutes().
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  callUpstream,
  PM_AUTHORITY_BASE_URL,
  SchemaMismatchError,
} from '../client.js';
import { mapUpstreamErrorToReply } from '../errors.js';
import {
  ConfirmPiiRequestSchema,
  EditRequestSchema,
  GenerateLessonRunRequestSchema,
  JobAcceptedSchema,
  PickLessonRequestSchema,
  PickVariantRequestSchema,
  PostSchema,
  ReplaceImageRequestSchema,
  StartLessonRunRequestSchema,
} from '../schemas.js';

/** Timeout tiers (ms). Fast sync mutations get 5s; async 202 endpoints get 10s. */
const FAST_MUTATION_TIMEOUT_MS = 5_000;
const SLOW_MUTATION_TIMEOUT_MS = 10_000;

/**
 * Validate a request body with the given Zod schema. On failure, writes a
 * 400 VALIDATION_ERROR envelope to the reply (matching pm-authority's shape)
 * and returns `null` — the caller should bail out immediately. On success,
 * returns the parsed/typed body.
 */
async function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  reply: FastifyReply,
): Promise<T | null> {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'invalid request body',
        details: { issues: result.error.issues },
      },
    });
    return null;
  }
  return result.data;
}

export async function registerWriteRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // ─── Route 1: approve (sync) ────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/linkedin/posts/:id/approve',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: `/v1/posts/${encodeURIComponent(id)}/approve`,
          timeoutMs: FAST_MUTATION_TIMEOUT_MS,
          responseSchema: PostSchema,
        });
        return reply.status(status).send(data);
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Route 2: reject (sync) ─────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/linkedin/posts/:id/reject',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: `/v1/posts/${encodeURIComponent(id)}/reject`,
          timeoutMs: FAST_MUTATION_TIMEOUT_MS,
          responseSchema: PostSchema,
        });
        return reply.status(status).send(data);
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Route 3: edit (sync, body: {content, content_he?}) ─────────────────
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/linkedin/posts/:id/edit',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = await validateBody(
        EditRequestSchema,
        request.body,
        reply,
      );
      if (body === null) return;
      const { id } = request.params;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: `/v1/posts/${encodeURIComponent(id)}/edit`,
          body,
          timeoutMs: FAST_MUTATION_TIMEOUT_MS,
          responseSchema: PostSchema,
        });
        return reply.status(status).send(data);
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Route 4: regenerate (async 202) ────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/linkedin/posts/:id/regenerate',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: `/v1/posts/${encodeURIComponent(id)}/regenerate`,
          timeoutMs: SLOW_MUTATION_TIMEOUT_MS,
          responseSchema: JobAcceptedSchema,
        });
        return reply.status(status).send(data);
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Route 5: pick-variant (MIXED 200 Post | 202 JobAccepted) ───────────
  //
  // pm-authority returns 200 + PostSchema on the fast path (variant picked
  // without image gen) or 202 + JobAcceptedSchema on the slow path (fal.ai
  // image gen needed). We validate the right schema per-status by using
  // validateStatuses:[200] to let callUpstream PostSchema-validate only the
  // 200 branch; the 202 branch is validated explicitly here. Any other 2xx
  // is unexpected and raises a SchemaMismatchError (→ 500).
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/linkedin/posts/:id/pick-variant',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = await validateBody(
        PickVariantRequestSchema,
        request.body,
        reply,
      );
      if (body === null) return;
      const { id } = request.params;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: `/v1/posts/${encodeURIComponent(id)}/pick-variant`,
          body,
          timeoutMs: SLOW_MUTATION_TIMEOUT_MS,
          responseSchema: PostSchema,
          validateStatuses: [200],
        });

        if (status === 200) {
          // Already PostSchema-validated by callUpstream.
          return reply.status(200).send(data);
        }
        if (status === 202) {
          const jobResult = JobAcceptedSchema.safeParse(data);
          if (!jobResult.success) {
            throw new SchemaMismatchError(
              '/v1/posts/:id/pick-variant (202)',
              jobResult.error.issues,
              data,
            );
          }
          return reply.status(202).send(jobResult.data);
        }
        // Any other 2xx is unexpected — treat as schema mismatch.
        throw new SchemaMismatchError(
          '/v1/posts/:id/pick-variant',
          `unexpected status ${status}`,
          data,
        );
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Route 6: pick-lesson (async 202, body: {candidate_id}) ─────────────
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/linkedin/posts/:id/pick-lesson',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = await validateBody(
        PickLessonRequestSchema,
        request.body,
        reply,
      );
      if (body === null) return;
      const { id } = request.params;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: `/v1/posts/${encodeURIComponent(id)}/pick-lesson`,
          body,
          timeoutMs: SLOW_MUTATION_TIMEOUT_MS,
          responseSchema: JobAcceptedSchema,
        });
        return reply.status(status).send(data);
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Route 7: replace-image (async 202, body: {image_path}) ─────────────
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/linkedin/posts/:id/replace-image',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = await validateBody(
        ReplaceImageRequestSchema,
        request.body,
        reply,
      );
      if (body === null) return;
      const { id } = request.params;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: `/v1/posts/${encodeURIComponent(id)}/replace-image`,
          body,
          timeoutMs: SLOW_MUTATION_TIMEOUT_MS,
          responseSchema: JobAcceptedSchema,
        });
        return reply.status(status).send(data);
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Phase 38 — Route 11: lesson-runs/generate (async 202, Phase 1 candidates) ─
  fastify.post<{ Body: unknown }>(
    '/api/linkedin/lesson-runs/generate',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = await validateBody(
        GenerateLessonRunRequestSchema,
        request.body,
        reply,
      );
      if (body === null) return;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: '/v1/lesson-runs/generate',
          body,
          timeoutMs: SLOW_MUTATION_TIMEOUT_MS,
          responseSchema: JobAcceptedSchema,
        });
        return reply.status(status).send(data);
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Route 8: lesson-runs (async 202, no path params) ───────────────────
  //
  // The only route in the phase with NO path params — mounted at exactly
  // /api/linkedin/lesson-runs. Body: StartLessonRunRequestSchema.
  fastify.post<{ Body: unknown }>(
    '/api/linkedin/lesson-runs',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = await validateBody(
        StartLessonRunRequestSchema,
        request.body,
        reply,
      );
      if (body === null) return;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: '/v1/lesson-runs',
          body,
          timeoutMs: SLOW_MUTATION_TIMEOUT_MS,
          responseSchema: JobAcceptedSchema,
        });
        return reply.status(status).send(data);
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Plan 36-01 — Route 9: upload-image (multipart, sync PostSchema) ────
  //
  // Multipart streaming proxy for POST /v1/posts/:id/upload-image. The
  // @fastify/multipart plugin (registered in routes/linkedin.ts) gates the
  // body to fileSize:10MB and files:1, then we forward the single `image`
  // field verbatim to pm-authority via undici's global fetch + FormData.
  // pm-authority is the authority on MIME validation; we only gate size.
  const UPLOAD_IMAGE_TIMEOUT_MS = 15_000; // larger than slow — Tailscale adds latency
  fastify.post<{ Params: { id: string } }>(
    '/api/linkedin/posts/:id/upload-image',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const mp = await request.file();
        if (!mp) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'no multipart file field provided',
              details: { expected_field: 'image' },
            },
          });
        }
        if (mp.fieldname !== 'image') {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: `unexpected field name '${mp.fieldname}' (expected 'image')`,
              details: { received: mp.fieldname },
            },
          });
        }

        // Read the full upload into a Buffer (≤10MB enforced by plugin limits).
        const buf = await mp.toBuffer();
        const blob = new Blob([new Uint8Array(buf)], {
          type: mp.mimetype || 'application/octet-stream',
        });
        const upstreamForm = new FormData();
        upstreamForm.append('image', blob, mp.filename || 'upload.bin');

        let upstreamRes: Response;
        try {
          upstreamRes = await fetch(
            `${PM_AUTHORITY_BASE_URL}/v1/posts/${encodeURIComponent(id)}/upload-image`,
            {
              method: 'POST',
              body: upstreamForm,
              signal: AbortSignal.timeout(UPLOAD_IMAGE_TIMEOUT_MS),
            },
          );
        } catch (fetchErr) {
          // Forward network/timeout failures through the standard mapper.
          return mapUpstreamErrorToReply(fetchErr, reply);
        }

        const upstreamJson = await upstreamRes
          .json()
          .catch(() => null as unknown);
        if (upstreamRes.status >= 400) {
          return reply.status(upstreamRes.status).send(upstreamJson);
        }
        const parsed = PostSchema.safeParse(upstreamJson);
        if (!parsed.success) {
          throw new SchemaMismatchError(
            '/v1/posts/:id/upload-image',
            parsed.error.issues,
            upstreamJson,
          );
        }
        return reply.status(200).send(parsed.data);
      } catch (err) {
        // @fastify/multipart throws an error with code FST_REQ_FILE_TOO_LARGE
        // (message includes 'request file too large') when fileSize is exceeded.
        const msg = err instanceof Error ? err.message : '';
        const code =
          (err as { code?: string } | null | undefined)?.code ?? '';
        if (
          code === 'FST_REQ_FILE_TOO_LARGE' ||
          /file too large|File size limit/i.test(msg)
        ) {
          return reply.status(413).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'image exceeds 10MB limit',
              details: { cap_bytes: 10 * 1024 * 1024 },
            },
          });
        }
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );

  // ─── Plan 36-01 — Route 10: confirm-pii (sync JSON, body: {note?}) ──────
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/linkedin/posts/:id/confirm-pii',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = await validateBody(
        ConfirmPiiRequestSchema,
        request.body ?? {},
        reply,
      );
      if (body === null) return;
      const { id } = request.params;
      try {
        const { status, data } = await callUpstream({
          method: 'POST',
          path: `/v1/posts/${encodeURIComponent(id)}/confirm-pii`,
          body,
          timeoutMs: FAST_MUTATION_TIMEOUT_MS,
          responseSchema: PostSchema,
        });
        return reply.status(status).send(data);
      } catch (err) {
        return mapUpstreamErrorToReply(err, reply);
      }
    },
  );
}
