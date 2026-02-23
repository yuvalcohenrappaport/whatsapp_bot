import { useState } from 'react';
import { QRModal } from '@/components/status/QRModal';
import { ConnectionBadge } from '@/components/status/ConnectionBadge';
import { DisconnectBanner } from '@/components/status/DisconnectBanner';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';

interface TopbarProps {
  status: ConnectionStatus;
  qr: string | null;
}

export function Topbar({ status, qr }: TopbarProps) {
  const [qrModalOpen, setQrModalOpen] = useState(false);

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <span className="font-semibold text-lg">WhatsApp Bot</span>
        <ConnectionBadge status={status} />
      </header>
      {status !== 'connected' && (
        <DisconnectBanner
          status={status}
          onReauth={() => setQrModalOpen(true)}
        />
      )}
      <QRModal
        open={qrModalOpen}
        qr={qr}
        status={status}
        onClose={() => setQrModalOpen(false)}
      />
    </>
  );
}
