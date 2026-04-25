/**
 * TripHeader — sticky header that compacts on scroll.
 *
 * Compact triggers at scrollY > 80: smaller padding, smaller destination font,
 * budget glance row hidden.
 *
 * SSE indicator dot:
 *   open       → emerald-500
 *   reconnecting → amber-500 + "Reconnecting…" label + pulse
 *   error/other → destructive
 */
import { useEffect, useRef, useState } from 'react';
import type { SseStatus } from '@/hooks/useTrip';
import type { BudgetRollup, TripContext } from '@/api/tripSchemas';
import { cn } from '@/lib/utils';

interface TripHeaderProps {
  context: TripContext | null;
  budget: BudgetRollup;
  sseStatus: SseStatus;
  readOnly: boolean;
}

function computeCountdown(startDate: string | null, endDate: string | null): string {
  if (!startDate) return '';
  const nowMs = Date.now();
  const startMs = Date.parse(startDate + 'T00:00:00');
  const endMs = endDate ? Date.parse(endDate + 'T00:00:00') : null;

  const daysToStart = Math.ceil((startMs - nowMs) / 86_400_000);
  if (daysToStart > 0) return `${daysToStart}d to go`;

  if (endMs && nowMs <= endMs) return 'In progress';
  return 'Trip ended';
}

function computeBudgetGlance(budget: BudgetRollup): { spent: number; target: number } {
  let spent = 0;
  let target = 0;
  for (const key of Object.keys(budget.targets)) {
    spent += budget.spent[key] ?? 0;
    target += budget.targets[key] ?? 0;
  }
  return { spent, target };
}

export function TripHeader({ context, budget, sseStatus, readOnly }: TripHeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setCompact(window.scrollY > 80);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const destination = context?.destination ?? 'Unnamed trip';
  const dates =
    context?.startDate && context?.endDate
      ? `${context.startDate} – ${context.endDate}`
      : context?.dates ?? '';
  const countdown = computeCountdown(context?.startDate ?? null, context?.endDate ?? null);
  const { spent, target } = computeBudgetGlance(budget);
  const budgetPct = target > 0 ? Math.min(100, Math.round((spent / target) * 100)) : 0;

  const sseDot = {
    open: 'bg-emerald-500',
    connecting: 'bg-amber-500 animate-pulse',
    reconnecting: 'bg-amber-500 animate-pulse',
    error: 'bg-destructive animate-pulse',
    idle: 'bg-muted-foreground/40',
  }[sseStatus] ?? 'bg-muted-foreground/40';

  return (
    <header
      ref={headerRef}
      className={cn(
        'sticky top-0 z-30 bg-background/95 backdrop-blur border-b transition-all duration-200',
        compact ? 'py-2' : 'py-5',
      )}
    >
      <div className="container mx-auto px-6">
        {/* Main row */}
        <div className="flex items-center justify-between gap-4">
          {/* Left: destination + dates + countdown */}
          <div className="min-w-0 flex-1">
            <h1
              className={cn(
                'font-bold text-foreground truncate transition-all duration-200',
                compact ? 'text-xl' : 'text-3xl',
              )}
            >
              {destination}
            </h1>
            <p className={cn('text-muted-foreground text-sm mt-0.5', compact && 'hidden')}>
              {[dates, countdown].filter(Boolean).join(' · ')}
            </p>
            {compact && (dates || countdown) && (
              <p className="text-muted-foreground text-xs">
                {[dates, countdown].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>

          {/* Right: read-only badge + SSE indicator */}
          <div className="flex items-center gap-3 shrink-0">
            {readOnly && (
              <span className="text-xs text-muted-foreground">Archived · read-only</span>
            )}
            <div className="flex items-center gap-1.5">
              <span
                className={cn('inline-block h-2 w-2 rounded-full', sseDot)}
                title={`SSE: ${sseStatus}`}
              />
              {(sseStatus === 'reconnecting' || sseStatus === 'error') && (
                <span className="text-xs text-amber-500">Reconnecting…</span>
              )}
            </div>
          </div>
        </div>

        {/* Budget glance row — hidden in compact mode */}
        {!compact && target > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  spent > target ? 'bg-destructive' : 'bg-primary',
                )}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {spent.toLocaleString()} / {target.toLocaleString()} spent
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
