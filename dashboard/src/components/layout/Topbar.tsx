import { ConnectionBadge } from '@/components/status/ConnectionBadge';
import { DisconnectBanner } from '@/components/status/DisconnectBanner';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';

interface TopbarProps {
  status: ConnectionStatus;
  qr: string | null;
  onReauth: () => void;
}

export function Topbar({ status, onReauth }: TopbarProps) {
  return (
    <div>
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <h1 className="text-base font-semibold">WhatsApp Bot</h1>
        <ConnectionBadge status={status} />
      </header>
      <DisconnectBanner status={status} onReauth={onReauth} />
    </div>
  );
}
