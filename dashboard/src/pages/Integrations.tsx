import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface MicrosoftStatus {
  configured: boolean;
  connected: boolean;
  user: { email: string; name: string } | null;
}

interface HealthStatus {
  healthy: boolean;
  lastChecked: string;
}

interface TaskStats {
  pending: number;
  synced: number;
  cancelled: number;
  failed: number;
}

export default function Integrations() {
  const qc = useQueryClient();
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [connecting, setConnecting] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['microsoft-status'],
    queryFn: () => apiFetch<MicrosoftStatus>('/api/integrations/microsoft/status'),
    refetchInterval: 30_000,
  });

  const { data: health } = useQuery({
    queryKey: ['microsoft-health'],
    queryFn: () => apiFetch<HealthStatus>('/api/integrations/microsoft/health'),
    enabled: !!status?.connected,
    refetchInterval: 60_000,
  });

  // Handle OAuth callback redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const microsoft = params.get('microsoft');
    if (microsoft === 'connected') {
      toast.success('Microsoft account connected successfully');
      qc.invalidateQueries({ queryKey: ['microsoft-status'] });
    } else if (microsoft === 'error') {
      toast.error('Failed to connect Microsoft account');
    }
    if (microsoft) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [qc]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const { url } = await apiFetch<{ url: string }>('/api/auth/microsoft');
      window.location.href = url;
    } catch {
      toast.error('Failed to start Microsoft authentication');
      setConnecting(false);
    }
  }, []);

  const handleDisconnectClick = useCallback(async () => {
    try {
      const stats = await apiFetch<TaskStats>('/api/tasks/stats');
      if (stats.pending > 0) {
        setPendingCount(stats.pending);
        setShowDisconnectDialog(true);
      } else {
        await performDisconnect();
      }
    } catch {
      await performDisconnect();
    }
  }, []);

  const performDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await apiFetch('/api/integrations/microsoft/disconnect', { method: 'POST' });
      toast.success('Microsoft account disconnected');
      qc.invalidateQueries({ queryKey: ['microsoft-status'] });
      qc.invalidateQueries({ queryKey: ['microsoft-health'] });
    } catch {
      toast.error('Failed to disconnect Microsoft account');
    } finally {
      setDisconnecting(false);
      setShowDisconnectDialog(false);
    }
  }, [qc]);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
        Integrations
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Connect external services to extend your bot's capabilities
      </p>

      <Card className="card-shine p-5 md:p-8 border-border/50">
        <CardHeader className="p-0 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10">
                <Plug className="size-4 text-blue-500" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Microsoft To Do</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Sync detected tasks to Microsoft To Do
                </p>
              </div>
            </div>
            {status?.connected && health && (
              <Badge
                variant={health.healthy ? 'default' : 'secondary'}
                className={health.healthy
                  ? 'bg-emerald-subtle text-emerald border-glow-emerald'
                  : 'bg-red-500/10 text-red-400 border-red-500/20'
                }
              >
                {health.healthy ? 'Healthy' : 'Unhealthy'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !status?.configured ? (
            <NotConfiguredState />
          ) : status.connected ? (
            <ConnectedState
              email={status.user?.email ?? 'Unknown'}
              name={status.user?.name ?? ''}
              onDisconnect={handleDisconnectClick}
              disconnecting={disconnecting}
            />
          ) : (
            <DisconnectedState onConnect={handleConnect} connecting={connecting} />
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Microsoft Account?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {pendingCount} task{pendingCount !== 1 ? 's' : ''} pending sync.
              Disconnecting will cancel them. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={performDisconnect}
              className="bg-red-600 hover:bg-red-700"
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          Microsoft To Do integration requires Azure AD app registration. Set{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">MS_CLIENT_ID</code>,{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">MS_CLIENT_SECRET</code>, and{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">MS_OAUTH_REDIRECT_URI</code>{' '}
          environment variables to enable.
        </p>
      </div>
    </div>
  );
}

function DisconnectedState({ onConnect, connecting }: { onConnect: () => void; connecting: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Connect your Microsoft account to automatically sync detected tasks to Microsoft To Do
      </p>
      <Button
        onClick={onConnect}
        disabled={connecting}
        className="ml-4 shrink-0 bg-emerald hover:bg-emerald/90"
      >
        {connecting ? 'Connecting...' : (
          <>
            <ExternalLink className="size-4 mr-2" />
            Connect
          </>
        )}
      </Button>
    </div>
  );
}

function ConnectedState({
  email,
  name,
  onDisconnect,
  disconnecting,
}: {
  email: string;
  name: string;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="size-5 text-emerald shrink-0" />
        <div>
          <p className="text-sm font-medium">
            Connected as {email}
          </p>
          {name && <p className="text-xs text-muted-foreground">{name}</p>}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onDisconnect}
        disabled={disconnecting}
        className="ml-4 shrink-0 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
      >
        {disconnecting ? 'Disconnecting...' : 'Disconnect'}
      </Button>
    </div>
  );
}
