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
 * Post schema — ONLY the fields the queue + published tabs read.
 *
 * `variants` and `lesson_candidates` are typed as `z.array(z.any())` because
 * the UI only reads `.length` off them (queue status pill — e.g. "3 variants
 * pending selection"). Validating their inner shape would couple the
 * dashboard to the full variant/lesson contracts unnecessarily.
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
    content: z.string(),
    content_he: z.string().nullable(),
    image: DashboardPostImageSchema.nullable(),
    variants: z.array(z.any()),
    lesson_candidates: z.array(z.any()),
    share_urn: z.string().nullable(),
    published_at: z.string().nullable(),
    created_at: z.string(),
    analytics: DashboardPostAnalyticsSchema.nullable().optional(),
  })
  .passthrough();

export type DashboardPost = z.infer<typeof DashboardPostSchema>;

/**
 * Payload shape for the `queue.updated` SSE event. The server always sends
 * the full non-terminal post list (see Plan 35-02).
 */
export const QueueUpdatedPayloadSchema = z.object({
  posts: z.array(DashboardPostSchema),
});
