import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface GoogleTasksStatus {
  configured: boolean;
  connected: boolean;
  user: { email: string } | null;
}

interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  calendarId: string | null;
}

export default function Integrations() {
  const qc = useQueryClient();

  const { data: tasksStatus, isLoading: tasksLoading } = useQuery({
    queryKey: ['google-tasks-status'],
    queryFn: () => apiFetch<GoogleTasksStatus>('/api/integrations/google-tasks/status'),
    refetchInterval: 30_000,
  });

  const { data: calendarStatus, isLoading: calendarLoading } = useQuery({
    queryKey: ['calendar-status'],
    queryFn: () => apiFetch<CalendarStatus>('/api/personal-calendar/status'),
    refetchInterval: 30_000,
  });

  // Handle OAuth callback redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get('google');
    if (google === 'connected') {
      toast.success('Google account connected successfully');
      qc.invalidateQueries({ queryKey: ['google-tasks-status'] });
      qc.invalidateQueries({ queryKey: ['calendar-status'] });
    } else if (google === 'error') {
      toast.error('Failed to connect Google account');
    }
    if (google) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [qc]);

  const isLoading = tasksLoading || calendarLoading;
  const isConnected = calendarStatus?.connected ?? false;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
        Integrations
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Google services powering your bot's calendar events, reminders, and tasks
      </p>

      <div className="space-y-4">
        {/* Google Calendar */}
        <Card className="card-shine p-5 md:p-8 border-border/50">
          <CardHeader className="p-0 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10">
                  <Plug className="size-4 text-blue-500" />
                </div>
                <div>
                  <CardTitle className="text-base font-medium">Google Calendar</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Auto-detect events from chats and add to your calendar
                  </p>
                </div>
              </div>
              {isConnected && (
                <Badge className="bg-emerald-subtle text-emerald border-glow-emerald">
                  Connected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : !calendarStatus?.configured ? (
              <NotConfiguredState />
            ) : isConnected ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-emerald shrink-0" />
                <div>
                  <p className="text-sm font-medium">Connected</p>
                  {calendarStatus.calendarId && (
                    <p className="text-xs text-muted-foreground">
                      Calendar: {calendarStatus.calendarId}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <AlertCircle className="size-5 text-amber-accent shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Not connected. Visit <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/auth/google</code> to authorize.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Google Tasks */}
        <Card className="card-shine p-5 md:p-8 border-border/50">
          <CardHeader className="p-0 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-green-500/10">
                  <Plug className="size-4 text-green-500" />
                </div>
                <div>
                  <CardTitle className="text-base font-medium">Google Tasks</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Sync detected tasks and reminders to Google Tasks
                  </p>
                </div>
              </div>
              {tasksStatus?.connected && (
                <Badge className="bg-emerald-subtle text-emerald border-glow-emerald">
                  Connected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : !tasksStatus?.configured ? (
              <NotConfiguredState />
            ) : tasksStatus.connected ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-emerald shrink-0" />
                <p className="text-sm font-medium">
                  Connected via Google Calendar OAuth
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <AlertCircle className="size-5 text-amber-accent shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Connect Google Calendar first — Tasks uses the same authorization.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NotConfiguredState() {
  return (
    <div className="rounded-lg border border-border/50 p-4 flex items-start gap-3">
      <AlertCircle className="size-5 text-amber-accent mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-medium mb-1">Configuration Required</p>
        <p className="text-sm text-muted-foreground">
          Set{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">GOOGLE_OAUTH_CLIENT_ID</code>,{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">GOOGLE_OAUTH_CLIENT_SECRET</code>, and{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">GOOGLE_OAUTH_REDIRECT_URI</code>{' '}
          environment variables to enable.
        </p>
      </div>
    </div>
  );
}
