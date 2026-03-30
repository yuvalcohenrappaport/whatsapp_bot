import { useState } from 'react';
import { CalendarClock, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScheduledMessageCard } from '@/components/scheduled-messages/ScheduledMessageCard';
import { ScheduleMessageDialog } from '@/components/scheduled-messages/ScheduleMessageDialog';
import { useScheduledMessages, type ScheduledMessage } from '@/hooks/useScheduledMessages';
import { useContacts } from '@/hooks/useContacts';

type TabValue = 'all' | 'pending' | 'sent' | 'failed';

function MessageList({
  tab,
  onEdit,
  onOpenCreate,
}: {
  tab: TabValue;
  onEdit: (message: ScheduledMessage) => void;
  onOpenCreate: () => void;
}) {
  const { data: messages, isLoading } = useScheduledMessages(
    tab === 'all' ? undefined : tab,
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Clock className="size-12 mb-4 opacity-50" />
        <p className="text-lg">No scheduled messages yet</p>
        <p className="text-sm mt-1 mb-6">Schedule a message to get started.</p>
        {tab === 'all' && (
          <Button onClick={onOpenCreate}>Schedule your first message</Button>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <ScheduledMessageCard key={message.id} message={message} onEdit={onEdit} />
      ))}
    </div>
  );
}

export default function ScheduledMessages() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);
  const [selectedTab, setSelectedTab] = useState<TabValue>('all');
  const { data: contacts = [] } = useContacts();

  function handleOpenCreate() {
    setEditingMessage(null);
    setDialogOpen(true);
  }

  function handleOpenEdit(message: ScheduledMessage) {
    setEditingMessage(message);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditingMessage(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-semibold mb-1"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Scheduled Messages
          </h1>
          <p className="text-sm text-muted-foreground">
            Messages queued to send at a future time
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <CalendarClock className="size-4 mr-2" />
          Schedule Message
        </Button>
      </div>

      <Tabs
        value={selectedTab}
        onValueChange={(v) => setSelectedTab(v as TabValue)}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
          <TabsTrigger value="failed">Failed / Cancelled</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <MessageList tab="all" onEdit={handleOpenEdit} onOpenCreate={handleOpenCreate} />
        </TabsContent>
        <TabsContent value="pending">
          <MessageList tab="pending" onEdit={handleOpenEdit} onOpenCreate={handleOpenCreate} />
        </TabsContent>
        <TabsContent value="sent">
          <MessageList tab="sent" onEdit={handleOpenEdit} onOpenCreate={handleOpenCreate} />
        </TabsContent>
        <TabsContent value="failed">
          <MessageList tab="failed" onEdit={handleOpenEdit} onOpenCreate={handleOpenCreate} />
        </TabsContent>
      </Tabs>

      <ScheduleMessageDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        initialData={editingMessage}
        contacts={contacts}
      />
    </div>
  );
}
