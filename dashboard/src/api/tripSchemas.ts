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
  // Phase 55 v2.1 geo block
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  resolved: z.boolean(),
  createdAt: z.number(),
  // Phase 56 Places API block
  placeId: z.string().nullable(),
  canonicalAddress: z.string().nullable(),
  lookupStatus: z.enum(['pending', 'geocoded', 'no_match', 'skipped', 'error']),
  placeMetadata: z.string().nullable(), // JSON-stringified blob; parse lazily on the FE
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

// ─── BackfillSummary (POST /api/trips/:groupJid/backfill-geocode response) ────

export const BackfillSummarySchema = z.object({
  geocoded: z.number().int().nonnegative(),
  no_match: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type BackfillSummary = z.infer<typeof BackfillSummarySchema>;

// ─── PlaceMetadata (Phase 56 — inner JSON blob of placeMetadata column) ──────

export const PlaceMetadataSchema = z.object({
  rating: z.number().nullable().optional(),
  userRatingCount: z.number().nullable().optional(),
  openNow: z.boolean().nullable().optional(),
  types: z.array(z.string()).default([]),
  primaryType: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
});
export type PlaceMetadata = z.infer<typeof PlaceMetadataSchema>;

export function parsePlaceMetadata(raw: string | null): PlaceMetadata | null {
  if (!raw) return null;
  try {
    const parsed = PlaceMetadataSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ─── Phase 57 Autocomplete (GET /api/trips/:groupJid/autocomplete-places) ────

export const AutocompleteSuggestionSchema = z.object({
  placeId: z.string(),
  primaryText: z.string(),
  secondaryText: z.string(),
});
export type AutocompleteSuggestion = z.infer<typeof AutocompleteSuggestionSchema>;

export const AutocompleteResponseSchema = z.object({
  suggestions: z.array(AutocompleteSuggestionSchema),
});
export type AutocompleteResponse = z.infer<typeof AutocompleteResponseSchema>;

// ─── Phase 57 Place Preview (GET /api/trips/:groupJid/place/:placeId) ───────
//
// Used by the picker between Pick and Save so the optimistic update at Save
// time can carry real lat/lng/canonicalAddress/metadata. Without this
// pre-fetch, the off-map badge can't decrement optimistically (TripMap's
// offMapCount formula is `(d.lat == null || d.lng == null)`) — violating
// CONTEXT D9 which requires the badge to be part of the optimistic update.

export const PlacePreviewMetadataSchema = z.object({
  rating: z.number().nullable(),
  userRatingCount: z.number().nullable(),
  openNow: z.boolean().nullable(),
  types: z.array(z.string()),
  primaryType: z.string().nullable(),
  displayName: z.string().nullable(),
});
export type PlacePreviewMetadata = z.infer<typeof PlacePreviewMetadataSchema>;

export const PlacePreviewSchema = z.object({
  placeId: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  canonicalAddress: z.string().nullable(),
  metadata: PlacePreviewMetadataSchema,
});
export type PlacePreview = z.infer<typeof PlacePreviewSchema>;

// ─── Phase 57 PATCH /pin response (success body) ────────────────────────────

// The server returns the freshly-pinned canonical TripDecision row.
// Reuses the existing TripDecisionSchema (which already covers the Phase 56
// placeId / lookupStatus / canonicalAddress / placeMetadata fields).
export const PinDecisionResponseSchema = z.object({
  decision: TripDecisionSchema,
});
export type PinDecisionResponse = z.infer<typeof PinDecisionResponseSchema>;

// ─── Optimistic pin input (Plan 04's picker → useTrip mutation contract) ────

// The picker hydrates these from the GET /place/:placeId preview before
// calling onSave — useTrip then merges them into the optimistic decision
// row so the map pin moves AND the off-map badge decrements in the SAME
// React tick (CONTEXT D9). The server response then overwrites the
// optimistic row with the canonical row.
export interface PinOptimisticInput {
  placeId: string;
  canonicalAddress: string | null;
  lat: number | null;   // REAL lat from preview (null only when preview itself returned null)
  lng: number | null;   // REAL lng from preview (null only when preview itself returned null)
  primaryType?: string | null;
  rating?: number | null;
  openNow?: boolean | null;
  types?: string[];
  displayName?: string | null;
}

// ─── TypeScript types ─────────────────────────────────────────────────────────

export type TripBundle = z.infer<typeof TripBundleSchema>;
export type TripListEntry = z.infer<typeof TripListEntrySchema>;
export type TripDecision = z.infer<typeof TripDecisionSchema>;
export type BudgetRollup = z.infer<typeof BudgetRollupSchema>;
export type TripCategory = z.infer<typeof TripCategorySchema>;
export type DecisionOrigin = z.infer<typeof DecisionOriginSchema>;
export type TripContext = z.infer<typeof TripContextSchema>;
export type CalendarEventInTrip = z.infer<typeof CalendarEventInTripSchema>;
