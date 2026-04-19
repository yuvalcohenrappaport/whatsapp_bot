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
