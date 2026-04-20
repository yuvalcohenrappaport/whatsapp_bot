/**
 * colorForItem — shared source → dot-color resolver.
 *
 * Used by CalendarPill (stripe/background) and MonthDotsView (dot fill).
 * Single source of truth for the source→color palette so it is NOT
 * duplicated between the two components.
 *
 * Phase 50 — extracted from CalendarPill's inline SOURCE_* maps.
 */
import type { CalendarItem } from '@/api/calendarSchemas';

export const SOURCE_DOT_COLOR: Record<CalendarItem['source'], string> = {
  task: 'bg-emerald-500',
  event: 'bg-indigo-500',
  linkedin: 'bg-violet-500',
} as const;

/**
 * Returns the Tailwind background class for a colored dot matching the
 * item's source (task → emerald, event → indigo, linkedin → violet).
 */
export function dotColorClass(source: CalendarItem['source']): string {
  return SOURCE_DOT_COLOR[source] ?? 'bg-muted-foreground';
}
