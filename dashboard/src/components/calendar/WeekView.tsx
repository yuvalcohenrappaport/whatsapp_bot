/**
 * WeekView — 7-column week calendar with timed grid + all-day row.
 *
 * Structure:
 *   - Day header row: Sun…Sat with date; today gets ring-2 ring-emerald-500
 *   - All-day row: items with isAllDay=true stacked per day
 *   - Timed grid: 24 rows × 7 columns, each row = 1 hour, 48px tall
 *     - Items positioned absolutely by start time; height = duration
 *     - Items in same hour-slot stacked horizontally (up to 3, then +N badge)
 *   - Current-time line: red horizontal line on today's column
 *
 * Plan 44-04.
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CalendarPill } from './CalendarPill';
import {
  startOfIstWeek,
  addIstDays,
  sameIstDay,
  formatIstDateShort,
  formatIstTime,
  istTodayAtMs,
} from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

const ROW_H = 48; // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MAX_COLS = 3;

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface WeekViewProps {
  items: CalendarItem[];
  cursorMs: number;
  flashingIds?: Set<string>;
  onSlotClick?: (dayMs: number, hour: number, minute: number) => void;
  onOpenItem?: (item: CalendarItem) => void;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function getWeekDays(cursorMs: number): number[] {
  const sun = startOfIstWeek(cursorMs);
  return Array.from({ length: 7 }, (_, i) => addIstDays(sun, i));
}

/** Top offset in px for a timed item. */
function topPx(startMs: number): number {
  const d = new Date(startMs);
  const h = d.getHours();
  const m = d.getMinutes();
  return (h + m / 60) * ROW_H;
}

/** Height in px for a timed item (min 24px). */
function heightPx(startMs: number, endMs: number | null): number {
  if (!endMs) return 24;
  const durationMs = Math.max(0, endMs - startMs);
  return Math.max(24, (durationMs / 3_600_000) * ROW_H);
}

// -----------------------------------------------------------------------
// Overflow dialog
// -----------------------------------------------------------------------

function OverflowDialog({
  items,
  dayMs,
  flashingIds,
  today,
  onClose,
  onOpenItem,
}: {
  items: CalendarItem[];
  dayMs: number | null;
  flashingIds: Set<string>;
  today: number;
  onClose: () => void;
  onOpenItem?: (item: CalendarItem) => void;
}) {
  return (
    <Dialog open={dayMs !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {dayMs !== null ? formatIstDateShort(dayMs) : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
          {dayMs !== null &&
            items
              .filter((item) => sameIstDay(item.start, dayMs))
              .sort((a, b) => a.start - b.start)
              .map((item) => (
                <CalendarPill
                  key={item.id}
                  item={item}
                  flashing={flashingIds.has(item.id)}
                  past={item.start < today}
                  onOpenDetails={() => { onClose(); onOpenItem?.(item); }}
                />
              ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function WeekView({
  items,
  cursorMs,
  flashingIds = new Set(),
  onSlotClick,
  onOpenItem,
}: WeekViewProps) {
  const days = useMemo(() => getWeekDays(cursorMs), [cursorMs]);
  const today = Date.now();
  const [overflowDay, setOverflowDay] = useState<number | null>(null);

  // Current-time line position (minutes since midnight IST).
  const [nowMinutes, setNowMinutes] = useState(() => {
    const h = new Date().getHours();
    const m = new Date().getMinutes();
    return h * 60 + m;
  });

  useEffect(() => {
    const tick = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(tick);
  }, []);

  const gridRef = useRef<HTMLDivElement>(null);

  // Scroll to current time on mount.
  useEffect(() => {
    if (gridRef.current) {
      const offset = Math.max(0, (nowMinutes / 60) * ROW_H - 120);
      gridRef.current.scrollTop = offset;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Find today's column index.
  const todayColIdx = days.findIndex((dayMs) => sameIstDay(dayMs, today));
  const currentTimePx = (nowMinutes / 60) * ROW_H;

  return (
    <div className="flex flex-col flex-1 overflow-hidden border border-border rounded-lg">
      {/* Day headers */}
      <div className="grid border-b border-border bg-muted/20" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
        <div className="py-2" /> {/* Time gutter */}
        {days.map((dayMs, i) => {
          const isToday = sameIstDay(dayMs, today);
          const label = formatIstDateShort(dayMs);
          return (
            <div
              key={dayMs}
              className={[
                'py-2 text-center text-xs border-l border-border',
                isToday ? 'ring-2 ring-inset ring-emerald-500 font-semibold' : 'font-medium text-muted-foreground',
              ].join(' ')}
            >
              {label}
            </div>
          );
        })}
      </div>

      {/* All-day row */}
      <div className="grid border-b border-border min-h-[32px]" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
        <div className="px-1 text-[10px] text-muted-foreground flex items-center justify-end pr-2">
          all-day
        </div>
        {days.map((dayMs) => {
          const allDayItems = items
            .filter((item) => item.isAllDay && sameIstDay(item.start, dayMs))
            .sort((a, b) => a.start - b.start);
          const visible = allDayItems.slice(0, MAX_COLS);
          const overflow = allDayItems.length - MAX_COLS;
          return (
            <div key={dayMs} className="border-l border-border p-0.5 flex flex-col gap-0.5">
              {visible.map((item) => (
                <CalendarPill
                  key={item.id}
                  item={item}
                  compact
                  flashing={flashingIds.has(item.id)}
                  past={item.start < today}
                  onOpenDetails={() => onOpenItem?.(item)}
                />
              ))}
              {overflow > 0 && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground text-left px-1"
                  onClick={() => setOverflowDay(dayMs)}
                >
                  +{overflow}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Timed grid */}
      <div
        ref={gridRef}
        className="flex-1 overflow-y-auto"
      >
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: '48px repeat(7, 1fr)',
            height: `${24 * ROW_H}px`,
          }}
        >
          {/* Hour label column */}
          <div className="relative">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 text-right pr-2 text-[10px] text-muted-foreground"
                style={{ top: `${h * ROW_H - 6}px` }}
              >
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          {/* Hour grid lines across all columns */}
          {HOURS.map((h) => (
            <div
              key={`line-${h}`}
              className="absolute border-t border-border pointer-events-none"
              style={{
                top: `${h * ROW_H}px`,
                left: '48px',
                right: 0,
              }}
            />
          ))}

          {/* Day columns */}
          {days.map((dayMs, colIdx) => {
            const timedItems = items
              .filter((item) => !item.isAllDay && sameIstDay(item.start, dayMs))
              .sort((a, b) => a.start - b.start);

            return (
              <div
                key={dayMs}
                className="relative border-l border-border"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const offsetY = e.clientY - rect.top;
                  const totalMinutes = Math.floor((offsetY / ROW_H) * 60);
                  const snapMinutes = Math.round(totalMinutes / 15) * 15;
                  const hour = Math.floor(snapMinutes / 60);
                  const minute = snapMinutes % 60;
                  onSlotClick?.(dayMs, hour, minute);
                }}
              >
                {/* Current-time line */}
                {colIdx === todayColIdx && (
                  <div
                    className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none"
                    style={{ top: `${currentTimePx}px` }}
                  >
                    <div className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-red-500" />
                  </div>
                )}

                {/* Timed items */}
                {timedItems.map((item, i) => {
                  const totalCount = timedItems.length;
                  const visibleItems = timedItems.slice(0, MAX_COLS);
                  const overflowCount = totalCount - MAX_COLS;
                  if (i >= MAX_COLS) return null;

                  const colWidth = Math.min(100 / Math.min(totalCount, MAX_COLS), 100);
                  const leftPct = i * colWidth;

                  return (
                    <div
                      key={item.id}
                      className="absolute z-10"
                      style={{
                        top: `${topPx(item.start)}px`,
                        height: `${heightPx(item.start, item.end)}px`,
                        left: `${leftPct}%`,
                        width: `${colWidth}%`,
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
                      {/* +N overflow badge on last visible item */}
                      {i === visibleItems.length - 1 && overflowCount > 0 && (
                        <button
                          type="button"
                          className="absolute -right-1 -bottom-1 text-[10px] bg-muted text-muted-foreground rounded px-1 z-30"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOverflowDay(dayMs);
                          }}
                        >
                          +{overflowCount}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <OverflowDialog
        items={items}
        dayMs={overflowDay}
        flashingIds={flashingIds}
        today={today}
        onClose={() => setOverflowDay(null)}
        onOpenItem={onOpenItem}
      />
    </div>
  );
}
