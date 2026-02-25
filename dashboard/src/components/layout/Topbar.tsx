import { useState, useEffect } from 'react';
import { QRModal } from '@/components/status/QRModal';
import { ConnectionBadge } from '@/components/status/ConnectionBadge';
import { DisconnectBanner } from '@/components/status/DisconnectBanner';
import { SidebarTrigger } from '@/components/ui/sidebar';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';

interface TopbarProps {
  status: ConnectionStatus;
  qr: string | null;
}

export function Topbar({ status, qr }: TopbarProps) {
  const [qrModalOpen, setQrModalOpen] = useState(false);

  // Auto-open QR modal when a QR code is available
  useEffect(() => {
    if (status === 'qr_pending' && qr) {
      setQrModalOpen(true);
    }
  }, [status, qr]);

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="md:hidden" />
          <span className="font-semibold text-lg">WhatsApp Bot</span>
        </div>
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
