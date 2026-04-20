/**
 * DayOverflowPopover — shows all items for a day when "+N more" is clicked.
 *
 * Uses the shadcn Popover primitive (installed in Plan 44-05 Task 1).
 * Content is a scrollable list of CalendarPills sorted by start time.
 *
 * Props:
 *   dateMs     — unix ms for the day being shown
 *   items      — all CalendarItems for that day (already filtered by caller)
 *   trigger    — the "+N more" button element (passed as trigger child)
 *   flashingIds — set of IDs currently flashing (arrival animation)
 *   onOpenItem — called when user clicks a pill in the popover
 *
 * Plan 44-05.
 */
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { CalendarPill } from './CalendarPill';
import { formatIstDateShort } from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';

interface DayOverflowPopoverProps {
  dateMs: number;
  items: CalendarItem[];
  trigger: React.ReactNode;
  flashingIds?: Set<string>;
  onOpenItem?: (item: CalendarItem) => void;
  onDelete?: (item: CalendarItem) => void;
}

export function DayOverflowPopover({
  dateMs,
  items,
  trigger,
  flashingIds = new Set(),
  onOpenItem,
  onDelete,
}: DayOverflowPopoverProps) {
  const today = Date.now();
  const sorted = [...items].sort((a, b) => a.start - b.start);

  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="text-xs font-semibold text-muted-foreground mb-2 px-1">
          {formatIstDateShort(dateMs)}
        </div>
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
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
