/**
 * MonthDotsView — Phone-only condensed month view (Phase 50).
 * Each day shows up to 3 source-colored dots + a +N overflow badge.
 * Tap a day → switch the calendar to Day view for that date.
 * Read-only: no drag, no inline create, no delete (those affordances
 * stay on Day / 3-Day views where there is room for them).
 *
 * Intentionally accepts only 3 props (not MonthView's ~16) — the dropped
 * 13 are drag/edit/delete handlers that don't apply on a read-only phone
 * month view (Phase 50 CONTEXT lock).
 */
import { useMemo } from 'react';
import { startOfIstWeek, addIstDays, sameIstDay, istDayStartMs } from '@/lib/ist';
import { dotColorClass } from './colorForItem';
import type { CalendarItem } from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface MonthDotsViewProps {
  items: CalendarItem[];
  cursorMs: number;                         // epoch number, NOT Date
  onSelectDay: (dayMs: number) => void;     // caller sets cursorMs + switches to 'day'
}

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_DOTS = 3;

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Build 42-cell month grid (same logic as MonthView). */
function buildMonthGrid(cursorMs: number): number[] {
  const d = new Date(cursorMs);
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const gridStart = startOfIstWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, i) => addIstDays(gridStart, i));
}

function isCurrentMonth(cellMs: number, cursorMs: number): boolean {
  const cell = new Date(cellMs);
  const cursor = new Date(cursorMs);
  return cell.getMonth() === cursor.getMonth() && cell.getFullYear() === cursor.getFullYear();
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function MonthDotsView({ items, cursorMs, onSelectDay }: MonthDotsViewProps) {
  const grid = useMemo(() => buildMonthGrid(cursorMs), [cursorMs]);
  const todayMs = Date.now();

  // Group items by IST day start ms
  const itemsByDay = useMemo(() => {
    const map = new Map<number, CalendarItem[]>();
    for (const item of items) {
      const dayStart = istDayStartMs(item.start);
      const existing = map.get(dayStart);
      if (existing) {
        existing.push(item);
      } else {
        map.set(dayStart, [item]);
      }
    }
    return map;
  }, [items]);

  return (
    <div className="flex flex-col gap-1 select-none">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-px">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-medium text-muted-foreground py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* 6-row grid */}
      <div className="grid grid-cols-7 gap-px">
        {grid.map((cellMs) => {
          const dayStart = istDayStartMs(cellMs);
          const dayItems = itemsByDay.get(dayStart) ?? [];
          const visibleItems = dayItems.slice(0, MAX_DOTS);
          const overflowCount = dayItems.length - MAX_DOTS;
          const inMonth = isCurrentMonth(cellMs, cursorMs);
          const isToday = sameIstDay(cellMs, todayMs);
          const dayNum = new Date(cellMs).getDate();

          return (
            <button
              key={cellMs}
              type="button"
              onClick={() => onSelectDay(dayStart)}
              className={[
                'aspect-square flex flex-col justify-between p-0.5 rounded-sm text-left',
                'transition-colors duration-100',
                inMonth ? '' : 'opacity-40',
                isToday ? 'ring-2 ring-primary' : '',
                'hover:bg-muted/60 active:bg-muted',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {/* Day number */}
              <span className="text-[10px] leading-none font-medium text-foreground">
                {dayNum}
              </span>

              {/* Dots row */}
              <div className="flex items-center gap-[2px] flex-wrap">
                {visibleItems.map((item) => (
                  <span
                    key={item.id}
                    className={`inline-block size-1.5 rounded-full shrink-0 ${dotColorClass(item.source)}`}
                  />
                ))}
                {overflowCount > 0 && (
                  <span className="text-[8px] text-muted-foreground leading-none">
                    +{overflowCount}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
