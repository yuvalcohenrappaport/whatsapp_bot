/**
 * InlineTitleEdit — reusable inline title editor for calendar pills.
 *
 * Desktop behavior:
 *   - Renders a text input inline (absolutely positioned over the pill)
 *   - Enter key → onCommit(currentValue)
 *   - Esc key → onCancel()
 *   - Blur → onCommit(currentValue)
 *   - Empty value guard: if trimmed value is empty, onCancel() instead of commit
 *
 * Phone behavior (Plan 50-03):
 *   - Promotes to a Radix Dialog (bottom-sheet) to avoid overlap with viewport edge
 *   - Same input + Save/Cancel handlers; same save mutation called
 *   - isMobile heuristic is sufficient — any overlap risk on phone is worth avoiding
 *
 * Plan 44-05 (base), extended in Plan 50-03 (mobile dialog branch).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useViewport } from '@/hooks/useViewport';

interface InlineTitleEditProps {
  value: string;
  onCommit: (newValue: string) => void;
  onCancel: () => void;
  dir?: 'ltr' | 'rtl';
  className?: string;
}

export function InlineTitleEdit({
  value,
  onCommit,
  onCancel,
  dir = 'ltr',
  className = '',
}: InlineTitleEditProps) {
  const { isMobile } = useViewport();
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track if we already committed to avoid double-commit on blur after Enter.
  const committed = useRef(false);

  useEffect(() => {
    // Auto-focus + select all text on mount.
    if (!isMobile && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isMobile]);

  function commit() {
    if (committed.current) return;
    committed.current = true;
    const trimmed = draft.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onCommit(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      committed.current = true; // prevent blur from committing
      onCancel();
    }
  }

  // -----------------------------------------------------------------------
  // Phone: bottom-sheet dialog with single input + Save/Cancel
  // -----------------------------------------------------------------------
  if (isMobile) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
        <DialogContent
          className={[
            'fixed bottom-0 left-0 right-0 top-auto',
            'translate-x-0 translate-y-0',
            'max-w-none rounded-b-none rounded-t-2xl',
            'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
          ].join(' ')}
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
        >
          <DialogHeader>
            <DialogTitle>Edit title</DialogTitle>
          </DialogHeader>
          <input
            autoFocus
            type="text"
            dir={dir}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            placeholder="Title"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button onClick={commit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // -----------------------------------------------------------------------
  // Desktop: inline input positioned absolutely over the pill
  // -----------------------------------------------------------------------
  return (
    <input
      ref={inputRef}
      type="text"
      dir={dir}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      className={[
        'w-full bg-transparent border-none outline-none ring-1 ring-inset ring-primary/40 rounded px-0.5 text-xs',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
