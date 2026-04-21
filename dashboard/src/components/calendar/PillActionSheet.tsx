import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useRescheduleMutation } from '@/hooks/useCalendarMutations';
import type { CalendarItem } from '@/api/calendarSchemas';

type Props = {
  item: CalendarItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditTitle: () => void;            // delegates to InlineTitleEdit's bottom-sheet
  onDelete?: (item: CalendarItem) => void;  // forwarded from CalendarPill's existing onDelete prop
  /**
   * Phase 46 Plan 04 — gtasks-only "Mark complete" action. When the user taps
   * Complete on a gtasks pill, the parent wires this to useCompleteMutation;
   * the returned item.id (on success) is added to the parent's deletedIds
   * Set so the pill disappears optimistically. Absent or returning undefined
   * keeps the sheet open (e.g. a 502 from the gtasks proxy).
   */
  onComplete?: (item: CalendarItem) => Promise<string | undefined>;
};

/**
 * Bottom-sheet action menu opened by long-press on a CalendarPill (phone-only).
 * Reschedule → native <input type="datetime-local"> → useRescheduleMutation().mutate({item, toMs})
 * (same backend contract as desktop drag-and-drop reschedule).
 * Delete → forwards to the parent-provided onDelete (same path as the desktop Trash2 icon at
 * CalendarPill.tsx:188-209 — runs the existing useDeleteMutation in the parent, no new mutation).
 * Haptic on open + per-action via navigator.vibrate(10) when available.
 *
 * IST assumption: the dashboard expects the device timezone to be IST (Yuval's device is).
 * `new Date(YYYY-MM-DDTHH:mm)` interprets the string in device local time which IS IST,
 * matching the bot server's TZ. Non-IST devices may produce unexpected reschedule times —
 * non-issue for the single-user deployment (documented in must_haves).
 */
export function PillActionSheet({ item, open, onOpenChange, onEditTitle, onDelete, onComplete }: Props) {
  const { mutate: reschedule } = useRescheduleMutation();
  const [showPicker, setShowPicker] = React.useState(false);

  // GCAL-06 — gcal items are read-only: no Reschedule / Edit / Delete,
  // only an "Open in Google Calendar" link + Cancel. htmlLink is populated
  // by the server projection in googleCalendar.ts.
  const isGcal = item.source === 'gcal';
  const htmlLink = isGcal ? ((item.sourceFields as Record<string, unknown>)?.htmlLink as string | undefined) : undefined;

  // Pre-fill picker with current slot in the device's local timezone (IST on Yuval's device).
  const initialValue = React.useMemo(() => formatLocalDateTimeInput(item.start), [item.start]);
  const [picked, setPicked] = React.useState(initialValue);

  const vibrate = (ms = 10) => {
    if (typeof window !== 'undefined' && typeof window.navigator?.vibrate === 'function') {
      window.navigator.vibrate(ms);
    }
  };
  React.useEffect(() => { if (open) vibrate(10); }, [open]);

  // Reset picker state when sheet opens
  React.useEffect(() => {
    if (open) {
      setShowPicker(false);
      setPicked(formatLocalDateTimeInput(item.start));
    }
  }, [open, item.start]);

  const submitReschedule = async () => {
    // datetime-local returns "YYYY-MM-DDTHH:mm" with no timezone suffix.
    // new Date(value) interprets in the device's local TZ (IST on Yuval's device).
    const newDate = new Date(picked);
    await reschedule({ item, toMs: newDate.getTime() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed bottom-0 left-0 right-0 top-auto translate-x-0 translate-y-0 max-w-none rounded-b-none rounded-t-2xl pb-[max(env(safe-area-inset-bottom),1rem)]"
      >
        <DialogHeader>
          <DialogTitle>{item.title}</DialogTitle>
        </DialogHeader>

        {!showPicker && (
          <div className="grid gap-2">
            {/* Reschedule / Edit title / Delete — suppressed entirely for gcal (GCAL-06) */}
            {!isGcal && (
              <Button onClick={() => { vibrate(); setShowPicker(true); }}>Reschedule</Button>
            )}
            {!isGcal && (
              <Button onClick={() => { vibrate(); onEditTitle(); onOpenChange(false); }} variant="outline">Edit title</Button>
            )}
            {/* Complete — gtasks-only long-press action (CONTEXT §Gtasks pill behavior).
                Plan 46-04. Returns the item.id on success so the parent can add it to
                deletedIds; keep the sheet open on failure (undefined return). */}
            {item.source === 'gtasks' && onComplete && (
              <Button
                variant="outline"
                onClick={async () => {
                  vibrate();
                  const removedId = await onComplete(item);
                  if (removedId) onOpenChange(false);
                }}
              >
                <span className="mr-2">✓</span> Complete
              </Button>
            )}
            {!isGcal && onDelete && (
              <Button
                onClick={() => {
                  vibrate();
                  onDelete(item);            // existing path: parent's useDeleteMutation runs the confirm + DELETE
                  onOpenChange(false);
                }}
                variant="destructive"
              >
                Delete
              </Button>
            )}

            {/* Gcal pills — single view-only action linking to Google Calendar.
                Absent htmlLink (birthdays/holidays) → just the Cancel button. */}
            {isGcal && htmlLink && (
              <Button variant="outline" asChild>
                <a
                  href={htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onOpenChange(false)}
                >
                  Open in Google Calendar
                </a>
              </Button>
            )}

            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
          </div>
        )}

        {showPicker && (
          <div className="grid gap-3">
            <label className="text-sm">New time</label>
            <input
              type="datetime-local"
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              className="border rounded-md px-3 py-2 text-base"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setShowPicker(false)}>Back</Button>
              <Button onClick={submitReschedule}>Save</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Format a date-like value as "YYYY-MM-DDTHH:mm" in the device's local timezone.
 * The device is assumed to be in IST (Yuval's device); see file header.
 *
 * Uses getFullYear/getMonth/etc. (local-TZ methods) NOT getUTCFullYear/etc. —
 * so the displayed time matches what the device shows as wall-clock time (IST).
 *
 * Avoids Intl.DateTimeFormat with timeZone:'Asia/Jerusalem' intentionally:
 * that approach has a subtle DST-boundary bug where lookupthe offset of the
 * literal-as-UTC differs from the true wall-clock instant's offset across
 * spring-forward / fall-back transitions. `new Date(value)` + IST-device
 * assumption is correct for the single-user case and matches how desktop
 * drag-DnD feeds the same useRescheduleMutation.
 */
function formatLocalDateTimeInput(d: Date | string | number): string {
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const mm = pad(dt.getMonth() + 1);
  const dd = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const mi = pad(dt.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
