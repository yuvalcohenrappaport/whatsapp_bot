import { useState } from 'react';
import { CalendarCheck, CalendarX, CircleCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EventCard } from '@/components/events/EventCard';
import { usePersonalEvents } from '@/hooks/usePersonalEvents';

type Status = 'pending' | 'approved' | 'rejected';

const emptyConfig: Record<Status, { icon: React.ElementType; message: string }> = {
  pending: { icon: CircleCheck, message: 'No pending events' },
  approved: { icon: CalendarCheck, message: 'No approved events' },
  rejected: { icon: CalendarX, message: 'No rejected events' },
};

function EventList({ status }: { status: Status }) {
  const { data: events, isLoading } = usePersonalEvents(status);
  const empty = emptyConfig[status];

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center py-20">
        <empty.icon className="size-12 mb-4 opacity-50 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">{empty.message}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {status === 'pending' ? "You're all caught up." : `No ${status} events yet.`}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}

export default function Events() {
  const [tab, setTab] = useState<Status>('pending');
  const { data: pendingEvents } = usePersonalEvents('pending');
  const pendingCount = pendingEvents?.length ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6" style={{ fontFamily: 'var(--font-heading)' }}>
        Events
      </h1>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
        <TabsList className="mb-4">
          <TabsTrigger value="pending" className="gap-1.5">
            Pending
            {pendingCount > 0 && <Badge variant="secondary" className="ml-1">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <EventList status="pending" />
        </TabsContent>
        <TabsContent value="approved">
          <EventList status="approved" />
        </TabsContent>
        <TabsContent value="rejected">
          <EventList status="rejected" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
