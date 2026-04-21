/**
 * DayView — single-column day view with timed grid + all-day row.
 *
 * Features:
 *   - All-day row at top for isAllDay items
 *   - 24-hour timed grid (48px/hour on desktop, 64px/hour on phone) with left-side hour labels
 *   - Current-time red line when cursor day is today
 *   - Vertical item stack (full detail, no truncation)
 *
 * Drag-and-drop (Plan 44-05):
 *   - The grid is a drop zone (onDragOver + onDrop)
 *   - Drop computes target ms from pointer Y position + 15-min snap
 *   - Ghost position + caption updated from onDragOver
 *
 * Mobile (Plan 50-03):
 *   - Single full-width column (grid-cols-1 enforced)
 *   - Hour rows grow to 64px (up from desktop 48px) for comfortable touch targets
 *   - Floating + New FAB (bottom-right, safe-area-aware) replaces empty-slot click
 *     discovery — triggers the same onSlotClick flow as desktop
 *
 * Plan 44-04 (base), extended in Plan 44-05 (drag/drop), extended in Plan 50-03 (mobile).
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { CalendarPill } from './CalendarPill';
import { useViewport } from '@/hooks/useViewport';
import {
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

const ROW_H_DESKTOP = 48;
const ROW_H_MOBILE = 64;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SNAP_MINUTES = 15;

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface DayViewProps {
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
  onDelete?: (item: CalendarItem) => void;
  /** Plan 46-04 — gtasks-only "Mark complete" action, threaded to CalendarPill. */
  onComplete?: (item: CalendarItem) => Promise<string | undefined>;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function topPx(startMs: number, rowH: number): number {
  const d = new Date(startMs);
  return (d.getHours() + d.getMinutes() / 60) * rowH;
}

function heightPx(startMs: number, endMs: number | null, rowH: number): number {
  if (!endMs) return 24;
  return Math.max(24, ((endMs - startMs) / 3_600_000) * rowH);
}

function computeDropTargetMs(dayMs: number, offsetY: number, rowH: number): number {
  const clampedY = Math.max(0, offsetY);
  const totalMinutes = (clampedY / rowH) * 60;
  const snapped = Math.floor(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  const dayStart = istDayStartMs(dayMs);
  return dayStart + snapped * 60_000;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function DayView({
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
  onDelete,
  onComplete,
}: DayViewProps) {
  const { isMobile } = useViewport();
  const ROW_H = isMobile ? ROW_H_MOBILE : ROW_H_DESKTOP;

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

  function parseDragPayload(e: React.DragEvent): { id: string; originStartMs: number } | null {
    try {
      const raw = e.dataTransfer.getData('application/calendar-item');
      if (!raw) return null;
      return JSON.parse(raw) as { id: string; originStartMs: number };
    } catch {
      return null;
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    ghost.move(e.clientX, e.clientY);

    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetY = e.clientY - rect.top + (gridRef.current?.scrollTop ?? 0);
    const targetMs = computeDropTargetMs(cursorMs, offsetY, ROW_H);
    ghost.setTarget(targetMs);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const payload = parseDragPayload(e);
    if (!payload) return;
    const item = items.find((i) => i.id === payload.id);
    if (!item) return;

    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetY = e.clientY - rect.top + (gridRef.current?.scrollTop ?? 0);
    const targetMs = computeDropTargetMs(cursorMs, offsetY, ROW_H);

    ghost.hide();
    void reschedule.mutate({ item, toMs: targetMs });
  }

  /** FAB: open create at the next round hour from now (or 09:00 if before 9am). */
  function handleFabClick() {
    const d = new Date();
    const nextHour = Math.min(d.getHours() + 1, 23);
    onSlotClick?.(cursorMs, nextHour, 0);
  }

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
              draggingId={draggingId}
              onOpenDetails={() => onOpenItem?.(item)}
              editingId={editingId}
              onTitleClick={() => onTitleClick?.(item)}
              onTitleCommit={onTitleCommit}
              onTitleCancel={onTitleCancel}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDelete={onDelete}
              onComplete={onComplete}
            />
          ))}
        </div>
      )}

      {/* Timed grid */}
      <div
        ref={gridRef}
        className="flex-1 overflow-y-auto"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div
          className="relative"
          style={{ height: `${24 * ROW_H}px` }}
          onClick={(e) => {
            // On mobile, empty-slot click is handled by the FAB — ignore grid clicks.
            if (isMobile) return;
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
                  top: `${topPx(item.start, ROW_H)}px`,
                  height: `${heightPx(item.start, item.end, ROW_H)}px`,
                  padding: '1px',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="h-full">
                  <CalendarPill
                    item={item}
                    compact={heightPx(item.start, item.end, ROW_H) < 40}
                    flashing={flashingIds.has(item.id)}
                    past={item.start < today}
                    draggingId={draggingId}
                    onOpenDetails={() => onOpenItem?.(item)}
                    onTitleClick={() => onTitleClick?.(item)}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDelete={onDelete}
                    onComplete={onComplete}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FAB: phone-only floating + New item button (z-30, below StickyActionBar z-40) */}
      {isMobile && (
        <button
          type="button"
          onClick={handleFabClick}
          className={[
            'fixed z-30 right-4 size-14 rounded-full shadow-lg',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'flex items-center justify-center',
          ].join(' ')}
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
          aria-label="New item"
        >
          <Plus className="size-6" />
        </button>
      )}
    </div>
  );
}
