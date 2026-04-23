/**
 * colorForItem — shared source → dot-color resolver.
 *
 * Used by CalendarPill (stripe/background) and MonthDotsView (dot fill).
 * Single source of truth for the source→color palette so it is NOT
 * duplicated between the two components.
 *
 * Phase 50 — extracted from CalendarPill's inline SOURCE_* maps.
 * Phase 46/47 — gtasks + gcal variants. Actual color for those two sources
 * comes from `sourceFields.color` (hashed per listId/calendarId on the
 * server); these entries are fallbacks only.
 */
import type { CalendarItem } from '@/api/calendarSchemas';

export const SOURCE_DOT_COLOR: Record<CalendarItem['source'], string> = {
  task: 'bg-emerald-500',
  event: 'bg-indigo-500',
  linkedin: 'bg-violet-500',
  gtasks: 'bg-sky-500', // fallback only — real color from sourceFields.color
  gcal: 'bg-rose-500', // fallback only — real color from sourceFields.color
} as const;

/**
 * Returns the Tailwind background class for a colored dot matching the
 * item's source (task → emerald, event → indigo, linkedin → violet,
 * gtasks → sky fallback, gcal → rose fallback).
 */
export function dotColorClass(source: CalendarItem['source']): string {
  return SOURCE_DOT_COLOR[source] ?? 'bg-muted-foreground';
}
