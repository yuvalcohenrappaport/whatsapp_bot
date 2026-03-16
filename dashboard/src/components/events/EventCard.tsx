import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApproveEvent, useRejectEvent, type PersonalEvent } from '@/hooks/usePersonalEvents';

function formatEventDate(timestamp: number, isAllDay: boolean | null): string {
  const date = new Date(timestamp);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  };
  if (isAllDay) {
    return `All day - ${date.toLocaleDateString('en-IL', opts)}`;
  }
  return date.toLocaleString('en-IL', {
    ...opts,
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface EventCardProps {
  event: PersonalEvent;
}

export function EventCard({ event }: EventCardProps) {
  const approve = useApproveEvent();
  const reject = useRejectEvent();
  const isPending = event.status === 'pending';

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base truncate">{event.title}</h3>
          <p className="text-sm text-muted-foreground">{formatEventDate(event.eventDate, event.isAllDay)}</p>
        </div>
        {!isPending && (
          <Badge variant={event.status === 'approved' ? 'default' : 'secondary'}>
            {event.status}
          </Badge>
        )}
      </div>

      <div className="text-sm text-muted-foreground">
        {event.sourceChatName && <span>From: {event.sourceChatName}</span>}
        {event.senderName && event.sourceChatName && <span> &middot; </span>}
        {event.senderName && <span>{event.senderName}</span>}
      </div>

      {event.location && (
        <p className="text-sm text-muted-foreground">{event.location}</p>
      )}

      {isPending && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={approve.isPending}
            onClick={() =>
              approve.mutate(event.id, {
                onSuccess: () => toast.success(`"${event.title}" approved`),
                onError: (err) => toast.error(`Approve failed: ${err.message}`),
              })
            }
          >
            <Check className="size-4 mr-1" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
            disabled={reject.isPending}
            onClick={() =>
              reject.mutate(event.id, {
                onSuccess: () => toast.success(`"${event.title}" rejected`),
                onError: (err) => toast.error(`Reject failed: ${err.message}`),
              })
            }
          >
            <X className="size-4 mr-1" />
            Reject
          </Button>
        </div>
      )}
    </Card>
  );
}
