import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, Clock, XCircle, AlertTriangle, ListChecks } from 'lucide-react';
import { apiFetch } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type TaskStatus = 'all' | 'synced' | 'pending' | 'cancelled' | 'failed';

interface TodoTask {
  id: string;
  task: string;
  contactJid: string;
  contactName: string | null;
  originalText: string | null;
  status: string;
  confidence: string;
  createdAt: number;
  syncedAt: number | null;
}

interface TasksResponse {
  tasks: TodoTask[];
  total: number;
}

interface TaskStats {
  pending: number;
  synced: number;
  cancelled: number;
  failed: number;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  synced: { label: 'Synced to Google Tasks', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckSquare },
  pending: { label: 'Pending', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: Clock },
  cancelled: { label: 'Cancelled', color: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20', icon: XCircle },
  failed: { label: 'Failed', color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: AlertTriangle },
};

const PAGE_SIZE = 50;

function TaskList({ status }: { status: TaskStatus }) {
  const [offset, setOffset] = useState(0);

  const queryParams = new URLSearchParams();
  queryParams.set('limit', String(PAGE_SIZE));
  queryParams.set('offset', String(offset));
  if (status !== 'all') queryParams.set('status', status);

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', status, offset],
    queryFn: () => apiFetch<TasksResponse>(`/api/tasks?${queryParams.toString()}`),
    refetchInterval: 15_000,
  });

  const loadMore = useCallback(() => {
    setOffset((prev) => prev + PAGE_SIZE);
  }, []);

  if (isLoading && offset === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;

  if (tasks.length === 0 && offset === 0) {
    return (
      <Card className="flex flex-col items-center justify-center py-20">
        <ListChecks className="size-12 mb-4 opacity-50 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">No tasks detected yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Tasks will appear here when the bot detects commitments in conversations
        </p>
      </Card>
    );
  }

  return (
    <div>
      <div className="rounded-lg border border-border/50 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Task</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Contact</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Synced</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const cfg = statusConfig[task.status] ?? statusConfig.pending;
              return (
                <tr key={task.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium truncate max-w-[300px]">{task.task}</p>
                    {task.originalText && (
                      <p className="text-xs text-muted-foreground truncate max-w-[300px] mt-0.5">
                        {task.originalText}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm">{task.contactName ?? task.contactJid.split('@')[0]}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-xs ${cfg.color}`}>
                      {cfg.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {task.status === 'synced' ? (
                      <CheckSquare className="size-4 text-emerald" />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-muted-foreground">
                      {new Date(task.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {offset + PAGE_SIZE < total && (
        <div className="flex justify-center mt-4">
          <Button variant="outline" size="sm" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Tasks() {
  const [tab, setTab] = useState<TaskStatus>('all');
  const { data: stats } = useQuery({
    queryKey: ['task-stats'],
    queryFn: () => apiFetch<TaskStats>('/api/tasks/stats'),
    refetchInterval: 30_000,
  });

  const totalCount = stats
    ? stats.pending + stats.synced + stats.cancelled + stats.failed
    : 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1" style={{ fontFamily: 'var(--font-heading)' }}>
        Tasks
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Tasks detected from your conversations
      </p>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TaskStatus)}>
        <TabsList className="mb-4">
          <TabsTrigger value="all" className="gap-1.5">
            All
            {totalCount > 0 && <Badge variant="secondary" className="ml-1">{totalCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="synced" className="gap-1.5">
            Synced
            {(stats?.synced ?? 0) > 0 && <Badge variant="secondary" className="ml-1">{stats!.synced}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5">
            Pending
            {(stats?.pending ?? 0) > 0 && <Badge variant="secondary" className="ml-1">{stats!.pending}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
        </TabsList>

        <TabsContent value="all"><TaskList status="all" /></TabsContent>
        <TabsContent value="synced"><TaskList status="synced" /></TabsContent>
        <TabsContent value="pending"><TaskList status="pending" /></TabsContent>
        <TabsContent value="cancelled"><TaskList status="cancelled" /></TabsContent>
        <TabsContent value="failed"><TaskList status="failed" /></TabsContent>
      </Tabs>
    </div>
  );
}
