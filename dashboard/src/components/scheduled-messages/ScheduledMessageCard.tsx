import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useCancelScheduledMessage,
  type ScheduledMessage,
} from '@/hooks/useScheduledMessages';

const STATUS_STYLES: Record<string, { className: string; label: string }> = {
  pending: {
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    label: 'Pending',
  },
  notified: {
    className:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    label: 'Notified',
  },
  sending: {
    className:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 animate-pulse',
    label: 'Sending',
  },
  sent: {
    className:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    label: 'Sent',
  },
  failed: {
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    label: 'Failed',
  },
  cancelled: {
    className:
      'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    label: 'Cancelled',
  },
  expired: {
    className:
      'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    label: 'Expired',
  },
};

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  voice: 'Voice',
  ai: 'AI',
};

function getCadenceFromCron(cronExpression: string | null): string | null {
  if (!cronExpression) return null;
  const parts = cronExpression.trim().split(/\s+/);
  if (parts[2] !== '*') return 'Monthly';
  if (parts[4] !== '*') return 'Weekly';
  return 'Daily';
}

function formatScheduledAt(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-IL', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getRelativeTime(timestamp: number): string | null {
  const diff = timestamp - Date.now();
  if (diff <= 0) return null;

  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  if (hours > 0) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  if (minutes > 0) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  return 'in less than a minute';
}

function getContentPreview(content: string): string {
  const words = content.trim().split(/\s+/);
  if (words.length <= 20) return content;
  return words.slice(0, 20).join(' ') + '…';
}

interface ScheduledMessageCardProps {
  message: ScheduledMessage;
  onEdit: (message: ScheduledMessage) => void;
}

export function ScheduledMessageCard({
  message,
  onEdit,
}: ScheduledMessageCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancel = useCancelScheduledMessage();

  const recipientName =
    message.recipients[0]?.name ??
    message.recipients[0]?.recipientJid ??
    'Unknown';
  const statusStyle = STATUS_STYLES[message.status] ?? STATUS_STYLES.pending;
  const typeLabel = TYPE_LABELS[message.type] ?? message.type;
  const cadenceLabel = getCadenceFromCron(message.cronExpression);
  const relative = getRelativeTime(message.scheduledAt);

  const canEdit = message.status === 'pending';
  const canCancel =
    message.status === 'pending' || message.status === 'notified';

  function handleConfirmCancel() {
    cancel.mutate(message.id, {
      onSuccess: () => toast.success('Message cancelled'),
      onError: (err) => toast.error(`Cancel failed: ${err.message}`),
    });
    setConfirmOpen(false);
  }

  return (
    <>
      <Card className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-semibold text-base truncate">{recipientName}</p>
            <p className="text-sm text-muted-foreground leading-snug">
              {getContentPreview(message.content)}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">
                {formatScheduledAt(message.scheduledAt)}
              </span>
              {relative && (
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                  ({relative})
                </span>
              )}
            </div>
            {message.failCount > 0 && (
              <p className="text-xs text-red-500">
                Failed {message.failCount} time{message.failCount === 1 ? '' : 's'}
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{typeLabel}{cadenceLabel ? ` \u00b7 ${cadenceLabel}` : ''}</Badge>
              <Badge variant="outline" className={statusStyle.className}>
                {statusStyle.label}
              </Badge>
            </div>
            {(canEdit || canCancel) && (
              <div className="flex gap-2">
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEdit(message)}
                  >
                    <Pencil className="size-3.5 mr-1" />
                    Edit
                  </Button>
                )}
                {canCancel && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                    disabled={cancel.isPending}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <X className="size-3.5 mr-1" />
                    Cancel
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this scheduled message?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmCancel}
            >
              Cancel Message
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
