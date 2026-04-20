/**
 * /calendar — unified read-only calendar page.
 *
 * Three data sources rendered independently:
 *   tasks (emerald) / events (indigo) / linkedin (violet)
 *
 * Per-source loading: each source's skeleton disappears as soon as its
 * own fetch resolves — no source waits for the slowest (CONTEXT §5).
 *
 * Per-source partial failure: compact banners above the calendar with Retry.
 *
 * SSE live updates: unified /api/calendar/stream; "Reconnecting…" amber
 * badge in the header when disconnected.
 *
 * Views: month / week (default) / day with cursor navigation.
 *
 * Zero mutation affordances — Plan 44-05 layers drag/edit/create on top.
 *
 * Plan 44-04.
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useCalendarStream } from '@/hooks/useCalendarStream';
import { CalendarHeader, type CalendarView } from '@/components/calendar/CalendarHeader';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import { DayView } from '@/components/calendar/DayView';
import type { CalendarItem } from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// Arrival flash hook (calendar items)
// -----------------------------------------------------------------------

const FLASH_MS = 300;

function useCalendarArrivalFlash(items: CalendarItem[]): Set<string> {
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const prevIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentIds = new Set(items.map((i) => i.id));

    // Initial seed — don't flash on first render.
    if (prevIds.current === null) {
      prevIds.current = currentIds;
      return;
    }

    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevIds.current.has(id)) newIds.add(id);
    }
    prevIds.current = currentIds;
    if (newIds.size === 0) return;

    setFlashing((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const id of newIds) {
      timers.push(
        setTimeout(() => {
          setFlashing((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, FLASH_MS),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [items]);

  return flashing;
}

// -----------------------------------------------------------------------
// SkeletonCalendar — shown while all three sources are still loading
// -----------------------------------------------------------------------

function SkeletonCalendar() {
  return (
    <div className="flex flex-col gap-2 mt-4">
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-6 rounded" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, col) => (
            <Skeleton key={col} className="h-16 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// SourceBanner — partial failure banner per source
// -----------------------------------------------------------------------

function SourceBanner({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-lg px-3 py-2">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">{label}</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs gap-1"
        onClick={onRetry}
      >
        <RefreshCw className="size-3" />
        Retry
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------

export default function CalendarPage() {
  const [view, setView] = useState<CalendarView>('week');
  const [cursorMs, setCursorMs] = useState(() => Date.now());

  const { tasks, events, linkedin, sseStatus, refetch } = useCalendarStream();

  // Merge all items for the active view.
  const allItems = useMemo(
    () => [...tasks.items, ...events.items, ...linkedin.items].sort((a, b) => a.start - b.start),
    [tasks.items, events.items, linkedin.items],
  );

  const flashingIds = useCalendarArrivalFlash(allItems);

  const allLoading =
    tasks.status === 'loading' &&
    events.status === 'loading' &&
    linkedin.status === 'loading';

  const reconnecting = sseStatus === 'reconnecting';

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header with title + navigation + view switcher */}
      <CalendarHeader
        view={view}
        setView={setView}
        cursorMs={cursorMs}
        setCursorMs={setCursorMs}
        reconnecting={reconnecting}
      />

      {/* Partial-failure banners */}
      <div className="flex flex-col gap-2">
        {tasks.status === 'error' && (
          <SourceBanner
            label="Google Tasks unavailable"
            onRetry={() => refetch('tasks')}
          />
        )}
        {events.status === 'error' && (
          <SourceBanner
            label="Events unavailable"
            onRetry={() => refetch('events')}
          />
        )}
        {linkedin.status === 'error' && (
          <SourceBanner
            label="LinkedIn unavailable"
            onRetry={() => refetch('linkedin')}
          />
        )}
      </div>

      {/* Per-source loading banners (appear while loading, auto-hide on resolve) */}
      {(tasks.status === 'loading' || events.status === 'loading' || linkedin.status === 'loading') && (
        <div className="flex gap-2 text-xs text-muted-foreground">
          {tasks.status === 'loading' && (
            <span className="flex items-center gap-1">
              <Skeleton className="size-2 rounded-full inline-block" />
              Loading tasks…
            </span>
          )}
          {events.status === 'loading' && (
            <span className="flex items-center gap-1">
              <Skeleton className="size-2 rounded-full inline-block" />
              Loading events…
            </span>
          )}
          {linkedin.status === 'loading' && (
            <span className="flex items-center gap-1">
              <Skeleton className="size-2 rounded-full inline-block" />
              Loading LinkedIn…
            </span>
          )}
        </div>
      )}

      {/* Calendar body */}
      {allLoading ? (
        <SkeletonCalendar />
      ) : view === 'month' ? (
        <MonthView
          items={allItems}
          cursorMs={cursorMs}
          flashingIds={flashingIds}
          onDaySlotClick={() => {/* Plan 44-05 */}}
          onOpenItem={() => {/* Plan 44-05 */}}
        />
      ) : view === 'week' ? (
        <WeekView
          items={allItems}
          cursorMs={cursorMs}
          flashingIds={flashingIds}
          onSlotClick={() => {/* Plan 44-05 */}}
          onOpenItem={() => {/* Plan 44-05 */}}
        />
      ) : (
        <DayView
          items={allItems}
          cursorMs={cursorMs}
          flashingIds={flashingIds}
          onSlotClick={() => {/* Plan 44-05 */}}
          onOpenItem={() => {/* Plan 44-05 */}}
        />
      )}

      {/* Empty state — no items at all and not loading */}
      {!allLoading && allItems.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-8">
          Nothing scheduled here. Click any slot to create.
        </div>
      )}
    </div>
  );
}
