import { useState, useEffect, useCallback } from 'react';
import { Moon, Sun } from 'lucide-react';
import { QRModal } from '@/components/status/QRModal';
import { ConnectionBadge } from '@/components/status/ConnectionBadge';
import { DisconnectBanner } from '@/components/status/DisconnectBanner';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
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
      <header className="flex h-14 items-center justify-between border-b border-border/50 px-6 backdrop-blur-sm bg-background/80">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="md:hidden" />
          <span className="font-semibold text-lg" style={{ fontFamily: 'var(--font-heading)' }}>
            WhatsApp Bot
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionBadge status={status} />
          <ThemeToggle />
        </div>
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

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }, [dark]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className="size-8 cursor-pointer"
      aria-label="Toggle theme"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
