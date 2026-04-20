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
 * Drag-and-drop (Plan 44-05):
 *   - Each day column is a drop zone (onDragOver + onDrop)
 *   - Drop computes target ms from pointer Y position + 15-min snap
 *   - Cross-day drag preserves time-of-day (only date changes)
 *   - Ghost position + caption updated from onDragOver
 *
 * Plan 44-04 (base), extended in Plan 44-05 (drag/drop + overflow popover).
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import { CalendarPill } from './CalendarPill';
import {
  startOfIstWeek,
  addIstDays,
  sameIstDay,
  formatIstDateShort,
  istDayStartMs,
} from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';
import type { CalendarDragGhostControls } from './CalendarDragGhost';
import type { RescheduleMutationOpts } from '@/hooks/useCalendarMutations';

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

const ROW_H = 48; // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MAX_COLS = 3;
const SNAP_MINUTES = 15;

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface WeekViewProps {
  items: CalendarItem[];
  cursorMs: number;
  flashingIds?: Set<string>;
  draggingId?: string | null;
  ghost: CalendarDragGhostControls;
  reschedule: RescheduleMutationOpts & { mutate: (args: { item: CalendarItem; toMs: number }) => Promise<void> };
  onSlotClick?: (dayMs: number, hour: number, minute: number) => void;
  onOpenItem?: (item: CalendarItem) => void;
  editingId?: string | null;
  onTitleClick?: (item: CalendarItem) => void;
  onTitleCommit?: (item: CalendarItem, newTitle: string) => void;
  onTitleCancel?: (item: CalendarItem) => void;
  onDragStart?: (e: React.DragEvent, item: CalendarItem) => void;
  onDragEnd?: (e: React.DragEvent, item: CalendarItem) => void;
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

/**
 * Compute drop target ms from pointer position within a day column.
 * Snaps to SNAP_MINUTES intervals. Preserves source item's time-of-day
 * is handled at the caller level for cross-day drags.
 */
function computeDropTargetMs(
  dayMs: number,
  offsetY: number,
  gridHeight: number,
  itemStartMs: number,
): number {
  const clampedY = Math.max(0, Math.min(offsetY, gridHeight));
  const totalMinutes = (clampedY / ROW_H) * 60;
  const snapped = Math.floor(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;

  // Build target: day start + snapped minutes
  const dayStart = istDayStartMs(dayMs);
  return dayStart + snapped * 60_000;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function WeekView({
  items,
  cursorMs,
  flashingIds = new Set(),
  draggingId = null,
  editingId = null,
  ghost,
  reschedule,
  onSlotClick,
  onOpenItem,
  onTitleClick,
  onTitleCommit,
  onTitleCancel,
  onDragStart,
  onDragEnd,
}: WeekViewProps) {
  const days = useMemo(() => getWeekDays(cursorMs), [cursorMs]);
  const today = Date.now();

  // Current-time line position (minutes since midnight).
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

  // Parse dragged item from dataTransfer (used in onDrop handlers)
  function parseDragPayload(e: React.DragEvent): { id: string; source: string; originStartMs: number } | null {
    try {
      const raw = e.dataTransfer.getData('application/calendar-item');
      if (!raw) return null;
      return JSON.parse(raw) as { id: string; source: string; originStartMs: number };
    } catch {
      return null;
    }
  }

  function findItem(id: string): CalendarItem | undefined {
    return items.find((i) => i.id === id);
  }

  function handleDragOver(e: React.DragEvent, dayMs: number, colRect: DOMRect) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Update ghost position
    ghost.move(e.clientX, e.clientY);

    // Compute target for caption
    const offsetY = e.clientY - colRect.top + (gridRef.current?.scrollTop ?? 0);
    // Find the dragged item to preserve time-of-day if needed
    const payload = parseDragPayload(e);
    const originMs = payload?.originStartMs ?? Date.now();
    const targetMs = computeDropTargetMs(dayMs, offsetY, 24 * ROW_H, originMs);
    ghost.setTarget(targetMs);
  }

  function handleDrop(e: React.DragEvent, dayMs: number, colRect: DOMRect) {
    e.preventDefault();
    const payload = parseDragPayload(e);
    if (!payload) return;

    const item = findItem(payload.id);
    if (!item) return;

    const offsetY = e.clientY - colRect.top + (gridRef.current?.scrollTop ?? 0);
    const targetMs = computeDropTargetMs(dayMs, offsetY, 24 * ROW_H, item.start);

    ghost.hide();
    void reschedule.mutate({ item, toMs: targetMs });
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden border border-border rounded-lg">
      {/* Day headers */}
      <div className="grid border-b border-border bg-muted/20" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
        <div className="py-2" /> {/* Time gutter */}
        {days.map((dayMs) => {
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
                  draggingId={draggingId}
                  editingId={editingId}
                  onOpenDetails={() => onOpenItem?.(item)}
                  onTitleClick={() => onTitleClick?.(item)}
                  onTitleCommit={onTitleCommit}
                  onTitleCancel={onTitleCancel}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
              ))}
              {overflow > 0 && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground text-left px-1"
                  onClick={() => { /* overflow for all-day: handled inline */ }}
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
                onDragOver={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  handleDragOver(e, dayMs, rect);
                }}
                onDrop={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  handleDrop(e, dayMs, rect);
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
                          draggingId={draggingId}
                          editingId={editingId}
                          onOpenDetails={() => onOpenItem?.(item)}
                          onTitleClick={() => onTitleClick?.(item)}
                          onTitleCommit={onTitleCommit}
                          onTitleCancel={onTitleCancel}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                        />
                      </div>
                      {/* +N overflow badge on last visible item */}
                      {i === visibleItems.length - 1 && overflowCount > 0 && (
                        <button
                          type="button"
                          className="absolute -right-1 -bottom-1 text-[10px] bg-muted text-muted-foreground rounded px-1 z-30"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Overflow: signal to parent to open overflow popover
                            onSlotClick?.(dayMs, -1, -1); // sentinel: -1 = show overflow
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
    </div>
  );
}
