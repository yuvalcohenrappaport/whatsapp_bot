import { useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';

interface QRModalProps {
  open: boolean;
  qr: string | null;
  status: ConnectionStatus;
  onClose: () => void;
}

export function QRModal({ open, qr, status, onClose }: QRModalProps) {
  // Auto-close when connection becomes established
  useEffect(() => {
    if (status === 'connected' && open) {
      onClose();
    }
  }, [status, open, onClose]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan QR Code</DialogTitle>
          <DialogDescription>
            Open WhatsApp on your phone, go to Linked Devices, and scan this code.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center p-6">
          {qr ? (
            <QRCodeSVG value={qr} size={240} bgColor="#ffffff" fgColor="#000000" />
          ) : (
            <p className="text-muted-foreground text-sm">
              Waiting for QR code... Make sure the bot is running.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
