/**
 * CalendarHeader — navigation + view switcher for the calendar page.
 *
 * Props:
 *   view:         'month' | 'week' | 'day'
 *   setView:      setter
 *   cursorMs:     current navigation anchor (unix ms)
 *   setCursorMs:  setter
 *   reconnecting: true = show amber "Reconnecting…" badge
 *
 * Navigation:
 *   Today → setCursorMs(Date.now())
 *   ← / → → subtracts/adds 1 view-unit (month/week/day)
 *   Date label is view-aware:
 *     month → "April 2026"
 *     week  → "20–26 Apr 2026"
 *     day   → "Tue 20 Apr 2026"
 *
 * Plan 44-04.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { startOfIstWeek, addIstDays, formatIstDateShort } from '@/lib/ist';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type CalendarView = 'month' | 'week' | 'day';

interface CalendarHeaderProps {
  view: CalendarView;
  setView: (v: CalendarView) => void;
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

  if (view === 'month') {
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

  // Day view
  const full = formatIstDateShort(cursorMs);
  const year = d.toLocaleDateString('en-GB', { ...tzOpts, year: 'numeric' });
  return `${full} ${year}`;
}

function navigate(view: CalendarView, cursorMs: number, direction: -1 | 1): number {
  const d = new Date(cursorMs);
  if (view === 'month') {
    const year = d.getFullYear();
    const month = d.getMonth();
    return new Date(year, month + direction, 1).getTime();
  }
  if (view === 'week') {
    return addIstDays(cursorMs, direction * 7);
  }
  return addIstDays(cursorMs, direction);
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function CalendarHeader({
  view,
  setView,
  cursorMs,
  setCursorMs,
  reconnecting,
}: CalendarHeaderProps) {
  const dateLabel = buildDateLabel(view, cursorMs);

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

          {/* View toggle */}
          <Tabs value={view} onValueChange={(v) => setView(v as CalendarView)}>
            <TabsList className="h-8">
              <TabsTrigger value="month" className="text-xs px-2.5">
                Month
              </TabsTrigger>
              <TabsTrigger value="week" className="text-xs px-2.5">
                Week
              </TabsTrigger>
              <TabsTrigger value="day" className="text-xs px-2.5">
                Day
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
