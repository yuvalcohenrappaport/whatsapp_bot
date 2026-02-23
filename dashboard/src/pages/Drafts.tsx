import { CircleCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DraftRow } from '@/components/drafts/DraftRow';
import { useDrafts } from '@/hooks/useDrafts';

export default function Drafts() {
  const { data: drafts, isLoading } = useDrafts();

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold">Drafts</h1>
        {drafts && drafts.length > 0 && (
          <Badge variant="secondary">{drafts.length}</Badge>
        )}
      </div>

      {isLoading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && drafts && drafts.length === 0 && (
        <Card className="flex flex-col items-center justify-center py-20">
          <CircleCheck className="size-12 mb-4 opacity-50 text-muted-foreground" />
          <p className="text-lg text-muted-foreground">No pending drafts</p>
          <p className="text-sm text-muted-foreground mt-1">
            You're all caught up.
          </p>
        </Card>
      )}

      {!isLoading && drafts && drafts.length > 0 && (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <DraftRow key={draft.id} draft={draft} />
          ))}
        </div>
      )}
    </div>
  );
}
