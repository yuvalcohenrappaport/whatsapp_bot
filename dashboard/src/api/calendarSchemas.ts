/**
 * Dashboard-side Zod schemas for `/api/calendar/*` payloads.
 *
 * Mirrors the server CalendarItem discriminated union and CalendarEnvelope
 * from Plan 44-03's `src/api/routes/calendar.ts` (336 lines).
 *
 * Discriminated on `source: 'task' | 'event' | 'linkedin'`.
 * sourceFields is record<string, unknown> — forward-compatible with
 * server-side additions.
 *
 * Used by:
 *   - useCalendarStream — safeParse on every calendar.updated SSE frame
 *   - Per-source initial-load fetch handlers
 */
import { z } from 'zod';

// Shared base fields across all three source types.
const BaseItemFields = {
  id: z.string(),
  title: z.string(),
  start: z.number(),
  end: z.number().nullable(),
  isAllDay: z.boolean(),
  language: z.enum(['he', 'en', 'mixed']),
  sourceFields: z.record(z.string(), z.unknown()),
} as const;

// Discriminated union — each variant carries source as literal.
export const CalendarItemSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('task'), ...BaseItemFields }),
  z.object({ source: z.literal('event'), ...BaseItemFields }),
  z.object({ source: z.literal('linkedin'), ...BaseItemFields }),
]);

export type CalendarItem = z.infer<typeof CalendarItemSchema>;

// Per-source status values in the unified envelope.
export const SourceStatusSchema = z.enum(['ok', 'error']);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

// Unified envelope from GET /api/calendar/items and SSE calendar.updated.
export const CalendarEnvelopeSchema = z.object({
  items: z.array(CalendarItemSchema),
  sources: z.object({
    tasks: SourceStatusSchema,
    events: SourceStatusSchema,
    linkedin: SourceStatusSchema,
  }),
});
export type CalendarEnvelope = z.infer<typeof CalendarEnvelopeSchema>;

// Per-source route response shape: { items: CalendarItem[] }
// Used for /api/actionables/with-due-dates, /api/personal-calendar/events/window,
// /api/linkedin/posts/scheduled.
export const PerSourceResponseSchema = z.object({
  items: z.array(CalendarItemSchema),
});
export type PerSourceResponse = z.infer<typeof PerSourceResponseSchema>;
