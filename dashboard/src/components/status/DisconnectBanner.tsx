import { Button } from '@/components/ui/button';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';

interface DisconnectBannerProps {
  status: ConnectionStatus;
  onReauth: () => void;
}

export function DisconnectBanner({ status, onReauth }: DisconnectBannerProps) {
  if (status === 'connected') return null;

  return (
    <div className="flex items-center justify-between bg-[oklch(0.65_0.22_18_/_0.08)] border-b border-[oklch(0.65_0.22_18_/_0.15)] px-4 py-2 text-sm text-[oklch(0.78_0.16_18)]">
      <span>Bot disconnected — Reconnecting...</span>
      <Button variant="destructive" size="sm" onClick={onReauth} className="shadow-[0_0_12px_oklch(0.65_0.22_18_/_0.2)]">
        Re-auth
      </Button>
    </div>
  );
}
