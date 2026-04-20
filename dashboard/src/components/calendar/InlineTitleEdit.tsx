/**
 * InlineTitleEdit — reusable inline title editor for calendar pills.
 *
 * Behavior:
 *   - Renders a text input, auto-focused + text-selected on mount
 *   - Enter key → onCommit(currentValue)
 *   - Esc key → onCancel()
 *   - Blur → onCommit(currentValue)
 *   - Empty value guard: if trimmed value is empty, onCancel() instead of commit
 *
 * Plan 44-05.
 */
import { useEffect, useRef, useState } from 'react';

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
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track if we already committed to avoid double-commit on blur after Enter.
  const committed = useRef(false);

  useEffect(() => {
    // Auto-focus + select all text on mount.
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

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
