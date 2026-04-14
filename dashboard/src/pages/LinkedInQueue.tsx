/**
 * /linkedin/queue — LinkedIn queue page shell.
 *
 * Plan 35-03 builds this as a layout-only component rendered from local
 * mock data. Plan 35-04 removes the mock block and wires live data via
 * useLinkedInQueueStream + useLinkedInPublishedHistory.
 *
 * Layout (top → bottom):
 *   - sticky status strip (4 mini-cards or degraded banner)
 *   - tab bar: "Queue" (default) | "Recent Published"
 *   - card feed below the active tab (or skeleton/empty state)
 */
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  LinkedInPostCard,
  StatusStrip,
  isApproved,
  isPending,
  type LinkedInPost,
} from '@/components/linkedin';

type TabValue = 'queue' | 'published';

interface LinkedInQueuePageProps {
  /** Non-terminal queue list (or null while loading). Wired by Plan 35-04. */
  queue: LinkedInPost[] | null;
  /** Last-N published posts (or null while loading). Wired by Plan 35-04. */
  published: LinkedInPost[] | null;
  /** SSE connection status for the "Reconnecting…" badge. */
  streamStatus: 'connecting' | 'open' | 'reconnecting' | 'error';
  /** When the proxy health check is unavailable, we render a degraded banner. */
  degraded: { reason: string; onRetry: () => void } | null;
}

function QueueFeed({
  posts,
  loading,
}: {
  posts: LinkedInPost[] | null;
  loading: boolean;
}) {
  if (loading || posts === null) {
    return (
      <div className="space-y-4 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <Card className="mt-4 flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-lg">No posts waiting for review</p>
        <p className="text-sm mt-1">
          Next fresh content will appear here after the next generation run.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-4 mt-4">
      {posts.map((post) => (
        <LinkedInPostCard key={post.id} post={post} variant="queue" />
      ))}
    </div>
  );
}

function PublishedFeed({
  posts,
  loading,
}: {
  posts: LinkedInPost[] | null;
  loading: boolean;
}) {
  if (loading || posts === null) {
    return (
      <div className="space-y-4 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <Card className="mt-4 flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-lg">No posts published yet</p>
        <p className="text-sm mt-1">
          Your first post will appear here after it publishes.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-4 mt-4">
      {posts.map((post) => (
        <LinkedInPostCard key={post.id} post={post} variant="published" />
      ))}
    </div>
  );
}

export function LinkedInQueuePage({
  queue,
  published,
  streamStatus,
  degraded,
}: LinkedInQueuePageProps) {
  const [tab, setTab] = useState<TabValue>('queue');

  // Derived state (CONTEXT §2 — counts come from the queue list itself, not a fetch)
  const pendingCount = useMemo(
    () => (queue ?? []).filter((p) => isPending(p.status)).length,
    [queue],
  );
  const approvedCount = useMemo(
    () => (queue ?? []).filter((p) => isApproved(p.status)).length,
    [queue],
  );
  const lastPublished = useMemo(
    () => ((published ?? []).length > 0 ? (published ?? [])[0] : null),
    [published],
  );

  return (
    <div>
      <StatusStrip
        pendingCount={pendingCount}
        approvedCount={approvedCount}
        lastPublished={lastPublished}
        degraded={degraded ?? undefined}
      />

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1
            className="text-2xl font-semibold mb-1"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            LinkedIn Queue
          </h1>
          <p className="text-sm text-muted-foreground">
            Pending-review posts and recently published history
          </p>
        </div>
        {streamStatus === 'reconnecting' && (
          <span className="text-xs text-amber-600 dark:text-amber-400 animate-pulse">
            Reconnecting…
          </span>
        )}
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabValue)}
        className="mt-4"
      >
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="published">Recent Published</TabsTrigger>
        </TabsList>
        <TabsContent value="queue">
          <QueueFeed posts={queue} loading={queue === null && !degraded} />
        </TabsContent>
        <TabsContent value="published">
          <PublishedFeed
            posts={published}
            loading={published === null && !degraded}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Default export is a dev-only wrapper that feeds mock data to the page —
 * used by Plan 35-03's visual verification. Plan 35-04 REPLACES this
 * default export with a real-data wrapper.
 */
const MOCK_QUEUE: LinkedInPost[] = [
  {
    id: 'mock-1',
    sequence_id: 'mock-seq-1',
    position: 1,
    status: 'PENDING_VARIANT',
    perspective: 'yuval',
    language: 'bilingual',
    content:
      'Here is a long English post preview that should be truncated cleanly by line-clamp-3. ' +
      'Lorem ipsum dolor sit amet consectetur adipiscing elit. Sed do eiusmod tempor incididunt.',
    content_he:
      'זהו טקסט עברית לבדיקת תצוגה דו-כיוונית שמופיע בראש התצוגה, לפני הגרסה האנגלית, ומסתיים עם מפריד.',
    image: { source: 'ai', url: '/v1/posts/mock-1/image', pii_reviewed: true },
    variants: [],
    lesson_candidates: [],
    regeneration_count: 0,
    regeneration_capped: false,
    share_urn: null,
    scheduled_at: null,
    published_at: null,
    created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    updated_at: null,
  },
  {
    id: 'mock-2',
    sequence_id: 'mock-seq-1',
    position: 2,
    status: 'APPROVED',
    perspective: 'yuval',
    language: 'en',
    content: 'An approved English-only post awaiting the next publish slot.',
    content_he: null,
    image: { source: 'screenshot', url: null, pii_reviewed: true },
    variants: [],
    lesson_candidates: [],
    regeneration_count: 0,
    regeneration_capped: false,
    share_urn: null,
    scheduled_at: null,
    published_at: null,
    created_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    updated_at: null,
  },
];

const MOCK_PUBLISHED: LinkedInPost[] = [
  {
    id: 'mock-pub-1',
    sequence_id: 'mock-seq-0',
    position: 1,
    status: 'PUBLISHED',
    perspective: 'yuval',
    language: 'en',
    content: 'A published post with full metrics available from post_analytics.',
    content_he: null,
    image: { source: 'ai', url: '/v1/posts/mock-pub-1/image', pii_reviewed: true },
    variants: [],
    lesson_candidates: [],
    regeneration_count: 0,
    regeneration_capped: false,
    share_urn: 'urn:li:share:7325786486870552578',
    scheduled_at: null,
    published_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    updated_at: null,
    analytics: {
      impressions: 1243,
      reactions: 87,
      comments: 12,
      reshares: 3,
      members_reached: 980,
    },
  },
  {
    id: 'mock-pub-2',
    sequence_id: 'mock-seq-0',
    position: 2,
    status: 'PUBLISHED',
    perspective: 'yuval',
    language: 'en',
    content: 'A recently published post where analytics are not yet available.',
    content_he: null,
    image: { source: 'ai', url: null, pii_reviewed: true },
    variants: [],
    lesson_candidates: [],
    regeneration_count: 0,
    regeneration_capped: false,
    share_urn: 'urn:li:share:7325786486870552579',
    scheduled_at: null,
    published_at: new Date(Date.now() - 10 * 3_600_000).toISOString(),
    created_at: new Date(Date.now() - 12 * 3_600_000).toISOString(),
    updated_at: null,
    analytics: null,
  },
];

export default function LinkedInQueueMockPage() {
  return (
    <LinkedInQueuePage
      queue={MOCK_QUEUE}
      published={MOCK_PUBLISHED}
      streamStatus="open"
      degraded={null}
    />
  );
}
