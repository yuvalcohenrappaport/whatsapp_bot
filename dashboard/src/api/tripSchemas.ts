/**
 * Dashboard-side Zod schemas for `/api/trips/*` payloads.
 *
 * Mirrors the server TripBundle / TripListEntry / BudgetRollup shapes from
 * Plan 55-02's `src/api/routes/trips.ts` and `src/db/queries/tripMemory.ts`.
 *
 * Key shape decisions:
 * - `metadata` kept as JSON string (mirrors DB column — the FE doesn't parse it)
 * - `budgetByCategory` kept as JSON string on TripContextSchema (mirrors DB column)
 * - `conflictsWith` kept as JSON string (mirrors DB column, id[] serialised by SQLite)
 * - BudgetRollup uses `z.record(z.string(), z.number())` — all 7 categories always
 *   present as numbers (the backend fills zeros for unset categories)
 *
 * Used by:
 *   - useTrip — safeParse on initial fetch + every trip.updated SSE frame
 *   - TripsList — safeParse on /api/trips list response
 */
import { z } from 'zod';

// ─── Enum schemas ─────────────────────────────────────────────────────────────

export const DecisionOriginSchema = z.enum([
  'inferred',
  'self_reported',
  'multimodal',
  'dashboard',
]);

export const TripCategorySchema = z.enum([
  'flights',
  'lodging',
  'food',
  'activities',
  'transit',
  'shopping',
  'other',
]);

export const DecisionStatusSchema = z.enum(['active', 'deleted']);

// ─── TripDecision ─────────────────────────────────────────────────────────────

export const TripDecisionSchema = z.object({
  id: z.string(),
  groupJid: z.string(),
  type: z.string(),
  value: z.string(),
  confidence: z.string(),
  sourceMessageId: z.string().nullable(),
  proposedBy: z.string().nullable(),
  category: TripCategorySchema.nullable(),
  costAmount: z.number().nullable(),
  costCurrency: z.string().nullable(),
  conflictsWith: z.string(), // JSON-stringified id[] from the DB row
  origin: DecisionOriginSchema,
  metadata: z.string().nullable(), // JSON-stringified blob
  archived: z.boolean(),
  status: DecisionStatusSchema,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  resolved: z.boolean(),
  createdAt: z.number(),
});

// ─── TripContext ──────────────────────────────────────────────────────────────

export const TripContextSchema = z.object({
  groupJid: z.string(),
  destination: z.string().nullable(),
  dates: z.string().nullable(),
  contextSummary: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  budgetByCategory: z.string(), // JSON-stringified Partial<Record<TripCategory, number>>
  calendarId: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  briefingTime: z.string().nullable(),
  metadata: z.string().nullable(),
  updatedAt: z.number(),
});

// ─── CalendarEvent (trip-scoped) ──────────────────────────────────────────────

// Matches calendarEvents table columns returned in TripBundle.calendarEvents
export const CalendarEventInTripSchema = z.object({
  id: z.string(),
  groupJid: z.string(),
  messageId: z.string(),
  calendarId: z.string(),
  calendarEventId: z.string(),
  confirmationMsgId: z.string().nullable(),
  title: z.string(),
  eventDate: z.number(), // unix ms
  createdAt: z.number(),
});

// ─── Budget rollup ────────────────────────────────────────────────────────────

// All seven TripCategory keys are always present (backend fills zeros).
export const BudgetRollupSchema = z.object({
  targets: z.record(z.string(), z.number()),
  spent: z.record(z.string(), z.number()),
  remaining: z.record(z.string(), z.number()),
});

// ─── TripBundle ───────────────────────────────────────────────────────────────

export const TripBundleSchema = z.object({
  context: TripContextSchema.nullable(),
  readOnly: z.boolean(),
  decisions: z.array(TripDecisionSchema),
  openQuestions: z.array(TripDecisionSchema),
  calendarEvents: z.array(CalendarEventInTripSchema),
  budget: BudgetRollupSchema,
});

// ─── TripListEntry ────────────────────────────────────────────────────────────

export const TripListEntrySchema = z.object({
  groupJid: z.string(),
  destination: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: z.string(), // 'active' | 'archived' (string, not enum — archive rows use 'archived' literal)
  archivedAt: z.number().nullable(),
});

export const TripsListResponseSchema = z.object({
  trips: z.array(TripListEntrySchema),
});

// ─── TypeScript types ─────────────────────────────────────────────────────────

export type TripBundle = z.infer<typeof TripBundleSchema>;
export type TripListEntry = z.infer<typeof TripListEntrySchema>;
export type TripDecision = z.infer<typeof TripDecisionSchema>;
export type BudgetRollup = z.infer<typeof BudgetRollupSchema>;
export type TripCategory = z.infer<typeof TripCategorySchema>;
export type DecisionOrigin = z.infer<typeof DecisionOriginSchema>;
export type TripContext = z.infer<typeof TripContextSchema>;
export type CalendarEventInTrip = z.infer<typeof CalendarEventInTripSchema>;
