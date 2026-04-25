/**
 * Dashboard API client for /api/trips/* endpoints.
 *
 * Uses the shared apiFetch helper from api/client.ts which injects the
 * JWT automatically from localStorage.
 */
import { apiFetch } from '@/api/client';
import { BackfillSummarySchema, type BackfillSummary } from '@/api/tripSchemas';

export async function backfillGeocode(groupJid: string): Promise<BackfillSummary> {
  const json = await apiFetch<unknown>(
    `/api/trips/${encodeURIComponent(groupJid)}/backfill-geocode`,
    { method: 'POST' },
  );
  return BackfillSummarySchema.parse(json);
}
