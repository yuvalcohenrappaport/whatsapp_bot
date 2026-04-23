/**
 * PendingActionableCard — one pending row on /pending-tasks.
 *
 * Extracted from the inline definition in `pages/PendingTasks.tsx`
 * (Plan 43-02 lines 103-131) and extended per CONTEXT §Button UX + §Inline
 * Edit + §Click-through:
 *
 *   - Always-visible button row at card bottom: ✅ Approve / ✏️ Edit / ❌ Reject
 *     (CONTEXT lock — not hover-only, not kebab menu, icon + text).
 *   - Inline Edit morph: click Edit → headline becomes a textarea
 *     pre-filled with the current task, language-matched dir (he → rtl,
 *     en → ltr); source snippet + contact + timestamp stay visible above
 *     for context. Two buttons: Cancel + Save & Approve.
 *   - Keyboard shortcuts inside the textarea: Esc cancels, Cmd/Ctrl+Enter
 *     triggers Save & Approve (same outcome as clicking the button).
 *   - `busy` prop disables all buttons while a mutation is in flight for
 *     this row — page owns the mutation state so the card just reflects.
 *
 * Visual locks preserved from Plan 43-02:
 *   - per-row RTL mirroring via `dir` attribute on the Card
 *   - absolute IST timestamp (formatIstAbsolute helper — byte-identical copy)
 *   - full multi-line source snippet with line-clamp-6
 *   - amber arrival flash via the `flashing` prop + 300ms transition
 *
 * Button row discipline: the button row itself uses `dir="ltr"` so the
 * ✅/✏️/❌ order stays left-to-right even on Hebrew RTL cards — matches
 * the LinkedIn queue action row convention.
 *
 * Plan: 45-03.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEventHandler } from 'react';
import { Check, X, Pencil, User } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Actionable } from '@/api/actionablesSchemas';

// -----------------------------------------------------------------------
// Helpers — copied byte-for-byte from pages/PendingTasks.tsx so the
// extraction introduces zero visual drift.
// -----------------------------------------------------------------------

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
  const match = formatted.match(
    /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})$/,
  );
  if (!match) return formatted;
  const [, dd, mm, yyyy, hh, min] = match;
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function contactDisplay(actionable: Actionable): string {
  return actionable.sourceContactName ?? actionable.sourceContactJid;
}

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

export interface PendingActionableCardProps {
  actionable: Actionable;
  /** True for the ~1s amber-flash animation when this row just arrived via SSE. */
  flashing: boolean;
  /** True while a mutation is in flight for this row — disables all buttons. */
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  /** Fired when the user saves an inline edit. `newTask` is trimmed + non-empty. */
  onEditSave: (newTask: string) => void;
}

/** Client-side cap matches server-side EDIT_TASK_MAX_LEN (Plan 45-02). */
const EDIT_TASK_MAX_LEN = 500;

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function PendingActionableCard(props: PendingActionableCardProps) {
  const { actionable, flashing, busy, onApprove, onReject, onEditSave } = props;
  const isRtl = actionable.detectedLanguage === 'he';

  const [editing, setEditing] = useState(false);
  // `draft` is only meaningful while `editing` is true. We seed it at the
  // moment the user clicks Edit (not lazily on first render) so a later
  // SSE refresh to `actionable.task` while the editor is open doesn't
  // silently clobber what the user is typing.
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus the textarea + place cursor at end the first render after
  // `editing` flips to true. useLayoutEffect runs after the textarea is
  // in the DOM but before the browser paints, avoiding the flicker a
  // setTimeout would introduce. We explicitly DO NOT setState in here —
  // seeding happens synchronously in enterEditMode() below per
  // react-hooks/set-state-in-effect.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [editing]);

  const enterEditMode = () => {
    // Seed BEFORE flipping editing — single render, no setState-in-effect.
    setDraft(actionable.task);
    setEditing(true);
  };

  const save = () => {
    const trimmed = draft.trim();
    if (!trimmed) return; // empty guard — Save button is already disabled
    setEditing(false);
    onEditSave(trimmed);
  };

  const cancel = () => {
    setEditing(false);
  };

  const onKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  };

  const trimmedLen = draft.trim().length;
  const saveDisabled = busy || trimmedLen === 0 || trimmedLen > EDIT_TASK_MAX_LEN;

  return (
    <Card
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`px-6 py-4 gap-3 transition-colors duration-[300ms] ${
        flashing ? 'bg-amber-100 dark:bg-amber-900/30' : ''
      }`}
    >
      {/* Headline or inline textarea */}
      {editing ? (
        <Textarea
          ref={textareaRef}
          dir={isRtl ? 'rtl' : 'ltr'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          maxLength={EDIT_TASK_MAX_LEN}
          disabled={busy}
          className="text-lg font-medium leading-snug"
          aria-label="Edit task"
        />
      ) : (
        <div className="text-lg font-medium leading-snug">{actionable.task}</div>
      )}

      {/* Contact — unchanged from the pre-extraction version */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <User className="size-3.5" />
        <span>{contactDisplay(actionable)}</span>
      </div>

      {/* Source snippet — full multi-line with line-clamp-6 */}
      <div className="border-l-2 border-muted pl-3 whitespace-pre-wrap line-clamp-6 text-sm text-muted-foreground">
        {actionable.sourceMessageText}
      </div>

      {/* Absolute IST timestamp */}
      <div className="text-xs text-muted-foreground">
        {formatIstAbsolute(actionable.detectedAt)}
      </div>

      {/*
       * Action row — always at card bottom, always visible. `dir="ltr"`
       * locks the button order to ✅/✏️/❌ regardless of the card's RTL
       * direction (CONTEXT §Button UX placement).
       */}
      {/*
       * On phone (< sm) we switch to a 3-column grid so each button gets
       * equal width and the row never wraps at 320px. On sm+ we revert to
       * the original flex row (unchanged desktop appearance).
       */}
      <div className="grid grid-cols-3 sm:flex sm:items-center gap-2 pt-2" dir="ltr">
        {editing ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={cancel}
              disabled={busy}
              className="min-w-0"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={saveDisabled}
              aria-label="Save and approve"
              className="col-span-2 sm:col-span-1 min-w-0"
            >
              <Check className="size-4 shrink-0" />
              <span className="truncate">Save &amp; Approve</span>
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              onClick={onApprove}
              disabled={busy}
              aria-label="Approve"
              className="min-w-0"
            >
              <Check className="size-4 shrink-0" />
              <span className="truncate">Approve</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={enterEditMode}
              disabled={busy}
              aria-label="Edit"
              className="min-w-0"
            >
              <Pencil className="size-4 shrink-0" />
              <span className="truncate">Edit</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onReject}
              disabled={busy}
              aria-label="Reject"
              className="min-w-0"
            >
              <X className="size-4 shrink-0" />
              <span className="truncate">Reject</span>
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
