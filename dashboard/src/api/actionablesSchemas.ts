/**
 * Dashboard-side Zod schemas for `/api/actionables/*` payloads.
 *
 * Mirrors the server row defined in `src/db/schema.ts` lines 253-284
 * (the `actionables` table). Narrow-by-design — validate only what the
 * dashboard actually reads, and use `.passthrough()` on the row object so
 * backend-side additive changes (new columns, new denormalized fields) do
 * NOT break the UI. Plan 43-01's server already emits every column;
 * Plan 43-02 tolerates forward-compatible schema drift.
 *
 * Used by:
 *   - `useActionablesStream` — per-event validation on SSE `actionables.updated`
 *   - Polling fallback — validates `/api/actionables/pending` + `/recent` REST responses
 *
 * The shape of `ActionablesUpdatedPayloadSchema` matches the SSE contract
 * locked in Plan 43-01: `{pending: Actionable[], recent: Actionable[]}`.
 */
import { z } from 'zod';

export const ActionableSchema = z
  .object({
    id: z.string(),
    sourceType: z.enum(['commitment', 'task', 'user_command']),
    sourceContactJid: z.string(),
    sourceContactName: z.string().nullable(),
    sourceMessageId: z.string().nullable(),
    sourceMessageText: z.string(),
    detectedLanguage: z.enum(['he', 'en']),
    originalDetectedTask: z.string(),
    task: z.string(),
    status: z.enum([
      'pending_approval',
      'approved',
      'rejected',
      'fired',
      'expired',
    ]),
    detectedAt: z.number(),
    fireAt: z.number().nullable(),
    enrichedTitle: z.string().nullable(),
    enrichedNote: z.string().nullable(),
    todoTaskId: z.string().nullable(),
    todoListId: z.string().nullable(),
    approvalPreviewMessageId: z.string().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough(); // tolerate forward-compatible new columns from server

export type Actionable = z.infer<typeof ActionableSchema>;

/**
 * SSE payload for the single `actionables.updated` event emitted by
 * `/api/actionables/stream` (Plan 43-01). Both arrays may be empty.
 */
export const ActionablesUpdatedPayloadSchema = z.object({
  pending: z.array(ActionableSchema),
  recent: z.array(ActionableSchema),
});

// ─── Write-action envelopes (Phase 45) ────────────────────────────────
//
// These mirror the HTTP contract frozen by Plan 45-02:
//   POST /api/actionables/:id/approve   → 200 {actionable}
//   POST /api/actionables/:id/reject    → 200 {actionable}
//   POST /api/actionables/:id/edit      → 200 {actionable}  (body: {task})
//   POST /api/actionables/:id/unreject  → 200 {actionable}
//
// 409 envelopes come in two flavors: `already_handled` (cross-surface
// race) and `grace_expired` (unreject past the server-enforced window).
// Both carry the current row so the dashboard can patch its cache
// without a re-fetch.
//
// 503 → `bot_disconnected` (no payload beyond the `error` field).

/** 200 envelope shared by all four write routes. */
export const ActionableResponseSchema = z.object({
  actionable: ActionableSchema,
});
export type ActionableResponse = z.infer<typeof ActionableResponseSchema>;

/**
 * 409 when the row is no longer `pending_approval` (or, for unreject,
 * no longer `rejected`) — typically because a concurrent WhatsApp
 * quoted-reply already handled it. End state is correct; the dashboard
 * must NOT rollback its optimistic removal.
 */
export const AlreadyHandledErrorSchema = z.object({
  error: z.literal('already_handled'),
  currentStatus: z.enum(['approved', 'rejected', 'fired', 'expired']),
  actionable: ActionableSchema.optional(),
});
export type AlreadyHandledError = z.infer<typeof AlreadyHandledErrorSchema>;

/**
 * 409 on unreject only — user clicked Undo after the server's grace
 * window (10s) closed. No rollback; the reject is final.
 */
export const GraceExpiredErrorSchema = z.object({
  error: z.literal('grace_expired'),
  graceMs: z.number(),
  actionable: ActionableSchema.optional(),
});
export type GraceExpiredError = z.infer<typeof GraceExpiredErrorSchema>;

/** 503 when the bot is disconnected (no WhatsApp echo can be sent). */
export const BotDisconnectedErrorSchema = z.object({
  error: z.literal('bot_disconnected'),
});
export type BotDisconnectedError = z.infer<typeof BotDisconnectedErrorSchema>;

/** Body shape for POST /api/actionables/:id/edit — EDIT_TASK_MAX_LEN=500. */
export const EditRequestSchema = z.object({
  task: z.string().trim().min(1).max(500),
});
export type EditRequest = z.infer<typeof EditRequestSchema>;
