/**
 * CalendarPill — reusable calendar item pill.
 *
 * Renders in every view (month compact, week/day full). Accepts:
 *   item:           CalendarItem to display
 *   compact:        true in month view (line-clamp-1, no timestamp)
 *   flashing:       true = 300ms amber arrival flash
 *   past:           true = past-dated item (opacity-70 + cursor-not-allowed)
 *   ghost:          true = ghost mode (lower opacity, pointer-events-none — used by CalendarDragGhost)
 *   draggingId:     id of the item currently being dragged (renders origin at 40% opacity)
 *   onOpenDetails:  body-click handler (not the title — title has its own click handler)
 *   onTitleClick:   title-specific click (enters inline-edit mode)
 *   onDragStart:    drag-start handler (called with the DragEvent and the item)
 *   onDragEnd:      drag-end handler
 *
 * Source color/icon map:
 *   task     → emerald-500 stripe + CheckCircle2
 *   event    → indigo-500 stripe + Calendar
 *   linkedin → violet-500 stripe + Linkedin
 *
 * Plan 44-04 (base), extended in Plan 44-05 (drag + click split + ghost mode),
 * extended in Plan 50-03 (mobile: min-h-7, no tooltip, full-pill tap target),
 * extended in Plan 50-04 (mobile: long-press → PillActionSheet; drag gate !isMobile && !past && !ghost).
 */
import { useState } from 'react';
import { CheckCircle2, Calendar, Linkedin, ListTodo, CalendarClock, Trash2 } from 'lucide-react';
import { formatIstTime } from '@/lib/ist';
import { useViewport } from '@/hooks/useViewport';
import { useLongPress } from '@/hooks/useLongPress';
import { InlineTitleEdit } from './InlineTitleEdit';
import { PillActionSheet } from './PillActionSheet';
import type { CalendarItem } from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// 1×1 transparent PNG singleton — suppresses native drag-image.
// Allocated once per module; data-URL is a valid minimal PNG.
// -----------------------------------------------------------------------

const TRANSPARENT_PNG = new Image();
TRANSPARENT_PNG.src =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// -----------------------------------------------------------------------
// Source → visual config
// -----------------------------------------------------------------------

// Source-level visual fallbacks. For gtasks/gcal the real color comes from
// `item.sourceFields.color` (hashed per listId/calendarId on the server);
// the map entries below are defaults applied when a color override is absent.
const SOURCE_STRIPE = {
  task: 'border-emerald-500',
  event: 'border-indigo-500',
  linkedin: 'border-violet-500',
  gtasks: 'border-sky-500',
  gcal: 'border-rose-500',
} as const;

const SOURCE_BG = {
  task: 'bg-emerald-500/10 hover:bg-emerald-500/20',
  event: 'bg-indigo-500/10 hover:bg-indigo-500/20',
  linkedin: 'bg-violet-500/10 hover:bg-violet-500/20',
  gtasks: 'bg-sky-500/10 hover:bg-sky-500/20',
  gcal: 'bg-rose-500/10 hover:bg-rose-500/20',
} as const;

const SOURCE_ICON = {
  task: CheckCircle2,
  event: Calendar,
  linkedin: Linkedin,
  gtasks: ListTodo,
  gcal: CalendarClock,
} as const;

const SOURCE_ICON_COLOR = {
  task: 'text-emerald-500',
  event: 'text-indigo-500',
  linkedin: 'text-violet-500',
  gtasks: 'text-sky-500',
  gcal: 'text-rose-500',
} as const;

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

interface CalendarPillProps {
  item: CalendarItem;
  compact?: boolean;
  flashing?: boolean;
  past?: boolean;
  /** Ghost mode: used by CalendarDragGhost for the floating pill clone. */
  ghost?: boolean;
  /** ID of the item currently being dragged; its origin pill renders at 40% opacity. */
  draggingId?: string | null;
  onOpenDetails?: () => void;
  /** Title-specific click — enters inline-edit mode (stopPropagation from body click). */
  onTitleClick?: (e: React.MouseEvent) => void;
  /** When set to this item's id, renders InlineTitleEdit in place of the title span. */
  editingId?: string | null;
  onTitleCommit?: (item: CalendarItem, newTitle: string) => void;
  onTitleCancel?: (item: CalendarItem) => void;
  onDragStart?: (e: React.DragEvent, item: CalendarItem) => void;
  onDragEnd?: (e: React.DragEvent, item: CalendarItem) => void;
  /** Delete callback — shows Trash2 icon on hover (non-compact, non-ghost). */
  onDelete?: (item: CalendarItem) => void;
  /**
   * Plan 46-04 — gtasks-only "Mark complete" long-press action. Threaded
   * through to PillActionSheet; caller returns the item.id on success so
   * Calendar.tsx can add it to deletedIds for optimistic removal.
   */
  onComplete?: (item: CalendarItem) => Promise<string | undefined>;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function CalendarPill({
  item,
  compact = false,
  flashing = false,
  past = false,
  ghost = false,
  draggingId = null,
  onOpenDetails,
  onTitleClick,
  editingId = null,
  onTitleCommit,
  onTitleCancel,
  onDragStart,
  onDragEnd,
  onDelete,
  onComplete,
}: CalendarPillProps) {
  const { isMobile } = useViewport();
  const Icon = SOURCE_ICON[item.source];
  const stripeClass = SOURCE_STRIPE[item.source];
  const bgClass = SOURCE_BG[item.source];
  const iconColor = SOURCE_ICON_COLOR[item.source];
  const isRtl = item.language === 'he';

  // GCAL-06 — gcal items are read-only in the dashboard calendar. The server
  // also marks sourceFields.readOnly=true, but the source check is the
  // authoritative guard since any future read-only source can opt in the same
  // way the gtasks source does NOT.
  const isReadOnly =
    item.source === 'gcal' || (item.sourceFields as Record<string, unknown>)?.readOnly === true;

  // Origin pill fades to 40% during drag; ghost pill is 70% (stable).
  const isDraggingOrigin = draggingId === item.id;

  // Mobile: 28px min-height, smaller padding — source color left bar preserved.
  const mobileClasses = isMobile ? 'min-h-7 text-xs px-2 py-1' : '';

  // Mobile long-press → action sheet. Desktop: not attached (drag/click unaffected).
  const [sheetOpen, setSheetOpen] = useState(false);
  const longPressHandlers = useLongPress(() => {
    if (ghost) return; // ghost pills don't open action sheet
    const vibrate = typeof window !== 'undefined' && typeof window.navigator?.vibrate === 'function';
    if (vibrate) window.navigator.vibrate(10);
    setSheetOpen(true);
  }, { ms: 500 });
  const phoneInteractionProps = isMobile ? longPressHandlers : {};

  // openInlineEdit: triggers the title-click handler to enter inline-edit mode.
  // On mobile, InlineTitleEdit immediately shows as a Dialog bottom-sheet (Plan 50-03).
  function openInlineEdit() {
    if (onTitleClick) {
      // Create a synthetic MouseEvent — InlineTitleEdit's mobile branch ignores the event object.
      const syntheticEvent = new MouseEvent('click', { bubbles: false }) as unknown as React.MouseEvent;
      onTitleClick(syntheticEvent);
    }
  }

  function handleDragStart(e: React.DragEvent) {
    if (past) {
      e.preventDefault();
      return;
    }
    // Suppress browser's native drag image — we render our own portal ghost.
    e.dataTransfer.setDragImage(TRANSPARENT_PNG, 0, 0);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'application/calendar-item',
      JSON.stringify({ id: item.id, source: item.source, originStartMs: item.start }),
    );
    onDragStart?.(e, item);
  }

  function handleDragEnd(e: React.DragEvent) {
    onDragEnd?.(e, item);
  }

  const pillContent = (
    <>
    <button
      type="button"
      dir={isRtl ? 'rtl' : 'ltr'}
      draggable={!isMobile && !past && !ghost && !isReadOnly}
      onDragStart={isMobile || isReadOnly ? undefined : handleDragStart}
      onDragEnd={isMobile || isReadOnly ? undefined : handleDragEnd}
      {...phoneInteractionProps}
      onClick={ghost ? undefined : onOpenDetails}
      // On mobile, suppress title attribute — tooltip would block tap action.
      title={isMobile ? undefined : past ? 'Past item' : item.title}
      className={[
        'group relative w-full rounded-sm text-left border-l-[3px] px-1.5 py-0.5 text-xs',
        stripeClass,
        bgClass,
        mobileClasses,
        'transition-colors duration-[300ms]',
        flashing ? 'bg-amber-100 dark:bg-amber-900/30' : '',
        past ? 'opacity-70 cursor-not-allowed' : isReadOnly ? 'cursor-default' : 'cursor-pointer',
        isDraggingOrigin ? 'opacity-40' : '',
        ghost ? 'pointer-events-none opacity-90' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={`flex items-start gap-1 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <Icon className={`shrink-0 mt-0.5 size-3 ${iconColor}`} />
        {/* Title — click enters inline-edit mode (stopPropagation prevents body-click). */}
        {editingId === item.id ? (
          <InlineTitleEdit
            value={item.title}
            dir={isRtl ? 'rtl' : 'ltr'}
            onCommit={(v) => onTitleCommit?.(item, v)}
            onCancel={() => onTitleCancel?.(item)}
          />
        ) : (
          <span
            className={compact ? 'line-clamp-1' : 'line-clamp-2'}
            onClick={
              isReadOnly
                ? undefined  // GCAL-06 — read-only pills do not open the inline title editor
                : onTitleClick
                ? (e) => { e.stopPropagation(); onTitleClick(e); }
                : undefined
            }
          >
            {item.title}
          </span>
        )}
      </div>
      {!compact && !item.isAllDay && (
        <div className="text-muted-foreground mt-0.5 pl-4 text-[10px]">
          {formatIstTime(item.start)}
        </div>
      )}
      {/* Trash icon — visible on every non-ghost, non-read-only pill (including
          compact month pills and short week/day pills). Uses span (not button)
          because the outer element is already a <button> and HTML5 forbids
          nested interactive buttons. Gcal pills suppress this — GCAL-06. */}
      {!ghost && !isReadOnly && onDelete && (
        <span
          role="button"
          tabIndex={0}
          className="absolute top-0.5 right-0.5 p-0.5 opacity-40 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onDelete(item);
            }
          }}
          title="Delete"
          aria-label="Delete item"
        >
          <Trash2 className="size-3" />
        </span>
      )}
    </button>
    {isMobile && sheetOpen && (
      <PillActionSheet
        item={item}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onEditTitle={openInlineEdit}
        onDelete={onDelete}
        onComplete={onComplete}
      />
    )}
    </>
  );

  // On mobile: return the pill directly (no tooltip wrapper — tap = action).
  // On desktop: return the pill as-is (tooltip was never a wrapper here; it's
  // driven by the `title` attribute which is suppressed on mobile above).
  return pillContent;
}
