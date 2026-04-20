/**
 * CalendarPill — reusable calendar item pill.
 *
 * Renders in every view (month compact, week/day full). Accepts:
 *   item:         CalendarItem to display
 *   compact:      true in month view (line-clamp-1, no timestamp)
 *   flashing:     true = 300ms amber arrival flash
 *   past:         true = past-dated item (opacity-70 + cursor-not-allowed)
 *   onOpenDetails: click handler (Plan 44-05 wires popover here)
 *
 * Source color/icon map:
 *   task     → emerald-500 stripe + CheckCircle2
 *   event    → indigo-500 stripe + Calendar
 *   linkedin → violet-500 stripe + Linkedin
 *
 * Plan 44-04.
 */
import { CheckCircle2, Calendar, Linkedin } from 'lucide-react';
import { formatIstTime } from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// Source → visual config
// -----------------------------------------------------------------------

const SOURCE_STRIPE = {
  task: 'border-emerald-500',
  event: 'border-indigo-500',
  linkedin: 'border-violet-500',
} as const;

const SOURCE_BG = {
  task: 'bg-emerald-500/10 hover:bg-emerald-500/20',
  event: 'bg-indigo-500/10 hover:bg-indigo-500/20',
  linkedin: 'bg-violet-500/10 hover:bg-violet-500/20',
} as const;

const SOURCE_ICON = {
  task: CheckCircle2,
  event: Calendar,
  linkedin: Linkedin,
} as const;

const SOURCE_ICON_COLOR = {
  task: 'text-emerald-500',
  event: 'text-indigo-500',
  linkedin: 'text-violet-500',
} as const;

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

interface CalendarPillProps {
  item: CalendarItem;
  compact?: boolean;
  flashing?: boolean;
  past?: boolean;
  onOpenDetails?: () => void;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function CalendarPill({
  item,
  compact = false,
  flashing = false,
  past = false,
  onOpenDetails,
}: CalendarPillProps) {
  const Icon = SOURCE_ICON[item.source];
  const stripeClass = SOURCE_STRIPE[item.source];
  const bgClass = SOURCE_BG[item.source];
  const iconColor = SOURCE_ICON_COLOR[item.source];
  const isRtl = item.language === 'he';

  return (
    <button
      type="button"
      dir={isRtl ? 'rtl' : 'ltr'}
      onClick={onOpenDetails}
      title={past ? 'Past item' : item.title}
      className={[
        'w-full rounded-sm text-left border-l-[3px] px-1.5 py-0.5 text-xs',
        stripeClass,
        bgClass,
        'transition-colors duration-[300ms]',
        flashing ? 'bg-amber-100 dark:bg-amber-900/30' : '',
        past ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={`flex items-start gap-1 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <Icon className={`shrink-0 mt-0.5 size-3 ${iconColor}`} />
        <span className={compact ? 'line-clamp-1' : 'line-clamp-2'}>
          {item.title}
        </span>
      </div>
      {!compact && !item.isAllDay && (
        <div className="text-muted-foreground mt-0.5 pl-4 text-[10px]">
          {formatIstTime(item.start)}
        </div>
      )}
    </button>
  );
}
