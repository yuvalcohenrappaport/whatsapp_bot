import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Users, UsersRound } from 'lucide-react';
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
  travelBotActive: boolean;
  keywordRulesActive: boolean;
}

const statConfig = [
  {
    key: 'drafts',
    title: 'Pending Drafts',
    description: 'Replies awaiting your approval',
    icon: MessageSquare,
    color: 'amber',
    glowClass: 'glow-amber',
    borderClass: 'border-glow-amber',
    textClass: 'text-amber-accent',
    bgClass: 'bg-amber-subtle',
  },
  {
    key: 'contacts',
    title: 'Active Contacts',
    description: 'Contacts with draft or auto mode',
    icon: Users,
    color: 'emerald',
    glowClass: 'glow-emerald',
    borderClass: 'border-glow-emerald',
    textClass: 'text-emerald',
    bgClass: 'bg-emerald-subtle',
  },
  {
    key: 'groups',
    title: 'Tracked Groups',
    description: 'WhatsApp groups being monitored',
    icon: UsersRound,
    color: 'teal',
    glowClass: 'glow-teal',
    borderClass: 'border-glow-teal',
    textClass: 'text-teal',
    bgClass: 'bg-teal-subtle',
  },
] as const;

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

  const values: Record<string, number> = {
    drafts: drafts?.length ?? 0,
    contacts: contacts?.filter((c) => c.mode !== 'off').length ?? 0,
    groups: groups?.filter((g) => g.travelBotActive || g.keywordRulesActive).length ?? 0,
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6" style={{ fontFamily: 'var(--font-heading)' }}>Overview</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statConfig.map((stat) => {
          const value = values[stat.key];
          const highlight = stat.key === 'drafts' && value > 0;
          return (
            <Card
              key={stat.key}
              className={`card-shine p-5 md:p-8 transition-all duration-300 hover:scale-[1.02] ${highlight ? `${stat.borderClass} ${stat.glowClass}` : 'border-border/50'}`}
            >
              <CardHeader className="p-0 mb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium text-muted-foreground">{stat.title}</CardTitle>
                  <div className={`flex size-9 items-center justify-center rounded-lg ${stat.bgClass}`}>
                    <stat.icon className={`size-4 ${stat.textClass}`} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <p className={`text-3xl md:text-5xl font-bold ${highlight ? stat.textClass : ''}`}>{value}</p>
                <p className="text-sm text-muted-foreground mt-2">{stat.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-8 space-y-8">
        <ProviderCard />
        <PersonaCard />
      </div>
    </div>
  );
}

function PersonaCard() {
  const { settings, isLoading, regeneratePersona, isRegeneratingPersona } = useSettings();

  if (isLoading) {
    return (
      <Card className="card-shine p-5 md:p-8 border-border/50">
        <CardHeader className="p-0 mb-4">
          <CardTitle className="text-base font-medium text-muted-foreground">Global Persona</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  const persona = settings?.globalPersona;

  return (
    <Card className="card-shine p-5 md:p-8 border-border/50">
      <CardHeader className="p-0 mb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium text-violet-accent">Global Persona</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => regeneratePersona()}
            disabled={isRegeneratingPersona}
            className="border-border/50 hover:border-glow-violet hover:glow-violet"
          >
            {isRegeneratingPersona ? 'Generating...' : 'Regenerate'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {persona ? (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{persona}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No persona generated yet. Import chat history and click Regenerate to create one.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderCard() {
  const { settings, isLoading, setProvider, isSwitching } = useSettings();

  if (isLoading) {
    return (
      <Card className="card-shine p-5 md:p-8 border-border/50">
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
    <Card className="card-shine p-5 md:p-8 border-border/50">
      <CardHeader className="p-0 mb-4">
        <CardTitle className="text-base font-medium text-teal">AI Provider</CardTitle>
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
            className={`flex-1 h-auto py-4 flex flex-col items-center gap-1 transition-all ${current === 'gemini' ? 'glow-emerald' : 'border-border/50 hover:border-glow-emerald'}`}
          >
            <span className="font-semibold">Gemini API</span>
            <span className="text-xs opacity-75">Google Cloud</span>
          </Button>
          <Button
            variant={current === 'local' ? 'default' : 'outline'}
            onClick={() => setProvider('local')}
            disabled={isSwitching || !localOnline}
            className={`flex-1 h-auto py-4 flex flex-col items-center gap-1 transition-all ${current === 'local' ? 'glow-teal' : 'border-border/50 hover:border-glow-teal'}`}
          >
            <span className="font-semibold">Local Model</span>
            <span className="text-xs opacity-75 flex items-center gap-1.5">
              LM Studio
              <Badge
                variant={localOnline ? 'default' : 'secondary'}
                className={`text-[10px] px-1.5 py-0 ${localOnline ? 'bg-emerald-subtle text-emerald border-glow-emerald' : ''}`}
              >
                {localOnline ? 'online' : 'offline'}
              </Badge>
            </span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
