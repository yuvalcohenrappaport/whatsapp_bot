import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface Draft {
  status: string;
}

interface Contact {
  mode: string;
}

interface Group {
  active: boolean;
}

export default function Overview() {
  const { data: drafts } = useQuery({
    queryKey: ['drafts'],
    queryFn: () => apiFetch<Draft[]>('/api/drafts'),
  });
  const { data: contacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: () => apiFetch<Contact[]>('/api/contacts'),
  });
  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: () => apiFetch<Group[]>('/api/groups'),
  });

  const pendingDrafts = drafts?.length ?? 0;
  const activeContacts = contacts?.filter((c) => c.mode !== 'off').length ?? 0;
  const trackedGroups = groups?.filter((g) => g.active).length ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Overview</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <StatCard
          title="Pending Drafts"
          value={pendingDrafts}
          description="Replies awaiting your approval"
          highlight={pendingDrafts > 0}
        />
        <StatCard
          title="Active Contacts"
          value={activeContacts}
          description="Contacts with draft or auto mode"
        />
        <StatCard
          title="Tracked Groups"
          value={trackedGroups}
          description="WhatsApp groups being monitored"
        />
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
  highlight = false,
}: {
  title: string;
  value: number;
  description: string;
  highlight?: boolean;
}) {
  return (
    <Card className={`p-5 md:p-8 ${highlight ? 'border-primary' : ''}`}>
      <CardHeader className="p-0 mb-4">
        <CardTitle className="text-base font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <p className={`text-3xl md:text-5xl font-bold ${highlight ? 'text-primary' : ''}`}>{value}</p>
        <p className="text-sm text-muted-foreground mt-2">{description}</p>
      </CardContent>
    </Card>
  );
}
