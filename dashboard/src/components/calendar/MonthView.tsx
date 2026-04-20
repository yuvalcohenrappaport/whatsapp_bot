/**
 * MonthView — 7×6 (42-cell) month calendar grid.
 *
 * Features:
 *   - 6 rows × 7 columns starting from Sunday
 *   - Muted date numbers for days outside current month
 *   - Up to 3 CalendarPills per day (compact=true)
 *   - "+N more" pill opens a shadcn Dialog listing all day items
 *   - Empty cell click → onDaySlotClick(cellMs, 'allday') for Plan 44-05
 *
 * Plan 44-04.
 */
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CalendarPill } from './CalendarPill';
import { startOfIstWeek, addIstDays, sameIstDay, formatIstDateShort } from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface MonthViewProps {
  items: CalendarItem[];
  cursorMs: number;
  flashingIds?: Set<string>;
  onDaySlotClick?: (dayMs: number, type: 'allday') => void;
  onOpenItem?: (item: CalendarItem) => void;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE = 3;

function buildMonthGrid(cursorMs: number): number[] {
  const d = new Date(cursorMs);
  // First day of the month in local time.
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  // Sunday of the week containing the first of the month.
  const gridStart = startOfIstWeek(firstOfMonth);
  // 42 cells = 6 rows × 7 days.
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

export function MonthView({
  items,
  cursorMs,
  flashingIds = new Set(),
  onDaySlotClick,
  onOpenItem,
}: MonthViewProps) {
  const [overflowDay, setOverflowDay] = useState<number | null>(null);

  const grid = buildMonthGrid(cursorMs);
  const today = Date.now();

  return (
    <div className="flex-1 overflow-hidden">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      {/* 6 × 7 grid */}
      <div className="grid grid-cols-7 grid-rows-6 flex-1" style={{ minHeight: '480px' }}>
        {grid.map((cellMs) => {
          const dayItems = items
            .filter((item) => sameIstDay(item.start, cellMs))
            .sort((a, b) => a.start - b.start);
          const visible = dayItems.slice(0, MAX_VISIBLE);
          const overflow = dayItems.length - MAX_VISIBLE;
          const inMonth = isCurrentMonth(cellMs, cursorMs);
          const isToday = sameIstDay(cellMs, today);
          const dayNum = new Date(cellMs).getDate();

          return (
            <div
              key={cellMs}
              className={[
                'border-b border-r border-border p-1 min-h-[80px] flex flex-col gap-0.5',
                inMonth ? '' : 'bg-muted/30',
              ].join(' ')}
              onClick={() => onDaySlotClick?.(cellMs, 'allday')}
            >
              {/* Date number */}
              <div
                className={[
                  'text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full',
                  isToday
                    ? 'bg-emerald-500 text-white'
                    : inMonth
                    ? 'text-foreground'
                    : 'text-muted-foreground',
                ].join(' ')}
              >
                {dayNum}
              </div>

              {/* Items */}
              {visible.map((item) => (
                <div
                  key={item.id}
                  onClick={(e) => e.stopPropagation()}
                >
                  <CalendarPill
                    item={item}
                    compact
                    flashing={flashingIds.has(item.id)}
                    past={item.start < today}
                    onOpenDetails={() => onOpenItem?.(item)}
                  />
                </div>
              ))}

              {/* +N more */}
              {overflow > 0 && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground text-left px-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOverflowDay(cellMs);
                  }}
                >
                  +{overflow} more
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Overflow dialog */}
      <Dialog open={overflowDay !== null} onOpenChange={(open) => !open && setOverflowDay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {overflowDay !== null ? formatIstDateShort(overflowDay) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
            {overflowDay !== null &&
              items
                .filter((item) => sameIstDay(item.start, overflowDay))
                .sort((a, b) => a.start - b.start)
                .map((item) => (
                  <CalendarPill
                    key={item.id}
                    item={item}
                    flashing={flashingIds.has(item.id)}
                    past={item.start < today}
                    onOpenDetails={() => {
                      setOverflowDay(null);
                      onOpenItem?.(item);
                    }}
                  />
                ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
