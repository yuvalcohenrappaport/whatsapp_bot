import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import cronstrue from 'cronstrue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  useCreateScheduledMessage,
  useEditScheduledMessage,
  type ScheduledMessage,
} from '@/hooks/useScheduledMessages';
import type { Contact } from '@/hooks/useContacts';

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildCronExpression(
  cadence: 'daily' | 'weekly' | 'monthly',
  scheduledAtMs: number,
): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: 'numeric',
    minute: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(scheduledAtMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const minute = Number(get('minute'));
  const hour = Number(get('hour'));
  const day = Number(get('day'));
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[get('weekday')] ?? 0;

  if (cadence === 'daily') return `${minute} ${hour} * * *`;
  if (cadence === 'weekly') return `${minute} ${hour} * * ${weekday}`;
  return `${minute} ${hour} ${day} * *`;
}

function getCadenceFromCron(
  cronExpression: string | null,
): 'daily' | 'weekly' | 'monthly' | null {
  if (!cronExpression) return null;
  const parts = cronExpression.trim().split(/\s+/);
  if (parts[2] !== '*') return 'monthly';
  if (parts[4] !== '*') return 'weekly';
  return 'daily';
}

interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: ScheduledMessage | null;
  contacts: Contact[];
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  initialData,
  contacts,
}: ScheduleMessageDialogProps) {
  const isEdit = !!initialData;
  const createMutation = useCreateScheduledMessage();
  const editMutation = useEditScheduledMessage();
  const isPending = createMutation.isPending || editMutation.isPending;

  const [recipientJid, setRecipientJid] = useState('');
  const [content, setContent] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [type, setType] = useState<'text' | 'voice' | 'ai'>('text');
  const [cadence, setCadence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when dialog opens or initialData changes
  useEffect(() => {
    if (!open) return;
    if (initialData) {
      setRecipientJid(
        initialData.recipients[0]?.recipientJid ?? '',
      );
      setContent(initialData.content);
      setScheduledAt(toDatetimeLocal(initialData.scheduledAt));
      setType(initialData.type);
      setCadence(getCadenceFromCron(initialData.cronExpression) ?? 'none');
    } else {
      setRecipientJid('');
      setContent('');
      setScheduledAt(toDatetimeLocal(Date.now() + 60 * 60 * 1000));
      setType('text');
      setCadence('none');
    }
    setErrors({});
  }, [open, initialData]);

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!recipientJid) errs.recipientJid = 'Recipient is required';
    if (!content.trim()) errs.content = 'Message content is required';
    const minTime = Date.now() + 60 * 1000; // 1 minute minimum
    if (!scheduledAt || new Date(scheduledAt).getTime() < minTime) {
      errs.scheduledAt = 'Must be in the future';
    }
    return errs;
  }

  async function handleSubmit() {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});

    try {
      if (isEdit) {
        await editMutation.mutateAsync({
          id: initialData!.id,
          content,
          scheduledAt: new Date(scheduledAt).getTime(),
          cadence: cadence !== 'none' ? cadence : null,
        });
        toast.success('Message updated');
      } else {
        await createMutation.mutateAsync({
          recipientJid,
          content,
          scheduledAt: new Date(scheduledAt).getTime(),
          type,
          cadence: cadence !== 'none' ? cadence : undefined,
        });
        toast.success('Message scheduled');
      }
      onOpenChange(false);
    } catch {
      toast.error('Failed to schedule message');
    }
  }

  const contentConfig: Record<'text' | 'voice' | 'ai', { label: string; placeholder: string }> = {
    text:  { label: 'Message',       placeholder: 'Type your message\u2026' },
    voice: { label: 'Text to speak', placeholder: 'Type what should be spoken\u2026' },
    ai:    { label: 'Prompt for AI', placeholder: 'e.g., wish them happy birthday in a casual way' },
  };

  const minDatetime = toDatetimeLocal(Date.now() + 60 * 1000);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit Scheduled Message' : 'Schedule a Message'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipient */}
          <div className="space-y-1.5">
            <Label htmlFor="recipient">Recipient</Label>
            <Select
              value={recipientJid}
              onValueChange={setRecipientJid}
              disabled={isEdit}
            >
              <SelectTrigger id="recipient" className="w-full">
                <SelectValue placeholder="Select a contact" />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((contact) => (
                  <SelectItem key={contact.jid} value={contact.jid}>
                    {contact.name || contact.jid}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.recipientJid && (
              <p className="text-sm text-destructive">{errors.recipientJid}</p>
            )}
          </div>

          {/* Content */}
          <div className="space-y-1.5">
            <Label htmlFor="content">{contentConfig[type].label}</Label>
            <Textarea
              id="content"
              placeholder={contentConfig[type].placeholder}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="resize-none"
            />
            {errors.content && (
              <p className="text-sm text-destructive">{errors.content}</p>
            )}
          </div>

          {/* Date/time */}
          <div className="space-y-1.5">
            <Label htmlFor="scheduledAt">Scheduled time</Label>
            <input
              id="scheduledAt"
              type="datetime-local"
              value={scheduledAt}
              min={minDatetime}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.scheduledAt && (
              <p className="text-sm text-destructive">{errors.scheduledAt}</p>
            )}
          </div>

          {/* Repeat */}
          <div className="space-y-1.5">
            <Label>Repeat</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as typeof cadence)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (one-off)</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
            {cadence !== 'none' && scheduledAt && (() => {
              try {
                const cron = buildCronExpression(cadence, new Date(scheduledAt).getTime());
                return (
                  <p className="text-xs text-muted-foreground">
                    {cronstrue.toString(cron, { use24HourTimeFormat: true })}
                  </p>
                );
              } catch {
                return null;
              }
            })()}
          </div>

          {/* Type selector */}
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="flex gap-3">
              {(['text', 'voice', 'ai'] as const).map((t) => (
                <label
                  key={t}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="radio"
                    name="type"
                    value={t}
                    checked={type === t}
                    onChange={() => setType(t)}
                    className="accent-emerald-600"
                  />
                  {t === 'text' ? 'Text' : t === 'voice' ? 'Voice' : 'AI'}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isEdit ? 'Save Changes' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
