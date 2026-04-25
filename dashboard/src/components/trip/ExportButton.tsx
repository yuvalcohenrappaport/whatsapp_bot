import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/api/client';

interface ExportButtonProps {
  groupJid: string;
}

export function ExportButton({ groupJid }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/api/trips/${groupJid}/export`,
        { method: 'POST' },
      );
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success('Exported');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // 412 body is JSON with error + action fields
      if (message.includes('412') || message.includes('Google Docs scope')) {
        toast.error(
          <span>
            Re-authorize Google in{' '}
            <a href="/integrations" className="underline">
              Settings → Integrations
            </a>
          </span>,
          { duration: 5000 },
        );
      } else {
        toast.error(`Export failed: ${message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-2" />
      )}
      Export to Google Doc
    </Button>
  );
}
