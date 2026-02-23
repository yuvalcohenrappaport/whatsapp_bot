import { Button } from '@/components/ui/button';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';

interface DisconnectBannerProps {
  status: ConnectionStatus;
  onReauth: () => void;
}

export function DisconnectBanner({ status, onReauth }: DisconnectBannerProps) {
  if (status === 'connected') return null;

  return (
    <div className="flex items-center justify-between bg-destructive/15 border-b border-destructive/25 px-4 py-2 text-sm text-destructive">
      <span>Bot disconnected — Reconnecting...</span>
      <Button variant="destructive" size="sm" onClick={onReauth}>
        Re-auth
      </Button>
    </div>
  );
}
