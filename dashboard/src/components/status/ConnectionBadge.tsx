import { Badge } from '@/components/ui/badge';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';

interface ConnectionBadgeProps {
  status: ConnectionStatus;
}

const statusConfig: Record<ConnectionStatus, { label: string; dotColor: string; badgeClass: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  connected: {
    label: 'Connected',
    dotColor: 'bg-[oklch(0.72_0.19_155)] shadow-[0_0_6px_oklch(0.72_0.19_155_/_0.5)]',
    badgeClass: 'bg-emerald-subtle text-emerald border-glow-emerald',
    variant: 'outline',
  },
  reconnecting: {
    label: 'Reconnecting...',
    dotColor: 'bg-[oklch(0.80_0.18_85)] animate-pulse',
    badgeClass: 'bg-amber-subtle text-amber-accent border-glow-amber',
    variant: 'outline',
  },
  qr_pending: {
    label: 'Scan QR',
    dotColor: 'bg-[oklch(0.75_0.18_85)] animate-pulse',
    badgeClass: 'bg-amber-subtle text-amber-accent border-glow-amber',
    variant: 'outline',
  },
  disconnected: {
    label: 'Disconnected',
    dotColor: 'bg-[oklch(0.65_0.22_18)]',
    badgeClass: 'bg-[oklch(0.65_0.22_18_/_0.1)] text-[oklch(0.75_0.18_18)] border-[oklch(0.65_0.22_18_/_0.25)]',
    variant: 'outline',
  },
};

export function ConnectionBadge({ status }: ConnectionBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge variant={config.variant} className={`gap-1.5 px-3 py-1 ${config.badgeClass}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${config.dotColor}`} />
      {config.label}
    </Badge>
  );
}
