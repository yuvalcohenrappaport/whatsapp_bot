import { useState, useEffect } from 'react';
import { toast } from 'sonner';
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
    } else {
      setRecipientJid('');
      setContent('');
      setScheduledAt('');
      setType('text');
    }
    setErrors({});
  }, [open, initialData]);

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!recipientJid) errs.recipientJid = 'Recipient is required';
    if (!content.trim()) errs.content = 'Message content is required';
    const minTime = Date.now() + 15 * 60 * 1000;
    if (!scheduledAt || new Date(scheduledAt).getTime() < minTime) {
      errs.scheduledAt = 'Must be at least 15 minutes in the future';
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
        });
        toast.success('Message updated');
      } else {
        await createMutation.mutateAsync({
          recipientJid,
          content,
          scheduledAt: new Date(scheduledAt).getTime(),
          type,
        });
        toast.success('Message scheduled');
      }
      onOpenChange(false);
    } catch {
      toast.error('Failed to schedule message');
    }
  }

  const minDatetime = toDatetimeLocal(Date.now() + 15 * 60 * 1000);

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
            <Label htmlFor="content">Message</Label>
            <Textarea
              id="content"
              placeholder="Type your message…"
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

          {/* Type selector */}
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="flex gap-3">
              {(['text', 'voice', 'ai'] as const).map((t) => (
                <label
                  key={t}
                  title={
                    t !== 'text' ? 'Coming in v1.6.1' : undefined
                  }
                  className={`flex items-center gap-2 text-sm cursor-pointer ${t !== 'text' ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="type"
                    value={t}
                    checked={type === t}
                    disabled={t !== 'text'}
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
