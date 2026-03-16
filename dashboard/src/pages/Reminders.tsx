import { useState } from 'react';
import { Bell, CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReminderCard } from '@/components/reminders/ReminderCard';
import { useReminders } from '@/hooks/useReminders';

type Status = 'pending' | 'fired' | 'cancelled';

const emptyConfig: Record<Status, { icon: React.ElementType; message: string }> = {
  pending: { icon: Bell, message: 'No upcoming reminders' },
  fired: { icon: CheckCircle2, message: 'No completed reminders' },
  cancelled: { icon: XCircle, message: 'No cancelled reminders' },
};

function ReminderList({ status }: { status: Status }) {
  const { data: reminders, isLoading } = useReminders(status);
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

  if (!reminders || reminders.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center py-20">
        <empty.icon className="size-12 mb-4 opacity-50 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">{empty.message}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {status === 'pending' ? "You're all caught up." : `No ${status} reminders yet.`}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {reminders.map((reminder) => (
        <ReminderCard key={reminder.id} reminder={reminder} />
      ))}
    </div>
  );
}

export default function Reminders() {
  const [tab, setTab] = useState<Status>('pending');
  const { data: pendingReminders } = useReminders('pending');
  const pendingCount = pendingReminders?.length ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6" style={{ fontFamily: 'var(--font-heading)' }}>
        Reminders
      </h1>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
        <TabsList className="mb-4">
          <TabsTrigger value="pending" className="gap-1.5">
            Upcoming
            {pendingCount > 0 && <Badge variant="secondary" className="ml-1">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="fired">Completed</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <ReminderList status="pending" />
        </TabsContent>
        <TabsContent value="fired">
          <ReminderList status="fired" />
        </TabsContent>
        <TabsContent value="cancelled">
          <ReminderList status="cancelled" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
