/**
 * Dashboard-side Zod schemas for LinkedIn post payloads.
 *
 * These mirror the whatsapp-bot server-side schemas (src/api/linkedin/schemas.ts)
 * but are deliberately narrower: we only validate the fields the dashboard
 * actually consumes. `.passthrough()` on the post object lets future
 * pm-authority fields through unchecked so a backend-side additive change
 * does NOT break the UI.
 *
 * Used by:
 *   - useLinkedInQueueStream (per-event validation on SSE `queue.updated`)
 *   - useLinkedInPublishedHistory (validation on the one-shot PUBLISHED fetch)
 *
 * CONTEXT §4: "Client useLinkedInQueueStream hook with Zod validation per event".
 * CONTEXT §4: "On a Zod parse failure... fall back to polling instead of crashing."
 */
import { z } from 'zod';

/**
 * Analytics sub-schema — all fields nullable because pm-authority persists
 * partial rows (LinkedIn may return only some metrics on a given call).
 * The parent `analytics` field itself is nullable-optional on DashboardPostSchema.
 */
const DashboardPostAnalyticsSchema = z.object({
  impressions: z.number().int().nullable(),
  comments: z.number().int().nullable(),
  reshares: z.number().int().nullable(),
  reactions: z.number().int().nullable(),
  members_reached: z.number().int().nullable(),
});

/**
 * Image sub-schema — the dashboard renders { source, url, pii_reviewed }.
 * `source` drives an optional caption line, `url` is the thumbnail src,
 * `pii_reviewed` gates the PENDING_PII_REVIEW status-pill color.
 */
const DashboardPostImageSchema = z.object({
  source: z.string().nullable(),
  url: z.string().nullable(),
  pii_reviewed: z.boolean(),
});

/**
 * Variant + lesson candidate sub-schemas — Plan 37-01 flip.
 *
 * Wave-1 (this plan) upgrades these from the old `z.array(z.any())` to
 * strongly-typed schemas because Phase 37's lesson-selection page and
 * variant-finalization page consume the inner shape. Plans 37-02 / 37-03
 * read `lesson_text`, `rationale`, `content`, `image_prompt`, `created_at`
 * etc. directly off the parsed payload.
 *
 * `created_at` lives as an ISO string on the wire and is rendered by the
 * shared <GenerationMetadata> component (no transform — date formatting is
 * the consumer's job).
 */
const DashboardVariantSchema = z.object({
  id: z.number().int(),
  kind: z.string(),
  content: z.string(),
  image_prompt: z.string().nullable(),
  selected: z.boolean(),
  created_at: z.string(),
});

const DashboardLessonCandidateSchema = z.object({
  id: z.number().int(),
  lesson_text: z.string(),
  rationale: z.string(),
  image_url: z.string().nullable(),
  selected: z.boolean(),
  created_at: z.string(),
});

/**
 * Post schema — ONLY the fields the queue + published tabs read.
 *
 * Plan 37-01: variants + lesson_candidates upgraded from z.array(z.any())
 * to strongly-typed sub-schemas, and project_name / source_snippet /
 * perspective / language added so the lesson + variant pages can render
 * the locked page header without bouncing elsewhere.
 *
 * `.passthrough()` lets pm-authority add fields (e.g. Phase 36 write-action
 * metadata) without breaking the parse.
 */
export const DashboardPostSchema = z
  .object({
    id: z.string(),
    sequence_id: z.string(),
    position: z.number().int(),
    status: z.string(), // enum-loose for forward compat (Phase 36 may add states)
    // Plan 37-01: surface for lesson page header.
    perspective: z.string(),
    language: z.string(),
    project_name: z.string(),
    source_snippet: z.string().nullable(),
    content: z.string(),
    content_he: z.string().nullable(),
    image: DashboardPostImageSchema.nullable(),
    variants: z.array(DashboardVariantSchema),
    lesson_candidates: z.array(DashboardLessonCandidateSchema),
    // Plan 36-01 drift fix: pm-authority has always sent these on PostDTO
    // (since Phase 33-02), but the dashboard-side Zod parser was missing
    // them. Wave-2 plan 36-03's regeneration cap gate consumes both. The
    // .default()s protect against an older pm-authority build mid-deploy.
    regeneration_count: z.number().int().default(0),
    regeneration_capped: z.boolean().default(false),
    share_urn: z.string().nullable(),
    published_at: z.string().nullable(),
    created_at: z.string(),
    analytics: DashboardPostAnalyticsSchema.nullable().optional(),
  })
  .passthrough();

export type DashboardPost = z.infer<typeof DashboardPostSchema>;
export type DashboardVariant = z.infer<typeof DashboardVariantSchema>;
export type DashboardLessonCandidate = z.infer<typeof DashboardLessonCandidateSchema>;

/**
 * Payload shape for the `queue.updated` SSE event. The server always sends
 * the full non-terminal post list (see Plan 35-02).
 */
export const QueueUpdatedPayloadSchema = z.object({
  posts: z.array(DashboardPostSchema),
});
