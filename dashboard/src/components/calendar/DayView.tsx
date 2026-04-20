/**
 * DayView — single-column day view with timed grid + all-day row.
 *
 * Features:
 *   - All-day row at top for isAllDay items
 *   - 24-hour timed grid (48px/hour) with left-side hour labels
 *   - Current-time red line when cursor day is today
 *   - Vertical item stack (full detail, no truncation)
 *
 * Plan 44-04.
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import { CalendarPill } from './CalendarPill';
import {
  sameIstDay,
  formatIstDateShort,
} from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

const ROW_H = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface DayViewProps {
  items: CalendarItem[];
  cursorMs: number;
  flashingIds?: Set<string>;
  onSlotClick?: (dayMs: number, hour: number, minute: number) => void;
  onOpenItem?: (item: CalendarItem) => void;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function topPx(startMs: number): number {
  const d = new Date(startMs);
  return (d.getHours() + d.getMinutes() / 60) * ROW_H;
}

function heightPx(startMs: number, endMs: number | null): number {
  if (!endMs) return 24;
  return Math.max(24, ((endMs - startMs) / 3_600_000) * ROW_H);
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function DayView({
  items,
  cursorMs,
  flashingIds = new Set(),
  onSlotClick,
  onOpenItem,
}: DayViewProps) {
  const today = Date.now();
  const isToday = sameIstDay(cursorMs, today);
  const dateLabel = formatIstDateShort(cursorMs);

  const dayItems = useMemo(
    () => items.filter((item) => sameIstDay(item.start, cursorMs)),
    [items, cursorMs],
  );

  const allDayItems = useMemo(
    () => dayItems.filter((i) => i.isAllDay).sort((a, b) => a.start - b.start),
    [dayItems],
  );

  const timedItems = useMemo(
    () => dayItems.filter((i) => !i.isAllDay).sort((a, b) => a.start - b.start),
    [dayItems],
  );

  const [nowMinutes, setNowMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  useEffect(() => {
    const tick = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(tick);
  }, []);

  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (gridRef.current && isToday) {
      const offset = Math.max(0, (nowMinutes / 60) * ROW_H - 120);
      gridRef.current.scrollTop = offset;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentTimePx = (nowMinutes / 60) * ROW_H;

  return (
    <div className="flex flex-col flex-1 overflow-hidden border border-border rounded-lg">
      {/* Day header */}
      <div className={[
        'px-4 py-2 border-b border-border text-sm font-semibold',
        isToday ? 'text-emerald-500' : 'text-foreground',
      ].join(' ')}>
        {dateLabel}
        {isToday && <span className="ml-2 text-xs font-normal text-muted-foreground">Today</span>}
      </div>

      {/* All-day items */}
      {allDayItems.length > 0 && (
        <div className="border-b border-border px-2 py-1 flex flex-col gap-1 bg-muted/10">
          <span className="text-[10px] text-muted-foreground">All day</span>
          {allDayItems.map((item) => (
            <CalendarPill
              key={item.id}
              item={item}
              flashing={flashingIds.has(item.id)}
              past={item.start < today}
              onOpenDetails={() => onOpenItem?.(item)}
            />
          ))}
        </div>
      )}

      {/* Timed grid */}
      <div ref={gridRef} className="flex-1 overflow-y-auto">
        <div
          className="relative"
          style={{ height: `${24 * ROW_H}px` }}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const offsetY = e.clientY - rect.top;
            const totalMinutes = Math.floor((offsetY / ROW_H) * 60);
            const snapMinutes = Math.round(totalMinutes / 15) * 15;
            const hour = Math.floor(snapMinutes / 60);
            const minute = snapMinutes % 60;
            onSlotClick?.(cursorMs, hour, minute);
          }}
        >
          {/* Hour lines + labels */}
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 flex items-start"
              style={{ top: `${h * ROW_H}px` }}
            >
              <div className="w-12 shrink-0 text-right pr-2 text-[10px] text-muted-foreground -mt-2.5">
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
              <div className="flex-1 border-t border-border" />
            </div>
          ))}

          {/* Current-time line */}
          {isToday && (
            <div
              className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none"
              style={{ top: `${currentTimePx}px` }}
            >
              <div className="absolute left-10 -top-1.5 size-3 rounded-full bg-red-500" />
            </div>
          )}

          {/* Timed items */}
          <div className="absolute" style={{ left: '48px', right: 0, top: 0, bottom: 0 }}>
            {timedItems.map((item) => (
              <div
                key={item.id}
                className="absolute left-0 right-1 z-10"
                style={{
                  top: `${topPx(item.start)}px`,
                  height: `${heightPx(item.start, item.end)}px`,
                  padding: '1px',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="h-full">
                  <CalendarPill
                    item={item}
                    compact={heightPx(item.start, item.end) < 40}
                    flashing={flashingIds.has(item.id)}
                    past={item.start < today}
                    onOpenDetails={() => onOpenItem?.(item)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
