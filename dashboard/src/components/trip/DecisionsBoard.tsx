/**
 * DecisionsBoard — grouped decisions with origin chip filter, accordion, confirm-delete,
 * and show-deleted toggle.
 *
 * Layout:
 *   1. Origin chip row at top (multi-toggle, [All] clears to full set)
 *   2. Per-category collapsible sections (<details>/<summary>)
 *   3. Each decision row: value + origin badge + cost + conflict warn + delete button
 *   4. "Show deleted (N)" toggle at bottom
 *
 * Chip filter state is LIFTED to TripView (filteredOrigins / onFilteredOriginsChange)
 * so TripMap uses the same filter.
 *
 * Scroll-to-row: rows have id="decision-{id}" — TripView handles the actual scroll.
 */
import { useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import type { TripDecision, DecisionOrigin } from '@/api/tripSchemas';
import { cn } from '@/lib/utils';
import { TRIP_CATEGORIES, categoryIcons, categoryLabels } from './categoryIcons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// ─── Origin chip config ───────────────────────────────────────────────────────

const ALL_ORIGINS: DecisionOrigin[] = ['multimodal', 'inferred', 'self_reported', 'dashboard'];

const ORIGIN_LABELS: Record<DecisionOrigin, string> = {
  multimodal: 'Multimodal',
  inferred: 'Inferred',
  self_reported: 'Self-reported',
  dashboard: 'Dashboard',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface DecisionsBoardProps {
  /** Full decision list including deleted rows */
  decisions: TripDecision[];
  filteredOrigins: Set<DecisionOrigin>;
  onFilteredOriginsChange: (next: Set<DecisionOrigin>) => void;
  onDeleteDecision: (id: string) => void;
  readOnly: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseConflicts(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DecisionsBoard({
  decisions,
  filteredOrigins,
  onFilteredOriginsChange,
  onDeleteDecision,
  readOnly,
}: DecisionsBoardProps) {
  const [showDeleted, setShowDeleted] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // ─── Origin chip handlers ───────────────────────────────────────────────

  const handleChipToggle = (origin: DecisionOrigin) => {
    const next = new Set(filteredOrigins);
    if (next.has(origin)) {
      next.delete(origin);
      // If removing would empty the set, restore all
      if (next.size === 0) {
        onFilteredOriginsChange(new Set(ALL_ORIGINS));
        return;
      }
    } else {
      next.add(origin);
    }
    onFilteredOriginsChange(next);
  };

  const handleAllChip = () => {
    onFilteredOriginsChange(new Set(ALL_ORIGINS));
  };

  // ─── Counts per origin (active decisions only, regardless of filter) ─────

  const originCounts: Record<DecisionOrigin, number> = {
    multimodal: 0,
    inferred: 0,
    self_reported: 0,
    dashboard: 0,
  };
  for (const d of decisions) {
    if (d.status !== 'deleted') {
      originCounts[d.origin] = (originCounts[d.origin] ?? 0) + 1;
    }
  }

  const deletedCount = decisions.filter((d) => d.status === 'deleted').length;

  // ─── Visible decisions after filter ──────────────────────────────────────

  const visible = decisions.filter((d) => {
    if (!filteredOrigins.has(d.origin)) return false;
    if (d.status === 'deleted' && !showDeleted) return false;
    return true;
  });

  // ─── Group by category ────────────────────────────────────────────────────

  // Find category with most rows for default-open behavior
  const countByCategory: Partial<Record<string, number>> = {};
  for (const d of visible) {
    const cat = d.category ?? 'other';
    countByCategory[cat] = (countByCategory[cat] ?? 0) + 1;
  }
  const defaultOpenCategory = Object.entries(countByCategory).sort((a, b) => b[1]! - a[1]!)[0]?.[0];

  const isAllActive = ALL_ORIGINS.every((o) => filteredOrigins.has(o));

  return (
    <section id="decisions-board" className="space-y-4">
      <h2 className="text-lg font-semibold">Decisions</h2>

      {/* Origin filter chip row */}
      <div className="flex flex-wrap gap-2">
        {/* All chip */}
        <button
          onClick={handleAllChip}
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
            isAllActive
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:border-primary',
          )}
        >
          All
        </button>

        {ALL_ORIGINS.map((origin) => {
          const active = filteredOrigins.has(origin);
          const count = originCounts[origin];
          return (
            <button
              key={origin}
              onClick={() => handleChipToggle(origin)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                active
                  ? 'ring-2 ring-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500'
                  : 'bg-background text-muted-foreground border-border hover:border-emerald-500',
              )}
            >
              {ORIGIN_LABELS[origin]} ({count})
            </button>
          );
        })}
      </div>

      {/* Category accordion sections */}
      <div className="space-y-3">
        {TRIP_CATEGORIES.map((cat) => {
          const catDecisions = visible.filter((d) => (d.category ?? 'other') === cat);
          if (catDecisions.length === 0) return null;

          const Icon = categoryIcons[cat];
          const label = categoryLabels[cat];
          const isDefaultOpen = cat === defaultOpenCategory || !defaultOpenCategory;

          return (
            <details key={cat} open={isDefaultOpen} className="group rounded-lg border bg-card overflow-hidden">
              <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors list-none select-none">
                <Icon size={16} className="shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium flex-1">{label}</span>
                <Badge variant="secondary" className="text-xs">
                  {catDecisions.length}
                </Badge>
                <svg
                  className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>

              <div className="divide-y divide-border">
                {catDecisions.map((d) => {
                  const conflicts = parseConflicts(d.conflictsWith);
                  const isDeleted = d.status === 'deleted';

                  return (
                    <div
                      key={d.id}
                      id={`decision-${d.id}`}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 transition-colors',
                        isDeleted && 'line-through text-muted-foreground opacity-60',
                      )}
                    >
                      {/* Main content */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className={cn('text-sm leading-snug', isDeleted && 'line-through')}>
                          {d.value}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* Origin badge */}
                          <Badge variant="outline" className="text-xs px-1.5 py-0">
                            {ORIGIN_LABELS[d.origin]}
                          </Badge>

                          {/* Cost */}
                          {d.costAmount != null && (
                            <span className="text-xs text-muted-foreground">
                              {d.costAmount.toLocaleString()} {d.costCurrency ?? ''}
                            </span>
                          )}

                          {/* Conflict warning */}
                          {conflicts.length > 0 && (
                            <span
                              className="flex items-center gap-0.5 text-xs text-amber-500"
                              title={`Conflicts with: ${conflicts.join(', ')}`}
                            >
                              <AlertTriangle size={12} />
                              {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}
                            </span>
                          )}

                          {/* Deleted badge */}
                          {isDeleted && (
                            <Badge variant="secondary" className="text-xs opacity-70">
                              deleted
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Delete button */}
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isDeleted}
                          onClick={() => setConfirmId(d.id)}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          title="Delete decision"
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}

        {visible.filter((d) => d.status === 'active').length === 0 &&
          visible.filter((d) => d.status === 'deleted').length === 0 && (
          <p className="text-sm text-muted-foreground">No decisions match the current filter.</p>
        )}
      </div>

      {/* Show deleted toggle at bottom */}
      {deletedCount > 0 && (
        <div className="pt-1">
          <button
            onClick={() => setShowDeleted((v) => !v)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
          >
            {showDeleted
              ? `Hide deleted (${deletedCount})`
              : `Show deleted (${deletedCount})`}
          </button>
        </div>
      )}

      {/* Confirm delete modal */}
      <Dialog open={confirmId !== null} onOpenChange={(open) => { if (!open) setConfirmId(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this decision?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This decision will be hidden from the board and the map. You can view it later via
            "Show deleted".
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmId) {
                  onDeleteDecision(confirmId);
                  setConfirmId(null);
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
