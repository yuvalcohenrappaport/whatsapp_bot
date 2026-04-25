/**
 * BudgetBar — per-category budget progress bars with overflow state + edit modal.
 *
 * - Per-category row: icon + label + progress bar (spent / target)
 * - Overflow: if spent > target and target > 0, bar renders in red + "+N" indicator
 * - If target === 0: hide progress bar, show spent amount as accent
 * - Edit budget button (hidden when readOnly) opens a Dialog to PATCH targets
 * - Optimistic: onUpdateBudget is called with only the changed categories
 */
import { useState } from 'react';
import type { BudgetRollup, TripCategory } from '@/api/tripSchemas';
import { cn } from '@/lib/utils';
import {
  TRIP_CATEGORIES,
  categoryIcons,
  categoryColors,
  categoryLabels,
} from './categoryIcons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface BudgetBarProps {
  budget: BudgetRollup;
  onUpdateBudget: (patch: Partial<Record<TripCategory, number>>) => void;
  readOnly: boolean;
}

export function BudgetBar({ budget, onUpdateBudget, readOnly }: BudgetBarProps) {
  const [editOpen, setEditOpen] = useState(false);
  // Local form state: category -> string input value
  const [formValues, setFormValues] = useState<Partial<Record<TripCategory, string>>>({});

  const handleEditOpen = () => {
    // Pre-fill form with current targets
    const initial: Partial<Record<TripCategory, string>> = {};
    for (const cat of TRIP_CATEGORIES) {
      const t = budget.targets[cat] ?? 0;
      initial[cat] = t > 0 ? String(t) : '';
    }
    setFormValues(initial);
    setEditOpen(true);
  };

  const handleSubmit = () => {
    const patch: Partial<Record<TripCategory, number>> = {};
    for (const cat of TRIP_CATEGORIES) {
      const raw = formValues[cat] ?? '';
      const parsed = raw === '' ? 0 : parseFloat(raw);
      if (!isNaN(parsed)) {
        const current = budget.targets[cat] ?? 0;
        if (parsed !== current) {
          patch[cat] = parsed;
        }
      }
    }
    if (Object.keys(patch).length > 0) {
      onUpdateBudget(patch);
    }
    setEditOpen(false);
  };

  // Compute totals for the section header
  const totalSpent = TRIP_CATEGORIES.reduce((s, c) => s + (budget.spent[c] ?? 0), 0);
  const totalTarget = TRIP_CATEGORIES.reduce((s, c) => s + (budget.targets[c] ?? 0), 0);

  return (
    <section id="budget" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Budget</h2>
        <div className="flex items-center gap-3">
          {totalTarget > 0 && (
            <span className="text-sm text-muted-foreground">
              {totalSpent.toLocaleString()} / {totalTarget.toLocaleString()} total
            </span>
          )}
          {!readOnly && (
            <Button variant="outline" size="sm" onClick={handleEditOpen}>
              Edit budget
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {TRIP_CATEGORIES.map((cat) => {
          const Icon = categoryIcons[cat];
          const colorClass = categoryColors[cat];
          const label = categoryLabels[cat];
          const spent = budget.spent[cat] ?? 0;
          const target = budget.targets[cat] ?? 0;

          const pct = target > 0 ? Math.min(100, (spent / target) * 100) : 0;
          const overflow = spent > target && target > 0;
          const noTarget = target === 0;

          // Skip categories with no data at all
          if (spent === 0 && target === 0) return null;

          return (
            <div key={cat} className="flex items-center gap-3">
              {/* Icon */}
              <div className={cn('shrink-0', colorClass)}>
                <Icon size={16} />
              </div>

              {/* Label */}
              <span className="text-sm text-muted-foreground w-20 shrink-0">{label}</span>

              {/* Progress / spent display */}
              {noTarget ? (
                <span className={cn('text-sm font-medium', colorClass)}>
                  {spent.toLocaleString()}
                </span>
              ) : (
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        overflow ? 'bg-destructive' : 'bg-primary',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'text-xs whitespace-nowrap shrink-0',
                      overflow ? 'text-destructive font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {spent.toLocaleString()} / {target.toLocaleString()}
                    {overflow && (
                      <span className="ml-1">
                        (+{(spent - target).toLocaleString()})
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit budget dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit budget targets</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {TRIP_CATEGORIES.map((cat) => {
              const Icon = categoryIcons[cat];
              const colorClass = categoryColors[cat];
              return (
                <div key={cat} className="flex items-center gap-3">
                  <div className={cn('shrink-0', colorClass)}>
                    <Icon size={14} />
                  </div>
                  <Label className="w-24 shrink-0 text-sm">{categoryLabels[cat]}</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={formValues[cat] ?? ''}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [cat]: e.target.value }))
                    }
                    className="flex-1"
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
