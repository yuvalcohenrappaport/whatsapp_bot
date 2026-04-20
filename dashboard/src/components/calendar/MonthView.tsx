/**
 * MonthView — 7×6 (42-cell) month calendar grid.
 *
 * Features:
 *   - 6 rows × 7 columns starting from Sunday
 *   - Muted date numbers for days outside current month
 *   - Up to 3 CalendarPills per day (compact=true)
 *   - "+N more" pill opens DayOverflowPopover listing all day items
 *   - Empty cell click → onDaySlotClick(cellMs, 'allday') for Plan 44-05
 *
 * Drag-and-drop (Plan 44-05):
 *   - Each cell is a drop zone (onDragOver + onDrop)
 *   - Month-view snaps to whole day — preserves item's time-of-day
 *   - Ghost caption updated from onDragOver
 *
 * Plan 44-04 (base), extended in Plan 44-05 (drag/drop + overflow popover).
 */
import { useState } from 'react';
import { CalendarPill } from './CalendarPill';
import { DayOverflowPopover } from './DayOverflowPopover';
import { startOfIstWeek, addIstDays, sameIstDay, formatIstDateShort, istDayStartMs } from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';
import type { CalendarDragGhostControls } from './CalendarDragGhost';
import type { RescheduleMutationOpts } from '@/hooks/useCalendarMutations';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface MonthViewProps {
  items: CalendarItem[];
  cursorMs: number;
  flashingIds?: Set<string>;
  draggingId?: string | null;
  ghost: CalendarDragGhostControls;
  reschedule: RescheduleMutationOpts & { mutate: (args: { item: CalendarItem; toMs: number }) => Promise<void> };
  onDaySlotClick?: (dayMs: number, type: 'allday') => void;
  editingId?: string | null;
  onOpenItem?: (item: CalendarItem) => void;
  onTitleClick?: (item: CalendarItem) => void;
  onTitleCommit?: (item: CalendarItem, newTitle: string) => void;
  onTitleCancel?: (item: CalendarItem) => void;
  onDragStart?: (e: React.DragEvent, item: CalendarItem) => void;
  onDragEnd?: (e: React.DragEvent, item: CalendarItem) => void;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE = 3;

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

/**
 * For month-view drops: preserve the item's time-of-day, only change the date.
 * Combine day's midnight ms + item's hour+minute offset.
 */
function preserveTimeOfDay(dayMs: number, itemStartMs: number): number {
  const dayStart = istDayStartMs(dayMs);
  const itemDate = new Date(itemStartMs);
  const minutesFromMidnight = itemDate.getHours() * 60 + itemDate.getMinutes();
  return dayStart + minutesFromMidnight * 60_000;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function MonthView({
  items,
  cursorMs,
  flashingIds = new Set(),
  draggingId = null,
  editingId = null,
  ghost,
  reschedule,
  onDaySlotClick,
  onOpenItem,
  onTitleClick,
  onTitleCommit,
  onTitleCancel,
  onDragStart,
  onDragEnd,
}: MonthViewProps) {
  const grid = buildMonthGrid(cursorMs);
  const today = Date.now();

  function parseDragPayload(e: React.DragEvent): { id: string; originStartMs: number } | null {
    try {
      const raw = e.dataTransfer.getData('application/calendar-item');
      if (!raw) return null;
      return JSON.parse(raw) as { id: string; originStartMs: number };
    } catch {
      return null;
    }
  }

  function handleDragOver(e: React.DragEvent, cellMs: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    ghost.move(e.clientX, e.clientY);

    // For month view, compute caption as the cell day with item's time-of-day.
    const payload = parseDragPayload(e);
    if (payload) {
      const targetMs = preserveTimeOfDay(cellMs, payload.originStartMs);
      ghost.setTarget(targetMs);
    }
  }

  function handleDrop(e: React.DragEvent, cellMs: number) {
    e.preventDefault();
    const payload = parseDragPayload(e);
    if (!payload) return;
    const item = items.find((i) => i.id === payload.id);
    if (!item) return;

    // Month drop: preserve time-of-day, only change date.
    const targetMs = preserveTimeOfDay(cellMs, item.start);

    ghost.hide();
    void reschedule.mutate({ item, toMs: targetMs });
  }

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
              onDragOver={(e) => handleDragOver(e, cellMs)}
              onDrop={(e) => handleDrop(e, cellMs)}
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
              ))}

              {/* +N more — DayOverflowPopover */}
              {overflow > 0 && (
                <div onClick={(e) => e.stopPropagation()}>
                  <DayOverflowPopover
                    dateMs={cellMs}
                    items={dayItems}
                    flashingIds={flashingIds}
                    onOpenItem={onOpenItem}
                    trigger={
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-foreground text-left px-1 w-full"
                      >
                        +{overflow} more
                      </button>
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
