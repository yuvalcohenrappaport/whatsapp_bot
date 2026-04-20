/**
 * CalendarHeader — navigation + view switcher for the calendar page.
 *
 * Props:
 *   view:           current CalendarView
 *   setView:        setter
 *   availableViews: list of views to show in the toggle (filtered per viewport)
 *   cursorMs:       current navigation anchor (unix ms)
 *   setCursorMs:    setter
 *   reconnecting:   true = show amber "Reconnecting…" badge
 *
 * Navigation:
 *   Today → setCursorMs(Date.now())
 *   ← / → → subtracts/adds 1 view-unit (month/week/day/3day/dots)
 *   Date label is view-aware:
 *     month / dots → "April 2026"
 *     week         → "20–26 Apr 2026"
 *     day / 3day   → "Tue 20 Apr 2026"
 *
 * Plan 44-04 (base), extended in Plan 44-05 (drag + click split + ghost mode),
 * extended in Plan 50-02 (availableViews filter for mobile viewport),
 * extended in Plan 50-03 (mobile compact row layout + 3-segment view pill).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { startOfIstWeek, addIstDays, formatIstDateShort } from '@/lib/ist';
import { useViewport } from '@/hooks/useViewport';
import type { CalendarView } from '@/hooks/useCalendarViewMode';

// -----------------------------------------------------------------------
// Re-export CalendarView so existing importers of CalendarHeader still work
// -----------------------------------------------------------------------
export type { CalendarView };

// -----------------------------------------------------------------------
// View label map for the toggle chips
// -----------------------------------------------------------------------
const VIEW_LABELS: Record<CalendarView, string> = {
  month: 'Month',
  week: 'Week',
  day: 'Day',
  '3day': '3D',
  dots: 'Dots',
};

interface CalendarHeaderProps {
  view: CalendarView;
  setView: (v: CalendarView) => void;
  /** Views to show in the toggle — provided by useCalendarViewMode().availableViews. */
  availableViews: CalendarView[];
  cursorMs: number;
  setCursorMs: (ms: number) => void;
  reconnecting: boolean;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function buildDateLabel(view: CalendarView, cursorMs: number): string {
  const d = new Date(cursorMs);
  const tzOpts = { timeZone: 'Asia/Jerusalem' };

  if (view === 'month' || view === 'dots') {
    return d.toLocaleDateString('en-GB', {
      ...tzOpts,
      month: 'long',
      year: 'numeric',
    });
  }

  if (view === 'week') {
    const sunMs = startOfIstWeek(cursorMs);
    const satMs = addIstDays(sunMs, 6);
    const sunD = new Date(sunMs);
    const satD = new Date(satMs);
    const sunDay = sunD.toLocaleDateString('en-GB', { ...tzOpts, day: 'numeric' });
    const satDay = satD.toLocaleDateString('en-GB', { ...tzOpts, day: 'numeric' });
    const monthYear = satD.toLocaleDateString('en-GB', { ...tzOpts, month: 'short', year: 'numeric' });
    return `${sunDay}–${satDay} ${monthYear}`;
  }

  // Day and 3day views
  const full = formatIstDateShort(cursorMs);
  const year = d.toLocaleDateString('en-GB', { ...tzOpts, year: 'numeric' });
  return `${full} ${year}`;
}

function buildDateLabelShort(view: CalendarView, cursorMs: number): string {
  const d = new Date(cursorMs);
  const tzOpts = { timeZone: 'Asia/Jerusalem' };

  if (view === 'month' || view === 'dots') {
    return d.toLocaleDateString('en-GB', { ...tzOpts, month: 'short', year: 'numeric' });
  }
  if (view === 'week') {
    const sunMs = startOfIstWeek(cursorMs);
    const sunD = new Date(sunMs);
    return sunD.toLocaleDateString('en-GB', { ...tzOpts, day: 'numeric', month: 'short' });
  }
  // day / 3day
  return d.toLocaleDateString('en-GB', { ...tzOpts, day: 'numeric', month: 'short' });
}

function navigate(view: CalendarView, cursorMs: number, direction: -1 | 1): number {
  const d = new Date(cursorMs);
  if (view === 'month' || view === 'dots') {
    const year = d.getFullYear();
    const month = d.getMonth();
    return new Date(year, month + direction, 1).getTime();
  }
  if (view === 'week') {
    return addIstDays(cursorMs, direction * 7);
  }
  if (view === '3day') {
    return addIstDays(cursorMs, direction * 3);
  }
  return addIstDays(cursorMs, direction);
}

// -----------------------------------------------------------------------
// Mobile 3-segment view pill (inline subcomponent)
// -----------------------------------------------------------------------

function ViewTogglePillMobile({
  views,
  value,
  onChange,
}: {
  views: CalendarView[];
  value: CalendarView;
  onChange: (v: CalendarView) => void;
}) {
  return (
    <div className="flex items-center bg-muted rounded-full p-0.5 gap-0.5">
      {views.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={[
            'h-10 px-3 rounded-full text-xs font-medium transition-colors',
            v === value
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground',
          ].join(' ')}
          aria-pressed={v === value}
        >
          {VIEW_LABELS[v]}
        </button>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function CalendarHeader({
  view,
  setView,
  availableViews,
  cursorMs,
  setCursorMs,
  reconnecting,
}: CalendarHeaderProps) {
  const { isMobile } = useViewport();
  const dateLabel = buildDateLabel(view, cursorMs);

  // -----------------------------------------------------------------------
  // Phone layout — single compact row
  // -----------------------------------------------------------------------
  if (isMobile) {
    const shortLabel = buildDateLabelShort(view, cursorMs);
    return (
      <div className="flex items-center gap-2 px-1 py-1">
        {/* Prev / Next navigation */}
        <button
          type="button"
          onClick={() => setCursorMs(navigate(view, cursorMs, -1))}
          className="flex items-center justify-center h-10 w-10 rounded-full hover:bg-muted"
          aria-label="Previous"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setCursorMs(navigate(view, cursorMs, 1))}
          className="flex items-center justify-center h-10 w-10 rounded-full hover:bg-muted"
          aria-label="Next"
        >
          <ChevronRight className="size-5" />
        </button>

        {/* Date label — truncated if narrow */}
        <span className="flex-1 truncate text-sm font-medium min-w-0">
          {shortLabel}
          {reconnecting && (
            <span className="ml-1 text-xs text-amber-500 animate-pulse">…</span>
          )}
        </span>

        {/* View toggle as 3-segment pill */}
        <ViewTogglePillMobile
          views={availableViews}
          value={view}
          onChange={setView}
        />
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Desktop layout — unchanged from Plan 44-04 / 50-02
  // -----------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      {/* Title block */}
      <div>
        <h1
          className="text-2xl font-semibold mb-1"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Calendar
        </h1>
        <p className="text-sm text-muted-foreground">
          View and edit every committed item in one place.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col items-end gap-2">
        {/* Reconnecting badge */}
        {reconnecting && (
          <span className="text-xs text-amber-600 dark:text-amber-400 animate-pulse">
            Reconnecting…
          </span>
        )}

        {/* Nav row */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCursorMs(Date.now())}
          >
            Today
          </Button>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => setCursorMs(navigate(view, cursorMs, -1))}
              aria-label="Previous"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center">
              {dateLabel}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => setCursorMs(navigate(view, cursorMs, 1))}
              aria-label="Next"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {/* View toggle — rendered from availableViews (filtered per viewport) */}
          <Tabs value={view} onValueChange={(v) => setView(v as CalendarView)}>
            <TabsList className="h-8">
              {availableViews.map((v) => (
                <TabsTrigger key={v} value={v} className="text-xs px-2.5">
                  {VIEW_LABELS[v]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
