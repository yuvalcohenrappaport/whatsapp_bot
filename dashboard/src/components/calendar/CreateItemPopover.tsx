/**
 * CreateItemPopover — quick-create popover for new calendar items.
 *
 * Opens when the user clicks an empty time slot in any view.
 *
 * Contents:
 *   1. Type chips: Task | Event | LinkedIn post (default: Task)
 *   2. Title input, auto-focused, Enter-to-save
 *   3. Start time (HH:mm IST) — pre-filled from anchor.hourMs or anchor.dateMs
 *   4. Duration (Event only, default 1h)
 *   5. Contact picker (Task only) — Select from useContacts()
 *   6. Location field (Event only)
 *   7. "More options…" link → Event only (expands inline for now)
 *      Task "More options" is omitted — title+time+contact is the full Task
 *      shape; no sub-dialog exists yet (see Plan 44-05 scope note)
 *      LinkedIn creates navigate to /linkedin/queue (pm-authority flow required)
 *
 * LinkedIn create concession:
 *   pm-authority has no public "create approved post at scheduled_at" endpoint.
 *   Selecting "LinkedIn post" and clicking Save closes the popover and
 *   navigates to /linkedin/queue?intent=create. This is a v1 UX concession,
 *   not a hack — documented in useCalendarMutations.ts.
 *
 * Plan 44-05.
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useCreateMutation } from '@/hooks/useCalendarMutations';
import { useContacts } from '@/hooks/useContacts';
import { formatIstTime } from '@/lib/ist';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

type ItemType = 'task' | 'event' | 'linkedin';

export interface CreateItemAnchor {
  /** The day (start of IST day) for the new item. */
  dateMs: number;
  /** If clicking a timed slot, the hour+minute expressed as ms since epoch. */
  hourMs?: number;
  /** DOM element to anchor the popover to. */
  anchorEl?: HTMLElement | null;
}

interface CreateItemPopoverProps {
  anchor: CreateItemAnchor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Format ms timestamp as "HH:mm" for controlled input. */
function msToTimeInput(ms: number): string {
  const d = new Date(ms);
  return new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Parse "HH:mm" input back to minutes from midnight. */
function timeInputToMinutes(val: string): number {
  const [h, m] = val.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

/** Build a target ms from a day ms + HH:mm minutes in local time. */
function buildTargetMs(dateMs: number, timeMinutes: number): number {
  const d = new Date(dateMs);
  // Use the date part (year/month/day) + the time minutes
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  result.setMinutes(timeMinutes);
  return result.getTime();
}

// -----------------------------------------------------------------------
// Type chip
// -----------------------------------------------------------------------

const TYPE_COLORS: Record<ItemType, string> = {
  task: 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  event: 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
  linkedin: 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-400',
};

const TYPE_LABELS: Record<ItemType, string> = {
  task: 'Task',
  event: 'Event',
  linkedin: 'LinkedIn post',
};

function TypeChip({
  type,
  selected,
  onClick,
}: {
  type: ItemType;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'text-xs px-2 py-0.5 rounded-full border font-medium transition-colors',
        selected
          ? TYPE_COLORS[type]
          : 'border-border text-muted-foreground hover:border-border/80',
      ].join(' ')}
    >
      {TYPE_LABELS[type]}
    </button>
  );
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function CreateItemPopover({
  anchor,
  open,
  onOpenChange,
  onCreated,
}: CreateItemPopoverProps) {
  const navigate = useNavigate();
  const { mutate: createMutate } = useCreateMutation();
  const { data: contacts } = useContacts();

  const [type, setType] = useState<ItemType>('task');
  const [title, setTitle] = useState('');
  const [timeInput, setTimeInput] = useState('09:00');
  const [duration, setDuration] = useState('01:00'); // HH:mm for event duration
  const [contactJid, setContactJid] = useState<string>('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  // Reset state when anchor changes (new slot clicked).
  useEffect(() => {
    if (anchor && open) {
      const slotMs = anchor.hourMs ?? anchor.dateMs;
      setType('task');
      setTitle('');
      setTimeInput(msToTimeInput(slotMs));
      setDuration('01:00');
      setContactJid('');
      setLocation('');
      setError(null);
      setSaving(false);
      // Auto-focus title after a tick (popover animation).
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [anchor, open]);

  async function handleSave() {
    if (!anchor) return;

    if (type === 'linkedin') {
      // LinkedIn create-navigate concession — see file header.
      onOpenChange(false);
      navigate('/linkedin/queue?intent=create');
      return;
    }

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setError(null);
    setSaving(true);

    const timeMinutes = timeInputToMinutes(timeInput);
    const targetMs = buildTargetMs(anchor.dateMs, timeMinutes);

    try {
      if (type === 'task') {
        await createMutate({
          source: 'task',
          fields: {
            task: title.trim(),
            fireAt: targetMs,
            sourceContactName: contactJid || undefined,
          },
          onCreated: () => {
            onOpenChange(false);
            onCreated?.();
          },
        });
      } else {
        // event
        const [dh, dm] = duration.split(':').map(Number);
        const durationMs = ((dh || 0) * 60 + (dm || 0)) * 60_000 || 3_600_000;
        await createMutate({
          source: 'event',
          fields: {
            title: title.trim(),
            eventDate: targetMs,
            duration: durationMs,
            location: location.trim() || undefined,
          },
          onCreated: () => {
            onOpenChange(false);
            onCreated?.();
          },
        });
      }
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSave();
    } else if (e.key === 'Escape') {
      onOpenChange(false);
    }
  }

  if (!anchor) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {/* Anchor element for positioning — invisible 0-size div injected at slot position */}
      <PopoverAnchor
        className="fixed pointer-events-none"
        style={{
          left: anchor.anchorEl?.getBoundingClientRect().left ?? '50%',
          top: anchor.anchorEl?.getBoundingClientRect().bottom ?? '50%',
        }}
      />
      <PopoverContent
        className="w-80 p-3"
        align="start"
        side="bottom"
        onKeyDown={handleKeyDown}
      >
        {/* Type chips */}
        <div className="flex gap-1.5 mb-3">
          {(['task', 'event', 'linkedin'] as ItemType[]).map((t) => (
            <TypeChip
              key={t}
              type={t}
              selected={type === t}
              onClick={() => setType(t)}
            />
          ))}
        </div>

        {/* LinkedIn notice */}
        {type === 'linkedin' && (
          <p className="text-xs text-muted-foreground mb-3">
            LinkedIn posts require a lesson-run flow.
            Saving will open the LinkedIn queue.
          </p>
        )}

        {/* Title */}
        {type !== 'linkedin' && (
          <input
            ref={titleRef}
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-input bg-background rounded-md px-2 py-1.5 text-sm mb-2 outline-none focus:ring-1 focus:ring-ring"
          />
        )}

        {/* Start time */}
        {type !== 'linkedin' && (
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-20 shrink-0">Start time</label>
            <input
              type="time"
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              className="border border-input bg-background rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring flex-1"
            />
          </div>
        )}

        {/* Duration — Event only */}
        {type === 'event' && (
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-20 shrink-0">Duration</label>
            <input
              type="time"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="border border-input bg-background rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring flex-1"
            />
          </div>
        )}

        {/* Location — Event only */}
        {type === 'event' && (
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-20 shrink-0">Location</label>
            <input
              type="text"
              placeholder="Optional"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="border border-input bg-background rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring flex-1"
            />
          </div>
        )}

        {/* Contact picker — Task only */}
        {type === 'task' && contacts && contacts.length > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-20 shrink-0">Contact</label>
            <Select value={contactJid} onValueChange={setContactJid}>
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {contacts.map((c) => (
                  <SelectItem key={c.jid} value={c.jid}>
                    {c.name ?? c.jid}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs text-destructive mb-2">{error}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {type === 'linkedin' ? 'Open queue' : saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
