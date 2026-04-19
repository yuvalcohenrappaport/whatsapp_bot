/**
 * /pending-tasks — read-only dashboard view of the actionables lifecycle.
 *
 * Two stacked sections (NOT tabs per CONTEXT reasoning — Phase 37 tabs
 * separated distinct data universes; Pending + Recent here are one
 * entity's lifecycle):
 *   - Pending — every `status='pending_approval'` row as a card, with
 *     per-row RTL mirroring for Hebrew, absolute IST timestamp, full
 *     multi-line source snippet (line-clamp-6), amber arrival flash.
 *   - Recent — 50 most-recent terminal rows (approved/rejected/expired/
 *     fired) with filter chips (All / Approved / Rejected / Expired).
 *
 * No mutation affordances anywhere — approve/reject/edit stay in WhatsApp
 * (v1.8 milestone scope lock from 43-CONTEXT.md). A footer line makes the
 * read-only nature visible.
 *
 * Plan 43-02.
 */
import { useMemo, useState } from 'react';
import { Inbox, User, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useActionablesStream } from '@/hooks/useActionablesStream';
import { useActionableArrivalFlash } from '@/hooks/useActionableArrivalFlash';
import type { Actionable } from '@/api/actionablesSchemas';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

type RecentFilter = 'all' | 'approved' | 'rejected' | 'expired';

/**
 * Absolute IST timestamp — `YYYY-MM-DD HH:mm`. CONTEXT lock: absolute,
 * NOT relative. Uses the en-GB locale as a deterministic source for the
 * `DD/MM/YYYY, HH:MM` shape, then reformats to ISO-date order.
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
// Pending card
// -----------------------------------------------------------------------

function PendingActionableCard({
  actionable,
  flashing,
}: {
  actionable: Actionable;
  flashing: boolean;
}) {
  const isRtl = actionable.detectedLanguage === 'he';
  return (
    <Card
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`px-6 gap-3 transition-colors duration-[300ms] ${
        flashing ? 'bg-amber-100 dark:bg-amber-900/30' : ''
      }`}
    >
      <div className="text-lg font-medium leading-snug">{actionable.task}</div>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <User className="size-3.5" />
        <span>{contactDisplay(actionable)}</span>
      </div>
      <div className="border-l-2 border-muted pl-3 whitespace-pre-wrap line-clamp-6 text-sm text-muted-foreground">
        {actionable.sourceMessageText}
      </div>
      <div className="text-xs text-muted-foreground">
        {formatIstAbsolute(actionable.detectedAt)}
      </div>
    </Card>
  );
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
            Auditing detection quality and approval outcomes — approve or
            reject in WhatsApp.
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
          Pending ({pending?.length ?? 0})
        </h2>
        {pending === null ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : pending.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Inbox className="size-6 mb-2 opacity-60" />
            <p className="text-base">
              No pending actionables — everything is approved or rejected. 🎉
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {pending.map((actionable) => (
              <PendingActionableCard
                key={actionable.id}
                actionable={actionable}
                flashing={flashingIds.has(actionable.id)}
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
        Approve, reject, or edit any pending actionable in WhatsApp.
      </p>
    </div>
  );
}
