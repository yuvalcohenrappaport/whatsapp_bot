import { CircleCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DraftRow } from '@/components/drafts/DraftRow';
import { useDrafts, useClearDrafts } from '@/hooks/useDrafts';
import { StickyActionBar } from '@/components/ui/StickyActionBar';

export default function Drafts() {
  const { data: drafts, isLoading } = useDrafts();
  const clearDrafts = useClearDrafts();

  const hasDrafts = !isLoading && drafts && drafts.length > 0;

  return (
    // pb-24 md:pb-0 — on phone the StickyActionBar is fixed at the bottom;
    // this padding prevents the last card from being obscured by the bar.
    // On desktop StickyActionBar renders inline (mt-4 div), so no padding needed.
    <div className={hasDrafts ? 'pb-24 md:pb-0' : undefined}>
      <div className="flex items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>Drafts</h1>
          <p className="text-sm text-muted-foreground mt-1">Review and approve AI-generated replies</p>
        </div>
        {hasDrafts && (
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

      {/* Primary action — wrapped in StickyActionBar so it stays reachable
          while the user scrolls a long draft list on phone. On desktop,
          StickyActionBar renders inline (Plan 50-01 behavior). */}
      {hasDrafts && (
        <StickyActionBar>
          <Button
            size="sm"
            variant="outline"
            disabled={clearDrafts.isPending}
            onClick={() => {
              clearDrafts.mutate(undefined, {
                onSuccess: () => toast.success('All drafts cleared'),
              });
            }}
          >
            <Trash2 className="size-4 mr-1.5" />
            Clear all
          </Button>
        </StickyActionBar>
      )}
    </div>
  );
}
