/**
 * useCalendarMutations — optimistic mutation hook family for the calendar.
 *
 * Three exported hooks:
 *   useRescheduleMutation  — drag-to-reschedule for task / event / linkedin
 *   useInlineEditMutation  — title edit for task / event / linkedin
 *   useCreateMutation      — create-from-empty-slot for task / event
 *                            (LinkedIn: navigate to /linkedin/queue, not POST)
 *
 * All hooks follow the same pattern:
 *   1. Optimistic callback fires immediately (caller moves the pill visually)
 *   2. PATCH/POST fires in background
 *   3. On error: rollback callback + red toast
 *   4. On success: undo toast (reschedule only) or confirm toast
 *
 * LinkedIn create-from-calendar concession:
 *   pm-authority has no public "create approved post at scheduled_at" endpoint
 *   — its flow is lesson-run → variant-pick → approve. So if the user picks
 *   "LinkedIn post" in CreateItemPopover, the save button navigates to
 *   /linkedin/queue?intent=create and does NOT POST directly here.
 *   useCreateMutation does not handle the linkedin source for this reason.
 *
 * Plan 44-05.
 */
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiFetch } from '@/api/client';
import type { CalendarItem } from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// useRescheduleMutation
// -----------------------------------------------------------------------

export interface RescheduleMutationOpts {
  /** Called immediately when mutation starts — use to move the pill optimistically. */
  onOptimistic?: (item: CalendarItem, toMs: number) => void;
  /** Called if the server returns an error — use to revert the pill. */
  onRollback?: (item: CalendarItem, fromMs: number) => void;
}

export interface RescheduleArgs {
  item: CalendarItem;
  toMs: number;
}

/**
 * Returns a mutate fn that reschedules a calendar item.
 * Pattern: optimistic → PATCH/POST → undo toast or error toast.
 */
export function useRescheduleMutation(opts?: RescheduleMutationOpts) {
  const mutate = async ({ item, toMs }: RescheduleArgs): Promise<void> => {
    const fromMs = item.start;

    // Step 1: optimistic update
    opts?.onOptimistic?.(item, toMs);

    try {
      let response: unknown;
      if (item.source === 'task') {
        response = await apiFetch(`/api/actionables/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ fireAt: toMs }),
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (item.source === 'event') {
        response = await apiFetch(`/api/personal-calendar/events/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ eventDate: toMs }),
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        // linkedin — server snaps to next valid Tue/Wed/Thu slot
        response = await apiFetch(`/api/linkedin/posts/${encodeURIComponent(item.id)}/reschedule`, {
          method: 'POST',
          body: JSON.stringify({ scheduled_at: new Date(toMs).toISOString() }),
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // LinkedIn: surface snapped-slot caption if server moved the time.
      let snappedMs = toMs;
      if (
        item.source === 'linkedin' &&
        response &&
        typeof response === 'object' &&
        'scheduled_at' in (response as Record<string, unknown>)
      ) {
        const serverMs = new Date((response as { scheduled_at: string }).scheduled_at).getTime();
        if (Math.abs(serverMs - toMs) > 60_000) {
          snappedMs = serverMs;
          const snappedLabel = new Date(serverMs).toLocaleString('en-GB', {
            timeZone: 'Asia/Jerusalem',
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          toast(`Moved to next available slot: ${snappedLabel}`);
          // Update pill to snapped position
          opts?.onOptimistic?.(item, serverMs);
        }
      }

      // Undo toast — 5s
      const truncTitle = item.title.slice(0, 40);
      toast(`Moved "${truncTitle}"`, {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            void (async () => {
              try {
                if (item.source === 'task') {
                  await apiFetch(`/api/actionables/${encodeURIComponent(item.id)}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ fireAt: fromMs }),
                    headers: { 'Content-Type': 'application/json' },
                  });
                } else if (item.source === 'event') {
                  await apiFetch(`/api/personal-calendar/events/${encodeURIComponent(item.id)}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ eventDate: fromMs }),
                    headers: { 'Content-Type': 'application/json' },
                  });
                } else {
                  await apiFetch(`/api/linkedin/posts/${encodeURIComponent(item.id)}/reschedule`, {
                    method: 'POST',
                    body: JSON.stringify({ scheduled_at: new Date(fromMs).toISOString() }),
                    headers: { 'Content-Type': 'application/json' },
                  });
                }
                // Restore original position visually
                opts?.onOptimistic?.(item, fromMs);
                toast('Undone');
              } catch {
                toast.error('Undo failed');
              }
            })();
          },
        },
      });

      void snappedMs; // consumed above
    } catch (err) {
      // Rollback
      opts?.onRollback?.(item, fromMs);
      toast.error(
        `Couldn't reschedule: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  };

  return { mutate };
}

// -----------------------------------------------------------------------
// useInlineEditMutation
// -----------------------------------------------------------------------

export interface InlineEditArgs {
  item: CalendarItem;
  newTitle: string;
}

export interface InlineEditMutationOpts {
  onOptimistic?: (item: CalendarItem, newTitle: string) => void;
  onRollback?: (item: CalendarItem, originalTitle: string) => void;
}

/**
 * Commits an inline title edit to the server.
 * No undo toast — inline edits are lower-risk and user-initiated.
 */
export function useInlineEditMutation(opts?: InlineEditMutationOpts) {
  const mutate = async ({ item, newTitle }: InlineEditArgs): Promise<void> => {
    const trimmed = newTitle.trim();
    if (!trimmed) return; // client-side empty-title guard

    const originalTitle = item.title;
    opts?.onOptimistic?.(item, trimmed);

    try {
      if (item.source === 'task') {
        await apiFetch(`/api/actionables/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ task: trimmed }),
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (item.source === 'event') {
        await apiFetch(`/api/personal-calendar/events/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: trimmed }),
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        // linkedin — POST /api/linkedin/posts/:id/edit with updated content
        const content_he = item.language === 'he' ? trimmed : null;
        const content = item.language !== 'he' ? trimmed : item.sourceFields.content as string ?? trimmed;
        await apiFetch(`/api/linkedin/posts/${encodeURIComponent(item.id)}/edit`, {
          method: 'POST',
          body: JSON.stringify({ content, content_he }),
          headers: { 'Content-Type': 'application/json' },
        });
      }
      toast('Title updated');
    } catch (err) {
      opts?.onRollback?.(item, originalTitle);
      toast.error(
        `Couldn't update title: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  };

  return { mutate };
}

// -----------------------------------------------------------------------
// useCreateMutation
// -----------------------------------------------------------------------

export interface CreateTaskFields {
  task: string;
  fireAt: number;
  sourceContactName?: string;
}

export interface CreateEventFields {
  title: string;
  eventDate: number;
  duration?: number; // ms; defaults to 3600000 (1h)
  location?: string;
  isAllDay?: boolean;
}

export type CreateArgs =
  | { source: 'task'; fields: CreateTaskFields; onCreated?: () => void }
  | { source: 'event'; fields: CreateEventFields; onCreated?: () => void }
  | { source: 'linkedin' }; // handled by navigate — not a real mutation

/**
 * Creates a new calendar item.
 *
 * LinkedIn source is NOT handled here — call navigateToLinkedIn() from the
 * popover instead. This hook only handles task + event POSTs.
 */
export function useCreateMutation() {
  const mutate = async (args: CreateArgs): Promise<void> => {
    if (args.source === 'linkedin') {
      // LinkedIn create is not supported via direct POST — caller must navigate.
      // This branch should never be reached; the popover handles navigation.
      console.warn('useCreateMutation: LinkedIn create should navigate to /linkedin/queue, not POST');
      return;
    }

    try {
      if (args.source === 'task') {
        const { task, fireAt, sourceContactName } = args.fields;
        await apiFetch('/api/actionables', {
          method: 'POST',
          body: JSON.stringify({ task, fireAt, sourceContactName }),
          headers: { 'Content-Type': 'application/json' },
        });
        toast('Task created');
      } else {
        const { title, eventDate, duration = 3_600_000, location, isAllDay = false } = args.fields;
        await apiFetch('/api/personal-calendar/events', {
          method: 'POST',
          body: JSON.stringify({ title, eventDate, duration, location, isAllDay }),
          headers: { 'Content-Type': 'application/json' },
        });
        toast('Event created');
      }
      args.onCreated?.();
    } catch (err) {
      toast.error(
        `Couldn't create: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  };

  return { mutate };
}

// -----------------------------------------------------------------------
// navigateToLinkedInCreate — called by CreateItemPopover for LinkedIn type
// -----------------------------------------------------------------------

/**
 * Returns a function that navigates to /linkedin/queue?intent=create.
 * Separated from useCreateMutation to make the concession explicit.
 */
export function useNavigateToLinkedInCreate() {
  const navigate = useNavigate();
  return () => navigate('/linkedin/queue?intent=create');
}
