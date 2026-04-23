/**
 * Sticky status strip at the top of /linkedin/queue.
 *
 * Desktop: 4 mini-cards — next slot | pending count | approved count | last published preview
 * Tablet: 2×2 grid
 * Mobile: 1 column stack
 *
 * Receives data via props (CONTEXT §2 — zero extra fetches):
 *   - pendingCount / approvedCount: derived by the parent from the queue list
 *   - lastPublished: newest PUBLISHED post or null (parent fetches once at mount)
 *   - degraded: when the /api/linkedin/health proxy reports upstream unavailable,
 *     the parent passes `degraded={{reason, onRetry}}` and we render a single
 *     amber warning banner instead of the 4 cards
 *
 * Internal state:
 *   - now: a Date that re-renders every 60s via setInterval, driving the
 *     countdown label. Nothing else lives here.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type LinkedInPost } from './postStatus';
import {
  nextPublishSlot,
  formatSlotLabel,
  formatCountdown,
} from './nextPublishSlot';

export interface StatusStripProps {
  pendingCount: number;
  approvedCount: number;
  /** Plan 37-04: count of PENDING_LESSON_SELECTION posts in the live queue. */
  lessonsToPick: number;
  /** Plan 37-04: count of PENDING_VARIANT posts in the live queue. */
  variantsToFinalize: number;
  lastPublished: LinkedInPost | null;
  degraded?: {
    reason: string;
    onRetry: () => void;
  };
  className?: string;
}

export function StatusStrip({
  pendingCount,
  approvedCount,
  lessonsToPick,
  variantsToFinalize,
  lastPublished,
  degraded,
  className,
}: StatusStripProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const wrapperClass = cn(
    // On phone (<md): 6 cards stack to ~450px and would consume half the
    // viewport if pinned. Only stick at md+ where the grid compresses to 3/6 cols.
    'md:sticky md:top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b',
    className,
  );

  if (degraded) {
    return (
      <div className={wrapperClass}>
        <Card className="p-4 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                pm-authority unreachable — queue may be stale
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Reason: {degraded.reason}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={degraded.onRetry}
              className="shrink-0"
            >
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const slot = nextPublishSlot(now);
  const slotLabel = formatSlotLabel(slot);
  const countdown = formatCountdown(slot, now);

  return (
    <div className={wrapperClass}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* Card 1: Next publish slot */}
        <Card className="p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Next publish
          </p>
          <p className="text-sm font-semibold mt-1">
            {slotLabel.replace(/^Next:\s*/, '')}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{countdown}</p>
        </Card>

        {/* Card 2: Pending count */}
        <Card className="p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Pending
          </p>
          <p className="text-2xl font-bold mt-1">{pendingCount}</p>
          <p className="text-xs text-muted-foreground">awaiting review</p>
        </Card>

        {/* Card 2b: Lessons to pick (Plan 37-04) */}
        <Card className="p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Lessons to pick
          </p>
          <p className="text-2xl font-bold mt-1 text-purple-600 dark:text-purple-400">
            {lessonsToPick}
          </p>
          <p className="text-xs text-muted-foreground">needs your choice</p>
        </Card>

        {/* Card 2c: Variants to finalize (Plan 37-04) */}
        <Card className="p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Variants to finalize
          </p>
          <p className="text-2xl font-bold mt-1 text-indigo-600 dark:text-indigo-400">
            {variantsToFinalize}
          </p>
          <p className="text-xs text-muted-foreground">needs your choice</p>
        </Card>

        {/* Card 3: Approved count */}
        <Card className="p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Approved
          </p>
          <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
            {approvedCount}
          </p>
          <p className="text-xs text-muted-foreground">awaiting next slot</p>
        </Card>

        {/* Card 4: Last published preview */}
        <Card className="p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Last published
          </p>
          {lastPublished ? (
            <LastPublishedMini post={lastPublished} now={now} />
          ) : (
            <p className="text-sm text-muted-foreground mt-1 italic">
              No posts published yet
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function LastPublishedMini({ post, now }: { post: LinkedInPost; now: Date }) {
  const href = post.share_urn
    ? `https://www.linkedin.com/feed/update/${post.share_urn}/`
    : null;
  const snippet =
    post.content.slice(0, 60) + (post.content.length > 60 ? '…' : '');
  const published = post.published_at
    ? formatPublishedRelative(post.published_at, now)
    : '';

  const content = (
    <>
      <p className="text-sm mt-1 line-clamp-2 leading-snug">{snippet}</p>
      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
        {published}
        {href && <ExternalLink className="size-3" />}
      </p>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:opacity-80 transition-opacity"
      >
        {content}
      </a>
    );
  }
  return <div>{content}</div>;
}

function formatPublishedRelative(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return '';
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return `Published ${days}d ago`;
  if (hours >= 1) return `Published ${hours}h ago`;
  return 'Published just now';
}
