/**
 * /pending-tasks — dashboard view of the actionables lifecycle.
 *
 * Two stacked sections (NOT tabs per CONTEXT reasoning — Phase 37 tabs
 * separated distinct data universes; Pending + Recent here are one
 * entity's lifecycle):
 *   - Pending — every `status='pending_approval'` row as a card with
 *     per-row Approve / Edit / Reject controls (Phase 45-03), per-row
 *     RTL mirroring for Hebrew, absolute IST timestamp, full multi-line
 *     source snippet (line-clamp-6), amber arrival flash.
 *   - Recent — 50 most-recent terminal rows (approved/rejected/expired/
 *     fired) with filter chips (All / Approved / Rejected / Expired).
 *
 * Plan 43-02 originally shipped /pending-tasks as read-only. Plan 45-03
 * adds write actions funneled through the Plan 45-02 HTTP routes. UX
 * discipline per CONTEXT:
 *
 *   - Approve + Edit: optimistic remove + silent success (SSE re-
 *     materializes the row into Recent within 3s via the hash-poll
 *     from Plan 43-02 — that IS the feedback; no success toast).
 *   - Reject: optimistic remove + sonner Undo toast (5s, mirrors
 *     useCalendarMutations reschedule-undo shape).
 *   - 409 already_handled: neutral toast, row stays gone (end state
 *     correct; do NOT rollback).
 *   - Any other error (network / 500 / 503 bot_disconnected):
 *     rollback the optimistic remove + error toast.
 *
 * Plan: 43-02 (read surface) → 45-03 (write actions).
 */
import { useMemo, useState } from 'react';
import { Inbox, User, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useActionablesStream } from '@/hooks/useActionablesStream';
import { useActionableArrivalFlash } from '@/hooks/useActionableArrivalFlash';
import {
  useActionableActions,
  actionableErrorToToastText,
} from '@/hooks/useActionableActions';
import { PendingActionableCard } from '@/components/actionables/PendingActionableCard';
import type { Actionable } from '@/api/actionablesSchemas';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

type RecentFilter = 'all' | 'approved' | 'rejected' | 'expired';

/**
 * Absolute IST timestamp — `YYYY-MM-DD HH:mm`. CONTEXT lock: absolute,
 * NOT relative. Uses the en-GB locale as a deterministic source for the
 * `DD/MM/YYYY, HH:MM` shape, then reformats to ISO-date order.
 *
 * (Still lives here because AuditActionableCard also uses it. The
 * PendingActionableCard extracted in Plan 45-03 has its own byte-identical
 * copy for independence.)
 */
function formatIstAbsolute(ts: number): string {
  const formatted = new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // `20/04/2026, 14:32` → `2026-04-20 14:32`
  const match = formatted.match(
    /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})$/,
  );
  if (!match) return formatted;
  const [, dd, mm, yyyy, hh, min] = match;
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Status → display metadata for audit-row badges. `fired` is an approved
 * actionable that ran — CONTEXT lock says surface as Approved in the
 * audit view.
 */
function auditStatusBadge(status: Actionable['status']): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'approved':
    case 'fired':
      return {
        label: 'Approved',
        className:
          'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        className: 'bg-red-500/10 text-red-400 border-red-500/20',
      };
    case 'expired':
      return {
        label: 'Expired',
        className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
      };
    case 'pending_approval':
      // Should never hit the audit view, but be defensive.
      return {
        label: 'Pending',
        className:
          'bg-amber-500/10 text-amber-400 border-amber-500/20',
      };
  }
}

function contactDisplay(actionable: Actionable): string {
  return actionable.sourceContactName ?? actionable.sourceContactJid;
}

// -----------------------------------------------------------------------
// Audit card
// -----------------------------------------------------------------------

function AuditActionableCard({ actionable }: { actionable: Actionable }) {
  const badge = auditStatusBadge(actionable.status);
  const headline = actionable.enrichedTitle ?? actionable.task;
  const showOriginally =
    actionable.enrichedTitle !== null &&
    actionable.enrichedTitle !== actionable.originalDetectedTask;
  return (
    <Card className="px-6 gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="text-base font-medium leading-snug">{headline}</div>
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>
      {showOriginally && (
        <div className="text-xs text-muted-foreground italic">
          Originally: {actionable.originalDetectedTask}
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <User className="size-3" />
        <span>{contactDisplay(actionable)}</span>
      </div>
      {actionable.enrichedNote && (
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground/80">Note:</span>{' '}
          <span className="line-clamp-3 whitespace-pre-wrap inline">
            {actionable.enrichedNote}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-xs text-muted-foreground">
          {formatIstAbsolute(actionable.updatedAt)}
        </span>
        {actionable.todoTaskId && (
          <a
            href="https://tasks.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
          >
            Open in Google Tasks
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------

export default function PendingTasksPage() {
  const { pending, recent, status } = useActionablesStream();
  const flashingIds = useActionableArrivalFlash(pending);
  const [recentFilter, setRecentFilter] = useState<RecentFilter>('all');

  // Write-actions wiring (Plan 45-03)
  const {
    approveActionable,
    rejectActionable,
    editActionable,
    unrejectActionable,
  } = useActionableActions();

  /**
   * Ids the user has initiated a mutation on — we optimistically drop
   * them from the rendered list until SSE re-materializes the terminal
   * state into `recent`. On error we un-suppress (rollback).
   *
   * A 409 `already_handled` response does NOT trigger rollback: the
   * end state is correct (the row was handled in WhatsApp), we just
   * surface a neutral toast.
   */
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(new Set());
  /** Ids with a mutation in flight — card buttons render disabled. */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const suppress = (id: string) =>
    setSuppressedIds((prev) => {
      if (prev.has(id)) return prev;
      const n = new Set(prev);
      n.add(id);
      return n;
    });
  const unsuppress = (id: string) =>
    setSuppressedIds((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  const setBusy = (id: string, b: boolean) =>
    setBusyIds((prev) => {
      const has = prev.has(id);
      if (b === has) return prev;
      const n = new Set(prev);
      if (b) n.add(id);
      else n.delete(id);
      return n;
    });

  // `fired` rolls up under `approved` in the audit filter per CONTEXT.
  const filteredRecent = useMemo(() => {
    if (!recent) return null;
    if (recentFilter === 'all') return recent;
    if (recentFilter === 'approved') {
      return recent.filter(
        (a) => a.status === 'approved' || a.status === 'fired',
      );
    }
    return recent.filter((a) => a.status === recentFilter);
  }, [recent, recentFilter]);

  /**
   * Optimistic pending list — strips anything the user clicked
   * Approve/Edit/Reject on. SSE will authoritatively remove it (or put
   * it back in the rare rollback case).
   */
  const optimisticPending = useMemo(() => {
    if (!pending) return null;
    if (suppressedIds.size === 0) return pending;
    return pending.filter((a) => !suppressedIds.has(a.id));
  }, [pending, suppressedIds]);

  async function handleApprove(a: Actionable) {
    suppress(a.id);
    setBusy(a.id, true);
    const result = await approveActionable(a.id);
    setBusy(a.id, false);
    if (result.ok) return; // silent success — SSE re-materializes in Recent
    if (result.reason === 'already_handled') {
      toast(actionableErrorToToastText(result));
      return; // row stays gone — end state correct
    }
    unsuppress(a.id); // rollback
    toast.error(actionableErrorToToastText(result));
  }

  async function handleReject(a: Actionable) {
    suppress(a.id);
    setBusy(a.id, true);
    const result = await rejectActionable(a.id);
    setBusy(a.id, false);

    if (!result.ok) {
      if (result.reason === 'already_handled') {
        toast(actionableErrorToToastText(result));
        return;
      }
      unsuppress(a.id);
      toast.error(actionableErrorToToastText(result));
      return;
    }

    // Success — only write action with a toast, because of Undo.
    // Shape mirrors useCalendarMutations reschedule-undo (lines 107-143).
    const truncTask = a.task.slice(0, 40);
    const label = `Rejected: ${truncTask}${a.task.length > 40 ? '…' : ''}`;
    toast(label, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            const undo = await unrejectActionable(a.id);
            if (undo.ok) {
              unsuppress(a.id);
              return;
            }
            if (undo.reason === 'grace_expired') {
              // Server says too late — don't restore the row visually,
              // just inform the user with a neutral toast.
              toast(actionableErrorToToastText(undo));
              return;
            }
            toast.error(actionableErrorToToastText(undo));
          })();
        },
      },
    });
  }

  async function handleEditSave(a: Actionable, newTask: string) {
    suppress(a.id);
    setBusy(a.id, true);
    const result = await editActionable(a.id, newTask);
    setBusy(a.id, false);
    if (result.ok) return; // silent — SSE re-materializes with edited title
    if (result.reason === 'already_handled') {
      toast(actionableErrorToToastText(result));
      return;
    }
    unsuppress(a.id);
    toast.error(actionableErrorToToastText(result));
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1
            className="text-2xl font-semibold mb-1"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Pending Tasks
          </h1>
          <p className="text-sm text-muted-foreground">
            Approve, reject, or edit here or in WhatsApp — both surfaces stay in sync.
          </p>
        </div>
        {status === 'reconnecting' && (
          <span className="text-xs text-amber-600 dark:text-amber-400 animate-pulse">
            Reconnecting…
          </span>
        )}
      </div>

      {/* --- Pending section --- */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3">
          Pending ({optimisticPending?.length ?? 0})
        </h2>
        {optimisticPending === null ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : optimisticPending.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Inbox className="size-6 mb-2 opacity-60" />
            <p className="text-base">
              No pending actionables — everything is approved or rejected. 🎉
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {optimisticPending.map((actionable) => (
              <PendingActionableCard
                key={actionable.id}
                actionable={actionable}
                flashing={flashingIds.has(actionable.id)}
                busy={busyIds.has(actionable.id)}
                onApprove={() => void handleApprove(actionable)}
                onReject={() => void handleReject(actionable)}
                onEditSave={(newTask) => void handleEditSave(actionable, newTask)}
              />
            ))}
          </div>
        )}
      </section>

      {/* --- Recent section --- */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold">
            Recent ({filteredRecent?.length ?? 0})
          </h2>
        </div>
        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {(['all', 'approved', 'rejected', 'expired'] as const).map(
            (chip) => {
              const active = recentFilter === chip;
              const label =
                chip === 'all'
                  ? 'All'
                  : chip.charAt(0).toUpperCase() + chip.slice(1);
              return (
                <Button
                  key={chip}
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  onClick={() => setRecentFilter(chip)}
                >
                  {label}
                </Button>
              );
            },
          )}
        </div>
        {filteredRecent === null ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : filteredRecent.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <p className="text-sm">
              No {recentFilter === 'all' ? '' : `${recentFilter} `}actionables
              in the last 50.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredRecent.map((actionable) => (
              <AuditActionableCard
                key={actionable.id}
                actionable={actionable}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground text-center mt-8">
        Approve, reject, or edit here or in WhatsApp — both surfaces stay in sync.
      </p>
    </div>
  );
}
