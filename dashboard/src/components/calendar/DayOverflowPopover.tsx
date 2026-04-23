/**
 * DayOverflowPopover — shows all items for a day when "+N more" is clicked.
 *
 * Desktop: Uses the shadcn Popover primitive (installed in Plan 44-05 Task 1).
 * Phone  : Uses a Radix Dialog in bottom-sheet style (Plan 50-03).
 *
 * Content is a scrollable list of CalendarPills sorted by start time.
 *
 * Props:
 *   dateMs     — unix ms for the day being shown
 *   items      — all CalendarItems for that day (already filtered by caller)
 *   trigger    — the "+N more" button element (passed as trigger child)
 *   open       — controlled open state (optional — uncontrolled if omitted)
 *   onOpenChange — setter for open state (optional)
 *   flashingIds — set of IDs currently flashing (arrival animation)
 *   onOpenItem — called when user clicks a pill in the popover
 *
 * Plan 44-05 (base), extended in Plan 50-03 (mobile bottom-sheet branch).
 */
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useViewport } from '@/hooks/useViewport';
import { CalendarPill } from './CalendarPill';
import { formatIstDateShort } from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';

interface DayOverflowPopoverProps {
  dateMs: number;
  items: CalendarItem[];
  trigger: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  flashingIds?: Set<string>;
  onOpenItem?: (item: CalendarItem) => void;
  onDelete?: (item: CalendarItem) => void;
  /** Plan 46-04 — gtasks-only "Mark complete" action, passed through to CalendarPill. */
  onComplete?: (item: CalendarItem) => Promise<string | undefined>;
}

export function DayOverflowPopover({
  dateMs,
  items,
  trigger,
  open,
  onOpenChange,
  flashingIds = new Set(),
  onOpenItem,
  onDelete,
  onComplete,
}: DayOverflowPopoverProps) {
  const { isMobile } = useViewport();
  const today = Date.now();
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const dateLabel = formatIstDateShort(dateMs);

  // Shared content body — same in both branches
  const body = (
    <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
      {sorted.map((item) => (
        <CalendarPill
          key={item.id}
          item={item}
          compact={false}
          flashing={flashingIds.has(item.id)}
          past={item.start < today}
          onOpenDetails={() => onOpenItem?.(item)}
          onDelete={onDelete}
          onComplete={onComplete}
        />
      ))}
    </div>
  );

  // Phone: bottom-sheet dialog
  if (isMobile) {
    return (
      <>
        {/* Render trigger as-is so it stays visible in the calendar grid */}
        <span onClick={() => onOpenChange?.(!open)}>{trigger}</span>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent
            className={[
              'fixed bottom-0 left-0 right-0 top-auto',
              'translate-x-0 translate-y-0',
              'max-w-none rounded-b-none rounded-t-2xl',
              'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
            ].join(' ')}
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
          >
            <DialogHeader>
              <DialogTitle>{dateLabel} — all items</DialogTitle>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Desktop: existing Popover anchored to trigger
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="text-xs font-semibold text-muted-foreground mb-2 px-1">
          {dateLabel}
        </div>
        {body}
      </PopoverContent>
    </Popover>
  );
}
