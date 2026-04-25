import { useState } from 'react';
import { MapPinned, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { backfillGeocode } from '@/api/trips';

interface BackfillGeocodeButtonProps {
  groupJid: string;
  readOnly: boolean;
}

export function BackfillGeocodeButton({ groupJid, readOnly }: BackfillGeocodeButtonProps) {
  const [loading, setLoading] = useState(false);

  // Hidden on archived (read-only) trips
  if (readOnly) return null;

  const handleBackfill = async () => {
    setLoading(true);
    try {
      const summary = await backfillGeocode(groupJid);
      toast.success(
        `Geocoded ${summary.geocoded}, no match ${summary.no_match}, errors ${summary.error}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Backfill failed: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleBackfill}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <MapPinned className="h-4 w-4 mr-2" />
      )}
      Backfill Geocoding
    </Button>
  );
}
