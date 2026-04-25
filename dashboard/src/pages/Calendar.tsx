/**
 * /calendar — unified editable calendar page.
 *
 * Three data sources rendered independently:
 *   tasks (emerald) / events (indigo) / linkedin (violet)
 *
 * Interaction affordances (Plan 44-05):
 *   - Drag-to-reschedule with custom CalendarDragGhost portal (live timestamp)
 *   - Inline title edit on title-click (InlineTitleEdit)
 *   - Create from empty slot (CreateItemPopover)
 *   - Body-click → edit dialog (EditPostDialog for LinkedIn; local Dialog for task/event)
 *   - Optimistic override layer: pills move instantly on drop
 *   - Undo toast (5s) on every reschedule
 *
 * Plan 44-04 (base), extended in Plan 44-05 (all interaction).
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import { useViewport } from '@/hooks/useViewport';
import { useCalendarViewMode } from '@/hooks/useCalendarViewMode';
import { useHorizontalSwipe } from '@/hooks/useHorizontalSwipe';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useCalendarStream } from '@/hooks/useCalendarStream';
import {
  useRescheduleMutation,
  useInlineEditMutation,
  useDeleteMutation,
  useCompleteMutation,
} from '@/hooks/useCalendarMutations';
import { CalendarHeader } from '@/components/calendar/CalendarHeader';
import {
  CalendarFilterPanel,
  CalendarFilterPanelSheet,
} from '@/components/calendar/CalendarFilterPanel';
import { useCalendarFilter } from '@/hooks/useCalendarFilter';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import { DayView } from '@/components/calendar/DayView';
import { MonthDotsView } from '@/components/calendar/MonthDotsView';
import { CreateItemPopover, type CreateItemAnchor } from '@/components/calendar/CreateItemPopover';
import { CalendarDragGhost, useCalendarDragGhost } from '@/components/calendar/CalendarDragGhost';
import { EditPostDialog } from '@/components/linkedin/EditPostDialog';
import { addIstDays } from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';
import type { LinkedInPost } from '@/components/linkedin/postStatus';

// -----------------------------------------------------------------------
// Arrival flash hook (calendar items)
// -----------------------------------------------------------------------

const FLASH_MS = 300;

function useCalendarArrivalFlash(items: CalendarItem[]): Set<string> {
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const prevIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentIds = new Set(items.map((i) => i.id));

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
// Lightweight task edit dialog (calendar-local — no full Tasks page dialog exists)
// -----------------------------------------------------------------------

interface TaskEditDialogProps {
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimistic: (item: CalendarItem, toMs: number) => void;
}

function TaskEditDialog({ item, open, onOpenChange, onOptimistic }: TaskEditDialogProps) {
  const [title, setTitle] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [saving, setSaving] = useState(false);

  const { mutate: inlineEdit } = useInlineEditMutation();
  const { mutate: reschedule } = useRescheduleMutation({ onOptimistic });

  useEffect(() => {
    if (open && item) {
      setTitle(item.title);
      const d = new Date(item.start);
      setDateInput(d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })); // YYYY-MM-DD
      setTimeInput(d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }));
    }
  }, [open, item]);

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    try {
      const titleChanged = title.trim() !== item.title;
      if (titleChanged) {
        await inlineEdit({ item, newTitle: title.trim() });
      }

      const [h, m] = timeInput.split(':').map(Number);
      const [year, month, day] = dateInput.split('-').map(Number);
      const newMs = new Date(year, month - 1, day, h, m, 0).getTime();
      if (Math.abs(newMs - item.start) > 60_000) {
        await reschedule({ item, toMs: newMs });
      }

      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border border-input bg-background rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            placeholder="Task title"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className="border border-input bg-background rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring flex-1"
            />
            <input
              type="time"
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              className="border border-input bg-background rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring w-24"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------
// Lightweight event edit dialog (calendar-local)
// -----------------------------------------------------------------------

interface EventEditDialogProps {
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimistic: (item: CalendarItem, toMs: number) => void;
}

function EventEditDialog({ item, open, onOpenChange, onOptimistic }: EventEditDialogProps) {
  const [title, setTitle] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [saving, setSaving] = useState(false);

  const { mutate: inlineEdit } = useInlineEditMutation();
  const { mutate: reschedule } = useRescheduleMutation({ onOptimistic });

  useEffect(() => {
    if (open && item) {
      setTitle(item.title);
      const d = new Date(item.start);
      setDateInput(d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }));
      setTimeInput(d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }));
    }
  }, [open, item]);

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    try {
      if (title.trim() !== item.title) {
        await inlineEdit({ item, newTitle: title.trim() });
      }

      const [h, m] = timeInput.split(':').map(Number);
      const [year, month, day] = dateInput.split('-').map(Number);
      const newMs = new Date(year, month - 1, day, h, m, 0).getTime();
      if (Math.abs(newMs - item.start) > 60_000) {
        await reschedule({ item, toMs: newMs });
      }

      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Event</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border border-input bg-background rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            placeholder="Event title"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className="border border-input bg-background rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring flex-1"
            />
            <input
              type="time"
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              className="border border-input bg-background rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring w-24"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------

export default function CalendarPage() {
  const { view, setView, availableViews } = useCalendarViewMode();
  const { isMobile } = useViewport();
  const [cursorMs, setCursorMs] = useState(() => Date.now());

  const { tasks, events, linkedin, gcal, gtasks, sseStatus, refetch } = useCalendarStream();

  // ---- Optimistic override layer ----
  // Maps item.id → new startMs. Merged onto allItems before passing to views.
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());

  function applyOptimistic(item: CalendarItem, toMs: number) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(item.id, toMs);
      return next;
    });
  }

  function rollbackOptimistic(item: CalendarItem, fromMs: number) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(item.id, fromMs);
      return next;
    });
  }

  // ---- Optimistic delete layer ----
  // Items whose id is in deletedIds are filtered out of allItems immediately.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  function applyDeleteOptimistic(item: CalendarItem) {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
  }

  function rollbackDelete(item: CalendarItem) {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  }

  const { mutate: deleteMutate } = useDeleteMutation({
    onOptimistic: applyDeleteOptimistic,
    onRollback: rollbackDelete,
  });

  // Plan 46-04 — gtasks-only Complete mutation. No optimistic hook here;
  // the hook resolves to the item.id on success and we add it to deletedIds
  // (reusing the existing Set) so the pill disappears from the grid.
  const { mutate: completeMutate } = useCompleteMutation();

  // ---- Inline title edit state ----
  const [inlineEditItem, setInlineEditItem] = useState<CalendarItem | null>(null);
  const [inlineTitles, setInlineTitles] = useState<Map<string, string>>(new Map());

  const { mutate: inlineEditMutate } = useInlineEditMutation({
    onOptimistic: (item, newTitle) => {
      setInlineTitles((prev) => new Map(prev).set(item.id, newTitle));
    },
    onRollback: (item) => {
      setInlineTitles((prev) => {
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
    },
  });

  // ---- Drag state ----
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const ghost = useCalendarDragGhost();

  const { mutate: rescheduleMutate } = useRescheduleMutation({
    onOptimistic: applyOptimistic,
    onRollback: rollbackOptimistic,
  });

  function handleDragStart(_e: React.DragEvent, item: CalendarItem) {
    setDraggingId(item.id);
    ghost.show(item);
  }

  function handleDragEnd(_e: React.DragEvent, _item: CalendarItem) {
    setDraggingId(null);
    ghost.hide();
  }

  // ---- Horizontal swipe (phone only — day / 3day navigation) ----
  const dayContainerRef = useRef<HTMLDivElement | null>(null);
  useHorizontalSwipe(dayContainerRef, {
    onLeft: () => {
      if (isMobile && (view === 'day' || view === '3day')) {
        setCursorMs((ms) => addIstDays(ms, +1));
      }
    },
    onRight: () => {
      if (isMobile && (view === 'day' || view === '3day')) {
        setCursorMs((ms) => addIstDays(ms, -1));
      }
    },
  });

  // ---- Create popover ----
  const [createAnchor, setCreateAnchor] = useState<CreateItemAnchor | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  function openCreatePopover(dayMs: number, hour: number, minute: number) {
    if (hour < 0) return; // sentinel from overflow badge — skip
    const hourMs = dayMs + (hour * 60 + minute) * 60_000;
    setCreateAnchor({ dateMs: dayMs, hourMs });
    setCreateOpen(true);
  }

  // ---- Body-click dialogs ----
  const [taskEditItem, setTaskEditItem] = useState<CalendarItem | null>(null);
  const [taskEditOpen, setTaskEditOpen] = useState(false);
  const [eventEditItem, setEventEditItem] = useState<CalendarItem | null>(null);
  const [eventEditOpen, setEventEditOpen] = useState(false);
  const [linkedinEditPost, setLinkedinEditPost] = useState<LinkedInPost | null>(null);
  const [linkedinEditOpen, setLinkedinEditOpen] = useState(false);

  function handleOpenItem(item: CalendarItem) {
    if (item.source === 'task') {
      setTaskEditItem(item);
      setTaskEditOpen(true);
    } else if (item.source === 'event') {
      setEventEditItem(item);
      setEventEditOpen(true);
    } else {
      // Reconstruct a minimal LinkedInPost from sourceFields for EditPostDialog
      const sf = item.sourceFields as Record<string, unknown>;
      const post: LinkedInPost = {
        id: item.id,
        sequence_id: (sf.sequence_id as string) ?? '',
        position: (sf.position as number) ?? 0,
        status: (sf.status as string) ?? 'APPROVED',
        perspective: (sf.perspective as string) ?? '',
        language: item.language,
        project_name: (sf.project_name as string) ?? '',
        source_snippet: (sf.source_snippet as string) ?? null,
        content: (sf.content as string) ?? item.title,
        content_he: (sf.content_he as string) ?? null,
        image: {
          source: null,
          url: null,
          pii_reviewed: false,
          ...(sf.image as object ?? {}),
        },
        variants: [],
        lesson_candidates: [],
        regeneration_count: 0,
        regeneration_capped: false,
        share_urn: null,
        scheduled_at: new Date(item.start).toISOString(),
        published_at: null,
        created_at: new Date(item.start).toISOString(),
        updated_at: null,
      };
      setLinkedinEditPost(post);
      setLinkedinEditOpen(true);
    }
  }

  // ---- Merge items + overrides + inline title edits ----
  const rawItems = useMemo(
    () => [...tasks.items, ...events.items, ...linkedin.items, ...gcal.items, ...gtasks.items],
    [tasks.items, events.items, linkedin.items, gcal.items, gtasks.items],
  );

  const allItems = useMemo(() => {
    return rawItems
      .filter((item) => !deletedIds.has(item.id))
      .map((item) => {
        const overriddenStart = overrides.get(item.id);
        const overriddenTitle = inlineTitles.get(item.id);
        if (!overriddenStart && !overriddenTitle) return item;
        return {
          ...item,
          ...(overriddenStart !== undefined ? { start: overriddenStart } : {}),
          ...(overriddenTitle !== undefined ? { title: overriddenTitle } : {}),
        };
      })
      .sort((a, b) => a.start - b.start);
  }, [rawItems, overrides, inlineTitles, deletedIds]);

  // ---- Filter layer (Phase 46 Plan 03 + Phase 47 Plan 03) ----
  const {
    prefs,
    gtasksLists,
    gcalCalendars,
    filteredItems,
    toggleList,
    overrideListColor,
    toggleCalendar,
    overrideCalendarColor,
    mobileFilterOpen,
    setMobileFilterOpen,
  } = useCalendarFilter(allItems);

  const flashingIds = useCalendarArrivalFlash(filteredItems);

  const allLoading =
    tasks.status === 'loading' &&
    events.status === 'loading' &&
    linkedin.status === 'loading' &&
    gcal.status === 'loading' &&
    gtasks.status === 'loading';

  const reconnecting = sseStatus === 'reconnecting';

  // Shared reschedule interface passed to views
  const rescheduleObj = {
    onOptimistic: applyOptimistic,
    onRollback: rollbackOptimistic,
    mutate: rescheduleMutate,
  };

  // Inline title edit handlers
  function handleTitleCommit(item: CalendarItem, newTitle: string) {
    setInlineEditItem(null);
    void inlineEditMutate({ item, newTitle });
  }

  function handleTitleCancel(_item: CalendarItem) {
    setInlineEditItem(null);
  }

  // Shared view props
  const sharedViewProps = {
    items: filteredItems,
    flashingIds,
    draggingId,
    editingId: inlineEditItem?.id ?? null,
    ghost,
    reschedule: rescheduleObj,
    onOpenItem: handleOpenItem,
    onTitleClick: (item: CalendarItem) => setInlineEditItem(item),
    onTitleCommit: handleTitleCommit,
    onTitleCancel: handleTitleCancel,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDelete: (item: CalendarItem) => void deleteMutate(item),
    /**
     * Plan 46-04 — gtasks-only Complete action. Wraps completeMutate so the
     * returned item.id is added to deletedIds (reuses the existing optimistic
     * remove Set). Returning the id from the async fn allows PillActionSheet
     * to close the sheet on success and keep it open on failure.
     */
    onComplete: async (item: CalendarItem): Promise<string | undefined> => {
      const removedId = await completeMutate({ item });
      if (removedId) applyDeleteOptimistic(item);
      return removedId;
    },
  };

  // Shared filter-panel props — used by both desktop left-rail + mobile sheet
  const filterPanelProps = {
    prefs,
    gtasksLists,
    onToggleList: toggleList,
    onOverrideColor: overrideListColor,
    gcalCalendars,
    onToggleCalendar: toggleCalendar,
    onOverrideCalendarColor: overrideCalendarColor,
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* Desktop left-rail filter panel (hidden below lg) */}
      <aside className="hidden lg:block">
        <CalendarFilterPanel {...filterPanelProps} />
      </aside>

      {/* Mobile filter sheet (hidden on lg+) */}
      <CalendarFilterPanelSheet
        {...filterPanelProps}
        open={mobileFilterOpen}
        onOpenChange={setMobileFilterOpen}
      />

      <div className="flex flex-col gap-4 flex-1 min-w-0">
      {/* Header with title + navigation + view switcher */}
      <CalendarHeader
        view={view}
        setView={setView}
        availableViews={availableViews}
        cursorMs={cursorMs}
        setCursorMs={setCursorMs}
        reconnecting={reconnecting}
        onFilterOpen={() => setMobileFilterOpen(true)}
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
        {gcal.status === 'error' && (
          <SourceBanner
            label="Google Calendar unavailable"
            onRetry={() => refetch('gcal')}
          />
        )}
        {gtasks.status === 'error' && (
          <SourceBanner
            label="Google Tasks unavailable"
            onRetry={() => refetch('gtasks')}
          />
        )}
      </div>

      {/* Per-source loading banners */}
      {(tasks.status === 'loading' || events.status === 'loading' || linkedin.status === 'loading' || gcal.status === 'loading' || gtasks.status === 'loading') && (
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
          {gcal.status === 'loading' && (
            <span className="flex items-center gap-1">
              <Skeleton className="size-2 rounded-full inline-block" />
              Loading Google Calendar…
            </span>
          )}
          {gtasks.status === 'loading' && (
            <span className="flex items-center gap-1">
              <Skeleton className="size-2 rounded-full inline-block" />
              Loading Google Tasks…
            </span>
          )}
        </div>
      )}

      {/* Calendar body */}
      {allLoading ? (
        <SkeletonCalendar />
      ) : view === 'month' ? (
        // Desktop only — useCalendarViewMode prevents view==='month' on mobile
        <MonthView
          {...sharedViewProps}
          cursorMs={cursorMs}
          onDaySlotClick={(dayMs) => openCreatePopover(dayMs, 9, 0)}
        />
      ) : view === 'week' ? (
        // Desktop only — useCalendarViewMode prevents view==='week' on mobile
        <WeekView
          {...sharedViewProps}
          cursorMs={cursorMs}
          onSlotClick={openCreatePopover}
        />
      ) : view === 'dots' ? (
        // Phone only — useCalendarViewMode prevents view==='dots' on desktop
        <MonthDotsView
          items={filteredItems}
          cursorMs={cursorMs}
          onSelectDay={(dayMs) => { setCursorMs(dayMs); setView('day'); }}
        />
      ) : view === '3day' ? (
        // Phone only — 3-day view as horizontally-scrollable column of 3 DayViews
        <div ref={dayContainerRef} className="flex gap-2 overflow-x-auto">
          {[-1, 0, 1].map((offset) => (
            <div key={offset} className="min-w-0 flex-1">
              <DayView
                {...sharedViewProps}
                cursorMs={addIstDays(cursorMs, offset)}
                onSlotClick={openCreatePopover}
              />
            </div>
          ))}
        </div>
      ) : (
        // Day view (default on phone, also available on desktop)
        <div ref={dayContainerRef}>
          <DayView
            {...sharedViewProps}
            cursorMs={cursorMs}
            onSlotClick={openCreatePopover}
          />
        </div>
      )}

      {/* Empty state */}
      {!allLoading && filteredItems.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-8">
          Nothing scheduled here. Click any slot to create.
        </div>
      )}

      {/* ---- Global interaction overlays ---- */}

      {/* Drag ghost — portal to document.body */}
      <CalendarDragGhost />

      {/* Create popover */}
      <CreateItemPopover
        anchor={createAnchor}
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setCreateAnchor(null);
        }}
        onCreated={() => {
          void refetch('tasks');
          void refetch('events');
        }}
      />

      {/* Task edit dialog */}
      <TaskEditDialog
        item={taskEditItem}
        open={taskEditOpen}
        onOpenChange={(o) => { setTaskEditOpen(o); if (!o) setTaskEditItem(null); }}
        onOptimistic={applyOptimistic}
      />

      {/* Event edit dialog */}
      <EventEditDialog
        item={eventEditItem}
        open={eventEditOpen}
        onOpenChange={(o) => { setEventEditOpen(o); if (!o) setEventEditItem(null); }}
        onOptimistic={applyOptimistic}
      />

      {/* LinkedIn edit dialog (EditPostDialog from Phase 36) */}
      <EditPostDialog
        post={linkedinEditPost}
        open={linkedinEditOpen}
        onOpenChange={(o) => { setLinkedinEditOpen(o); if (!o) setLinkedinEditPost(null); }}
        onSaved={() => void refetch('linkedin')}
      />
      </div>
    </div>
  );
}
