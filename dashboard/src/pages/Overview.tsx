import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Users, UsersRound, Calendar, Bell, CheckSquare } from 'lucide-react';
import { apiFetch } from '@/api/client';
import { usePersonalEventsCount } from '@/hooks/usePersonalEvents';
import { useReminderStats } from '@/hooks/useReminders';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSettings } from '@/hooks/useSettings';

interface TaskStats {
  pending: number;
  synced: number;
  cancelled: number;
  failed: number;
}

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
    key: 'events',
    title: 'Pending Events',
    description: 'Calendar events awaiting approval',
    icon: Calendar,
    color: 'violet',
    glowClass: 'glow-violet',
    borderClass: 'border-glow-violet',
    textClass: 'text-violet-accent',
    bgClass: 'bg-violet-subtle',
  },
  {
    key: 'reminders',
    title: 'Pending Reminders',
    description: 'Reminders waiting to fire',
    icon: Bell,
    color: 'amber',
    glowClass: 'glow-amber',
    borderClass: 'border-glow-amber',
    textClass: 'text-amber-accent',
    bgClass: 'bg-amber-subtle',
  },
  {
    key: 'tasks',
    title: 'Synced Tasks',
    description: 'Tasks synced to Google Tasks',
    icon: CheckSquare,
    color: 'blue',
    glowClass: 'glow-blue',
    borderClass: 'border-blue-500/30',
    textClass: 'text-blue-400',
    bgClass: 'bg-blue-500/10',
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
  const pendingEventsCount = usePersonalEventsCount();
  const { data: reminderStats } = useReminderStats();
  const { data: taskStats } = useQuery({
    queryKey: ['task-stats'],
    queryFn: () => apiFetch<TaskStats>('/api/tasks/stats'),
    refetchInterval: 30_000,
  });

  const values: Record<string, number> = {
    drafts: drafts?.length ?? 0,
    contacts: contacts?.filter((c) => c.mode !== 'off').length ?? 0,
    events: pendingEventsCount,
    reminders: reminderStats?.pending ?? 0,
    tasks: taskStats?.synced ?? 0,
    groups: groups?.filter((g) => g.travelBotActive || g.keywordRulesActive).length ?? 0,
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1" style={{ fontFamily: 'var(--font-heading)' }}>Overview</h1>
      <p className="text-sm text-muted-foreground mb-6">Your bot at a glance</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {statConfig.map((stat) => {
          const value = values[stat.key];
          const highlight = (stat.key === 'drafts' || stat.key === 'events' || stat.key === 'reminders' || stat.key === 'tasks') && value > 0;
          return (
            <Card
              key={stat.key}
              className={`card-shine p-4 md:p-5 transition-all duration-200 cursor-pointer hover:border-border ${highlight ? `${stat.borderClass} ${stat.glowClass}` : 'border-border/50'}`}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className={`flex size-7 items-center justify-center rounded-md ${stat.bgClass}`}>
                  <stat.icon className={`size-3.5 ${stat.textClass}`} />
                </div>
                <span className="text-xs font-medium text-muted-foreground truncate">{stat.title}</span>
              </div>
              <p className={`text-xl sm:text-2xl md:text-3xl font-bold tracking-tight ${highlight ? stat.textClass : ''}`}>{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
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
