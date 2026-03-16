import { Bell, Calendar, X, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCancelReminder, type Reminder } from '@/hooks/useReminders';

const statusStyles: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  pending: { variant: 'default', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  fired: { variant: 'default', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  cancelled: { variant: 'destructive', className: '' },
  skipped: { variant: 'secondary', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
};

function formatFireAt(timestamp: number): string {
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

interface ReminderCardProps {
  reminder: Reminder;
}

export function ReminderCard({ reminder }: ReminderCardProps) {
  const cancel = useCancelReminder();
  const isPending = reminder.status === 'pending';
  const style = statusStyles[reminder.status] ?? statusStyles.pending;
  const relative = isPending ? getRelativeTime(reminder.fireAt) : null;

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground shrink-0" />
            <h3 className="font-semibold text-base truncate">{reminder.task}</h3>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Clock className="size-3.5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{formatFireAt(reminder.fireAt)}</p>
            {relative && (
              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">({relative})</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {reminder.calendarEventId && (
            <span title="Calendar event created">
              <Calendar className="size-4 text-violet-500" />
            </span>
          )}
          <Badge variant={style.variant} className={style.className}>
            {reminder.status}
          </Badge>
        </div>
      </div>

      {isPending && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(reminder.id, {
                onSuccess: () => toast.success(`Reminder cancelled`),
                onError: (err) => toast.error(`Cancel failed: ${err.message}`),
              })
            }
          >
            <X className="size-4 mr-1" />
            Cancel
          </Button>
        </div>
      )}
    </Card>
  );
}
