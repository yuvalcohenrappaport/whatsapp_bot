import { z } from 'zod';
import pino from 'pino';
import { config } from '../config.js';
import type { PlaceMetadata } from '../db/queries/tripMemory.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Constants ─────────────────────────────────────────────────────────────────
//
// Phase 57 — mirrors Phase 56's placesGeocode.ts auth + header pattern. The
// Places API (New) endpoints use the same X-Goog-Api-Key + X-Goog-FieldMask
// shape; only the URL paths and request bodies differ.

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACES_DETAILS_URL_BASE = 'https://places.googleapis.com/v1/places/';
const HEBREW_REGEX = /[֐-׿]/;

// Field mask for autocomplete — keep narrow, the picker only renders primary +
// secondary text per suggestion row.
const AUTOCOMPLETE_FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.structuredFormat.mainText.text',
  'suggestions.placePrediction.structuredFormat.secondaryText.text',
].join(',');

// Field mask for Place Details — same shape as Phase 56 Text Search so we can
// reuse the GeocodeResult.metadata shape and persist via the same DB columns.
const DETAILS_FIELD_MASK = [
  'id',
  'formattedAddress',
  'location',
  'types',
  'rating',
  'userRatingCount',
  'currentOpeningHours',
  'displayName',
].join(',');

const MAX_SUGGESTIONS = 5;

// ─── Typed error ──────────────────────────────────────────────────────────────

export class PlacesAutocompleteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PlacesAutocompleteError';
  }
}

// ─── Zod schemas — defensive (every nested optional, never .strict()) ─────────

// Autocomplete REST response — Places API (New) Autocomplete shape.
const AutocompleteRawSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string(),
            structuredFormat: z
              .object({
                mainText: z.object({ text: z.string() }).optional(),
                secondaryText: z.object({ text: z.string() }).optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

// Public autocomplete suggestion shape — what the route returns to the dashboard.
export const AutocompleteSuggestionSchema = z.object({
  placeId: z.string(),
  primaryText: z.string(),
  secondaryText: z.string(),
});
export type AutocompleteSuggestion = z.infer<typeof AutocompleteSuggestionSchema>;

// Place Details response — narrow shape matching DETAILS_FIELD_MASK.
const PlaceDetailsRawSchema = z.object({
  id: z.string().optional(),
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
  currentOpeningHours: z.object({ openNow: z.boolean().optional() }).optional(),
  displayName: z.object({ text: z.string().optional() }).optional(),
});

// Public place details result — same shape as GeocodeResult from
// placesGeocode.ts (intentional — Plan 02's PATCH /pin route persists this
// via pinDecision).
export const PlaceDetailsResultSchema = z.object({
  placeId: z.string(),
  canonicalAddress: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  metadata: z.object({
    rating: z.number().nullable(),
    userRatingCount: z.number().nullable(),
    openNow: z.boolean().nullable(),
    types: z.array(z.string()),
    primaryType: z.string().nullable(),
    displayName: z.string().nullable(),
  }),
});
export type PlaceDetailsResult = z.infer<typeof PlaceDetailsResultSchema>;

// ─── Hebrew detection ─────────────────────────────────────────────────────────
//
// Mirrors Phase 56's detectLanguageCode — kept inline so this module is
// independent of placesGeocode.ts (future phases shouldn't have to thread a
// shared util when only one of the modules is needed).

export function detectLanguageCode(query: string): 'iw' | 'en' {
  return HEBREW_REGEX.test(query) ? 'iw' : 'en';
}

// ─── autocompletePlaces ───────────────────────────────────────────────────────

/**
 * Phase 57 — Places API (New) Autocomplete REST.
 *
 * Session tokens: caller-supplied UUID. Per Phase 56 RESEARCH.md, session
 * tokens apply ONLY to the Autocomplete + Place Details call pair — they
 * lower per-keystroke billing. The picker generates one UUID per open and
 * threads it through every keystroke + the final fetchPlaceDetails call.
 *
 * Throws PlacesAutocompleteError on:
 *   - Missing GOOGLE_PLACES_API_KEY (status 412 marker for the route)
 *   - HTTP non-2xx (status carries through)
 *   - Zod parse failure (status 0 — schema drift)
 *
 * Returns [] for zero results (NOT null — easier UX hooks for "No matches").
 * Caps at MAX_SUGGESTIONS (5) regardless of API response length.
 */
export async function autocompletePlaces(
  query: string,
  sessionToken: string,
  languageCode?: 'iw' | 'en',
): Promise<AutocompleteSuggestion[]> {
  const apiKey = config.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new PlacesAutocompleteError(412, 'GOOGLE_PLACES_API_KEY is not set');
  }

  const lang = languageCode ?? detectLanguageCode(query);

  const res = await fetch(PLACES_AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
    },
    body: JSON.stringify({
      input: query,
      languageCode: lang,
      sessionToken,
    }),
  });

  if (!res.ok) {
    throw new PlacesAutocompleteError(
      res.status,
      `Places Autocomplete returned HTTP ${res.status}`,
    );
  }

  const raw: unknown = await res.json();
  const parsed = AutocompleteRawSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues, query },
      'placesAutocomplete: response schema validation failed',
    );
    throw new PlacesAutocompleteError(
      0,
      `Schema validation failed: ${parsed.error.message}`,
    );
  }

  const suggestions = (parsed.data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .slice(0, MAX_SUGGESTIONS)
    .map((p) => ({
      placeId: p.placeId,
      primaryText: p.structuredFormat?.mainText?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
    }));

  return suggestions;
}

// ─── fetchPlaceDetails ────────────────────────────────────────────────────────

/**
 * Phase 57 — Places API (New) Place Details REST.
 *
 * Same session token as the prior autocompletePlaces calls — closes the
 * "session" billing window so all keystrokes + this final fetch count as one
 * billable Autocomplete session.
 *
 * Throws on missing key / HTTP error / schema drift (same contract as
 * autocompletePlaces).
 */
export async function fetchPlaceDetails(
  placeId: string,
  sessionToken: string,
  languageCode?: 'iw' | 'en',
): Promise<PlaceDetailsResult> {
  const apiKey = config.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new PlacesAutocompleteError(412, 'GOOGLE_PLACES_API_KEY is not set');
  }

  // Place Details accepts languageCode + sessionToken as query string params.
  const url = new URL(PLACES_DETAILS_URL_BASE + encodeURIComponent(placeId));
  if (languageCode) url.searchParams.set('languageCode', languageCode);
  url.searchParams.set('sessionToken', sessionToken);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  });

  if (!res.ok) {
    throw new PlacesAutocompleteError(
      res.status,
      `Places Details returned HTTP ${res.status}`,
    );
  }

  const raw: unknown = await res.json();
  const parsed = PlaceDetailsRawSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues, placeId },
      'placesAutocomplete: details schema validation failed',
    );
    throw new PlacesAutocompleteError(
      0,
      `Schema validation failed: ${parsed.error.message}`,
    );
  }

  const p = parsed.data;
  // The API may omit `id` from the body when called via the URL path; fall
  // back to the placeId we requested so callers always have a stable id.
  const id = p.id ?? placeId;

  const metadata: PlaceMetadata = {
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? null,
    openNow: p.currentOpeningHours?.openNow ?? null,
    types: p.types ?? [],
    primaryType: p.types?.[0] ?? null,
    displayName: p.displayName?.text ?? null,
  };

  return {
    placeId: id,
    canonicalAddress: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    metadata,
  };
}
