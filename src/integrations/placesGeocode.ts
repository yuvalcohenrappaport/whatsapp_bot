import { z } from 'zod';
import pino from 'pino';
import { config } from '../config.js';
import {
  GEOCODEABLE_TYPES,
  PlaceMetadata,
  updateDecisionGeocode,
  getTripContext,
  LookupStatus,
} from '../db/queries/tripMemory.js';
import { db } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { tripDecisions } from '../db/schema.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Constants ─────────────────────────────────────────────────────────────────

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const HEBREW_REGEX = /[֐-׿]/;
const FIELD_MASK = [
  'places.id',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.rating',
  'places.userRatingCount',
  'places.currentOpeningHours',
  'places.displayName',
].join(',');

// ─── Module-level idempotence guard for missing API key warning ────────────────

let warnedNoKey = false;

// ─── Zod schema for Places API (New) Text Search response ─────────────────────

const PlaceItemSchema = z.object({
  id: z.string(),
  formattedAddress: z.string().optional(),
  location: z
    .object({
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    })
    .optional(),
  types: z.array(z.string()).optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  currentOpeningHours: z
    .object({
      openNow: z.boolean().optional(),
    })
    .optional(),
  displayName: z
    .object({
      text: z.string().optional(),
      languageCode: z.string().optional(),
    })
    .optional(),
});

export const PlacesSearchResponseSchema = z.object({
  places: z.array(PlaceItemSchema).optional(),
});

export type PlacesSearchResponse = z.infer<typeof PlacesSearchResponseSchema>;

// ─── Typed error ──────────────────────────────────────────────────────────────

export class PlacesGeocodeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PlacesGeocodeError';
  }
}

// ─── GeocodeResult shape ──────────────────────────────────────────────────────

export interface GeocodeResult {
  placeId: string;
  canonicalAddress: string | null;
  lat: number | null;
  lng: number | null;
  metadata: PlaceMetadata;
}

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Returns 'iw' for Hebrew text, 'en' otherwise.
 * Uses the Unicode Hebrew block range U+0590–U+05FF + Presentation Forms.
 */
export function detectLanguageCode(query: string): 'iw' | 'en' {
  return HEBREW_REGEX.test(query) ? 'iw' : 'en';
}

/**
 * Low-level fetch wrapper for a single Places Text Search call.
 * Throws PlacesGeocodeError on HTTP non-2xx.
 * Throws on parse failure (API schema drift) after logging a warning.
 */
async function callPlacesTextSearch(
  textQuery: string,
  languageCode: 'iw' | 'en',
  apiKey: string,
): Promise<PlacesSearchResponse> {
  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode,
      pageSize: 1,
    }),
  });

  if (!res.ok) {
    throw new PlacesGeocodeError(res.status, `Places API returned HTTP ${res.status}`);
  }

  const raw: unknown = await res.json();
  const parsed = PlacesSearchResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues, textQuery }, 'placesGeocode: response schema validation failed');
    throw new PlacesGeocodeError(0, `Places API response failed schema validation: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * Geocode a single decision value against Google Places Text Search (New).
 *
 * Hybrid fallback: if `value + destination` returns no places and destination
 * is provided, retries with `value` alone before declaring no_match.
 *
 * Returns null on no_match (zero results after fallback).
 * Throws PlacesGeocodeError on HTTP 4xx/5xx or parse failure.
 */
export async function geocodeDecision(
  value: string,
  destination: string | null,
): Promise<GeocodeResult | null> {
  const apiKey = config.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set');
  }

  const primaryQuery = destination ? `${value} ${destination}` : value;
  const langCode = detectLanguageCode(primaryQuery);

  let response = await callPlacesTextSearch(primaryQuery, langCode, apiKey);

  // Hybrid fallback: retry with value alone if the contextual query returned nothing
  if ((!response.places?.length) && destination) {
    response = await callPlacesTextSearch(value, langCode, apiKey);
  }

  const place = response.places?.[0];
  if (!place) return null;

  return {
    placeId: place.id,
    canonicalAddress: place.formattedAddress ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    metadata: {
      rating: place.rating ?? null,
      userRatingCount: place.userRatingCount ?? null,
      openNow: place.currentOpeningHours?.openNow ?? null,
      types: place.types ?? [],
      primaryType: place.types?.[0] ?? null,
      displayName: place.displayName?.text ?? null,
    },
  };
}

/**
 * Fire-and-forget hook called from conflictDetector.runAfterInsert.
 *
 * - Idempotent: skips rows that already have a place_id.
 * - Type-gated: writes 'skipped' for non-geocodeable types, never calls API.
 * - API key gate: if key absent, single warn at startup then no-ops (leaves
 *   lookup_status='pending' for future backfill after key is set).
 * - Never throws — outer catch logs at error level.
 */
export async function runGeocodeAfterInsert(
  groupJid: string,
  decisionId: string,
): Promise<void> {
  try {
    // Fetch the row — select only the fields we need
    const row = db
      .select({
        id: tripDecisions.id,
        type: tripDecisions.type,
        value: tripDecisions.value,
        placeId: tripDecisions.placeId,
      })
      .from(tripDecisions)
      .where(eq(tripDecisions.id, decisionId))
      .get();

    if (!row) return;

    // Idempotence guard: already geocoded
    if (row.placeId !== null) return;

    // Type gate: non-geocodeable types → skipped
    if (!GEOCODEABLE_TYPES.has(row.type)) {
      updateDecisionGeocode(decisionId, 'skipped', null);
      return;
    }

    // API key gate: no-op if key is absent (single warn, leaves 'pending' for backfill)
    const apiKey = config.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      if (!warnedNoKey) {
        warnedNoKey = true;
        logger.warn('placesGeocode: GOOGLE_PLACES_API_KEY is not set — geocoding skipped until key is configured');
      }
      return;
    }

    // Look up destination from trip context
    const destination = getTripContext(groupJid)?.destination ?? null;

    // Geocode and persist result
    try {
      const result = await geocodeDecision(row.value, destination);
      if (result === null) {
        updateDecisionGeocode(decisionId, 'no_match', null);
      } else {
        updateDecisionGeocode(decisionId, 'geocoded', result);
      }
    } catch (err) {
      logger.warn(
        { err, groupJid, decisionId },
        'placesGeocode.runGeocodeAfterInsert failed',
      );
      updateDecisionGeocode(decisionId, 'error', null);
    }
  } catch (err) {
    logger.error(
      { err, groupJid, decisionId },
      'placesGeocode.runGeocodeAfterInsert unexpected error',
    );
  }
}
