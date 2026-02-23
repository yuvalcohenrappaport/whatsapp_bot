import { Badge } from '@/components/ui/badge';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';

interface ConnectionBadgeProps {
  status: ConnectionStatus;
}

const statusConfig: Record<ConnectionStatus, { label: string; dotColor: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  connected: { label: 'Connected', dotColor: 'bg-green-500', variant: 'outline' },
  reconnecting: { label: 'Reconnecting...', dotColor: 'bg-yellow-500', variant: 'outline' },
  qr_pending: { label: 'Scan QR', dotColor: 'bg-orange-500', variant: 'outline' },
  disconnected: { label: 'Disconnected', dotColor: 'bg-red-500', variant: 'destructive' },
};

export function ConnectionBadge({ status }: ConnectionBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge variant={config.variant} className="gap-1.5 px-3 py-1">
      <span className={`inline-block h-2 w-2 rounded-full ${config.dotColor}`} />
      {config.label}
    </Badge>
  );
}
