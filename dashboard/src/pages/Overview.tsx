import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSettings } from '@/hooks/useSettings';

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

      <div className="mt-8">
        <ProviderCard />
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

function ProviderCard() {
  const { settings, isLoading, setProvider, isSwitching } = useSettings();

  if (isLoading) {
    return (
      <Card className="p-5 md:p-8">
        <CardHeader className="p-0 mb-4">
          <CardTitle className="text-base font-medium text-muted-foreground">AI Provider</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  const current = settings?.aiProvider ?? 'gemini';
  const localOnline = settings?.localModelOnline ?? false;

  return (
    <Card className="p-5 md:p-8">
      <CardHeader className="p-0 mb-4">
        <CardTitle className="text-base font-medium text-muted-foreground">AI Provider</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <p className="text-sm text-muted-foreground mb-4">
          Choose which AI model powers your bot's responses
        </p>
        <div className="flex gap-3">
          <Button
            variant={current === 'gemini' ? 'default' : 'outline'}
            onClick={() => setProvider('gemini')}
            disabled={isSwitching}
            className="flex-1 h-auto py-4 flex flex-col items-center gap-1"
          >
            <span className="font-semibold">Gemini API</span>
            <span className="text-xs opacity-75">Google Cloud</span>
          </Button>
          <Button
            variant={current === 'local' ? 'default' : 'outline'}
            onClick={() => setProvider('local')}
            disabled={isSwitching || !localOnline}
            className="flex-1 h-auto py-4 flex flex-col items-center gap-1"
          >
            <span className="font-semibold">Local Model</span>
            <span className="text-xs opacity-75 flex items-center gap-1.5">
              LM Studio
              <Badge variant={localOnline ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                {localOnline ? 'online' : 'offline'}
              </Badge>
            </span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
