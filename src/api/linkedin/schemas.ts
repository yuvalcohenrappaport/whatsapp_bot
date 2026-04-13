/**
 * Zod v4 schemas mirroring the pm-authority HTTP sidecar v1 contract.
 *
 * Source of truth: /home/yuval/pm-authority/services/http/schemas.py and
 * /home/yuval/pm-authority/services/http/errors.py.
 *
 * Wire format is snake_case (matches pm-authority internal column names).
 * Timestamps are ISO 8601 strings — NOT transformed to Date; the dashboard
 * formats them as it likes.
 *
 * Conventions in this file:
 * - Response schemas are PERMISSIVE (no .strict) — pm-authority may add
 *   fields later and we'd rather log-warn than hard-fail.
 * - Request body schemas ARE .strict() — reject dashboard bugs early.
 * - All field names kept snake_case so the dashboard can import these
 *   schemas directly for typed fetching.
 */
import { z } from 'zod';

// ─── Error envelope (matches services/http/errors.py) ────────────────────────

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'STATE_VIOLATION',
  'REGEN_CAPPED',
  'LESSON_ALREADY_PICKED',
  'VARIANT_ALREADY_PICKED',
  'UNPROCESSABLE',
  'INTERNAL_ERROR',
  'UPSTREAM_FAILURE',
  'UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const ErrorEnvelopeSchema = z.object({
  error: ErrorDetailSchema,
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

// ─── Upstream /v1/health raw body ────────────────────────────────────────────

export const HealthUpstreamSchema = z.object({
  status: z.enum(['ok', 'starting']),
  version: z.string(),
  db_ready: z.boolean(),
});
export type HealthUpstream = z.infer<typeof HealthUpstreamSchema>;

// ─── Core DTOs ───────────────────────────────────────────────────────────────

export const VariantSchema = z.object({
  id: z.number().int(),
  kind: z.string(),
  content: z.string(),
  image_prompt: z.string().nullable(),
  selected: z.boolean(),
});
export type Variant = z.infer<typeof VariantSchema>;

export const LessonCandidateSchema = z.object({
  id: z.number().int(),
  lesson_text: z.string(),
  rationale: z.string(),
  image_url: z.string().nullable(),
  selected: z.boolean(),
});
export type LessonCandidate = z.infer<typeof LessonCandidateSchema>;

export const ImageInfoSchema = z.object({
  // NOTE: Pydantic ImageInfoDTO.filesystem_path is Field(exclude=True) and
  // NEVER appears on the wire — it is intentionally absent here.
  source: z.enum(['ai', 'screenshot']).nullable(),
  url: z.string().nullable(),
  pii_reviewed: z.boolean(),
});
export type ImageInfo = z.infer<typeof ImageInfoSchema>;

/**
 * Mirrors Pydantic PostDTO. Timestamps stay as strings; `created_at` is
 * required (sourced from sequences.created_at), `updated_at` is always null
 * in v1 (no column in pm-authority state.db).
 */
export const PostSchema = z.object({
  id: z.string(),
  sequence_id: z.string(),
  position: z.number().int(),
  status: z.string(),
  perspective: z.string(),
  language: z.string(),
  content: z.string(),
  content_he: z.string().nullable(),
  image: ImageInfoSchema,
  variants: z.array(VariantSchema),
  lesson_candidates: z.array(LessonCandidateSchema),
  regeneration_count: z.number().int(),
  regeneration_capped: z.boolean(),
  share_urn: z.string().nullable(),
  scheduled_at: z.iso.datetime({ offset: true }).nullable(),
  published_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }).nullable(),
});
export type Post = z.infer<typeof PostSchema>;

// ─── Jobs ────────────────────────────────────────────────────────────────────

export const JobStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: JobStatusSchema,
  result: z.record(z.string(), z.unknown()).nullable(),
  error: ErrorDetailSchema.nullable(),
  started_at: z.iso.datetime({ offset: true }),
  finished_at: z.iso.datetime({ offset: true }).nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export const JobAcceptedSchema = z.object({
  job_id: z.string(),
});
export type JobAccepted = z.infer<typeof JobAcceptedSchema>;

// ─── Request bodies (strict — reject dashboard bugs early) ───────────────────

export const EditRequestSchema = z
  .object({
    content: z.string().min(1),
    content_he: z.string().nullable().optional(),
  })
  .strict();
export type EditRequest = z.infer<typeof EditRequestSchema>;

export const ReplaceImageRequestSchema = z
  .object({
    image_path: z.string().min(1),
  })
  .strict();
export type ReplaceImageRequest = z.infer<typeof ReplaceImageRequestSchema>;

export const PickVariantRequestSchema = z
  .object({
    variant_id: z.number().int(),
  })
  .strict();
export type PickVariantRequest = z.infer<typeof PickVariantRequestSchema>;

export const PickLessonRequestSchema = z
  .object({
    candidate_id: z.number().int(),
  })
  .strict();
export type PickLessonRequest = z.infer<typeof PickLessonRequestSchema>;

export const StartLessonRunRequestSchema = z
  .object({
    source_sequence_id: z.string().min(1),
    chosen_lesson: z.string().min(1),
    perspective: z.string().optional(),
    language: z.string().optional(),
  })
  .strict();
export type StartLessonRunRequest = z.infer<typeof StartLessonRunRequestSchema>;

// ─── Query strings ───────────────────────────────────────────────────────────

/**
 * Accepts either `?status=X` (single string) or `?status=X&status=Y` (array).
 * Normalizes to `string[] | undefined` downstream.
 */
export const ListPostsQuerySchema = z
  .object({
    status: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        return Array.isArray(v) ? v : [v];
      }),
  })
  .strict();
export type ListPostsQuery = z.infer<typeof ListPostsQuerySchema>;

// ─── Proxy-level health (OUR shape, not upstream's) ──────────────────────────

/**
 * The whatsapp-bot /api/linkedin/health response. Always 200 regardless of
 * upstream state — the dashboard polls this to decide whether to render a
 * degraded banner, so we need a reliable "upstream is down" signal rather
 * than a spinning request.
 */
export const ProxyHealthResponseSchema = z.discriminatedUnion('upstream', [
  z.object({
    upstream: z.literal('ok'),
    detail: HealthUpstreamSchema,
  }),
  z.object({
    upstream: z.literal('unavailable'),
    reason: z.enum([
      'connection_refused',
      'timeout',
      'upstream_5xx',
      'schema_mismatch',
      'unknown',
    ]),
  }),
]);
export type ProxyHealthResponse = z.infer<typeof ProxyHealthResponseSchema>;
