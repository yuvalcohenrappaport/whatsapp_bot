/**
 * Shared bottom-sticky confirm bar for the focus-then-confirm pattern
 * used on both the lesson selection page and the variant finalization
 * page. Phase 37-01.
 *
 * CONTEXT §Area 1 + §Area 2 lock the same primitive across both pages —
 * same position, same layout, same disabled-state semantics. Plans 37-02
 * and 37-03 each render a single instance below their card grid.
 */
import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface StickyConfirmBarProps {
  label: string;
  disabled: boolean;
  onConfirm: () => void;
  helper?: ReactNode;
  className?: string;
}

export function StickyConfirmBar({
  label,
  disabled,
  onConfirm,
  helper,
  className,
}: StickyConfirmBarProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 left-0 right-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-3',
        'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t',
        // iOS safe-area padding
        'pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-sm text-muted-foreground">
          {helper}
        </div>
        <Button
          onClick={onConfirm}
          disabled={disabled}
          size="lg"
          className="shrink-0"
        >
          {label}
        </Button>
      </div>
    </div>
  );
}
