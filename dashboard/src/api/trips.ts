/**
 * Dashboard API client for /api/trips/* endpoints.
 *
 * Uses the shared apiFetch helper from api/client.ts which injects the
 * JWT automatically from localStorage.
 */
import { apiFetch } from '@/api/client';
import {
  BackfillSummarySchema,
  type BackfillSummary,
  AutocompleteResponseSchema,
  type AutocompleteSuggestion,
  PlacePreviewSchema,
  type PlacePreview,
  PinDecisionResponseSchema,
  type PinDecisionResponse,
} from '@/api/tripSchemas';

export async function backfillGeocode(groupJid: string): Promise<BackfillSummary> {
  const json = await apiFetch<unknown>(
    `/api/trips/${encodeURIComponent(groupJid)}/backfill-geocode`,
    { method: 'POST' },
  );
  return BackfillSummarySchema.parse(json);
}

/**
 * Phase 57 — debounced autocomplete typed against the dashboard JWT-gated
 * proxy route. The picker generates one sessionToken per open and reuses
 * it for every keystroke + the final pin call (Places billing optimisation).
 */
export async function autocompletePlaces(
  groupJid: string,
  query: string,
  sessionToken: string,
  languageCode?: 'iw' | 'en',
): Promise<AutocompleteSuggestion[]> {
  const params = new URLSearchParams({ q: query, sessionToken });
  if (languageCode) params.set('languageCode', languageCode);
  const json = await apiFetch<unknown>(
    `/api/trips/${encodeURIComponent(groupJid)}/autocomplete-places?${params.toString()}`,
    { method: 'GET' },
  );
  const parsed = AutocompleteResponseSchema.parse(json);
  return parsed.suggestions;
}

/**
 * Phase 57 — preview fetch (D9 lock). The picker calls this BETWEEN Pick
 * and Save so the optimistic state at Save time can carry real lat/lng.
 * Reuses the SAME sessionToken as the autocomplete keystrokes — Places
 * billing closes the session window when this Place Details call fires.
 */
export async function fetchPlacePreview(
  groupJid: string,
  placeId: string,
  sessionToken: string,
  languageCode?: 'iw' | 'en',
): Promise<PlacePreview> {
  const params = new URLSearchParams({ sessionToken });
  if (languageCode) params.set('languageCode', languageCode);
  const json = await apiFetch<unknown>(
    `/api/trips/${encodeURIComponent(groupJid)}/place/${encodeURIComponent(placeId)}?${params.toString()}`,
    { method: 'GET' },
  );
  return PlacePreviewSchema.parse(json);
}

/**
 * Phase 57 — PATCH a decision's pin. Returns the freshly-pinned canonical
 * decision row (used by useTrip to confirm the optimistic write).
 */
export async function pinDecision(
  groupJid: string,
  decisionId: string,
  body: { placeId: string; sessionToken: string; languageCode?: 'iw' | 'en' },
): Promise<PinDecisionResponse> {
  const json = await apiFetch<unknown>(
    `/api/trips/${encodeURIComponent(groupJid)}/decisions/${encodeURIComponent(decisionId)}/pin`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );
  return PinDecisionResponseSchema.parse(json);
}
