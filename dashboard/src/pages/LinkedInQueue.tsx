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
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
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
import { LinkedInPostActions } from '@/components/linkedin/LinkedInPostActions';
import { EditPostDialog } from '@/components/linkedin/EditPostDialog';
import {
  useLinkedInPostActions,
  actionErrorToToastText,
  type PostActionError,
} from '@/hooks/useLinkedInPostActions';
import { useLinkedInQueueStream } from '@/hooks/useLinkedInQueueStream';
import { useLinkedInPublishedHistory } from '@/hooks/useLinkedInPublishedHistory';
import { useLinkedInHealth } from '@/hooks/useLinkedInHealth';
import { useLinkedInRegenerate } from '@/hooks/useLinkedInRegenerate';

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
  /** Plan 36-02: render the action row for a queue card. Not used for published. */
  renderPostActions?: (post: LinkedInPost) => ReactNode;
  /**
   * Plan 36-03: per-post regeneration predicate. When true, QueueCard
   * applies `ring-2 ring-blue-400 animate-pulse` + Loader2 spinner overlay
   * (both pre-wired in Plan 36-01 Task 6).
   */
  isPostRegenerating?: (post: LinkedInPost) => boolean;
  /**
   * Plan 36-03: per-post 400ms emerald flash predicate (CONTEXT §3).
   * Cleared by the parent via setTimeout after the success transition.
   */
  isPostJustRegenerated?: (post: LinkedInPost) => boolean;
}

function QueueFeed({
  posts,
  loading,
  renderPostActions,
  isPostRegenerating,
  isPostJustRegenerated,
}: {
  posts: LinkedInPost[] | null;
  loading: boolean;
  renderPostActions?: (post: LinkedInPost) => ReactNode;
  isPostRegenerating?: (post: LinkedInPost) => boolean;
  isPostJustRegenerated?: (post: LinkedInPost) => boolean;
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
        <LinkedInPostCard
          key={post.id}
          post={post}
          variant="queue"
          actionsSlot={renderPostActions?.(post)}
          isRegenerating={isPostRegenerating?.(post) ?? false}
          justRegenerated={isPostJustRegenerated?.(post) ?? false}
        />
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
  renderPostActions,
  isPostRegenerating,
  isPostJustRegenerated,
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
          <QueueFeed
            posts={queue}
            loading={queue === null && !degraded}
            renderPostActions={renderPostActions}
            isPostRegenerating={isPostRegenerating}
            isPostJustRegenerated={isPostJustRegenerated}
          />
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
 * Real-data wrapper for LinkedInQueuePage. Wires:
 *   - useLinkedInQueueStream → live non-terminal posts via SSE
 *   - useLinkedInPublishedHistory → one-shot PUBLISHED list (refreshed
 *     whenever the SSE delivers a new post count)
 *   - useLinkedInHealth → polls /api/linkedin/health every 30s for the
 *     degraded banner branch
 *
 * When health reports `upstream !== 'ok'`, we pass a `degraded` prop to
 * LinkedInQueuePage which renders the warning banner in place of the
 * 4 status mini-cards.
 *
 * Type note: the hooks return `DashboardPost[]` (Zod-inferred from
 * `linkedinSchemas.ts`), while `LinkedInQueuePage` expects the richer
 * `LinkedInPost[]` type defined in `@/components/linkedin/postStatus.ts`.
 * The runtime shape is guaranteed structurally compatible by the passthrough
 * schema — the extra fields (perspective, language, regeneration_*, etc.)
 * are passed through untouched from pm-authority. A single `as unknown as`
 * cast at the call-site boundary is the cleanest reconciliation since the
 * Zod schema already enforces the runtime contract.
 */
export default function LinkedInQueueRoute() {
  const { posts: queue, status: streamStatus } = useLinkedInQueueStream();
  const { posts: published, refresh: refreshPublished } =
    useLinkedInPublishedHistory();
  const { health, refresh: refreshHealth } = useLinkedInHealth();
  const { approvePost, rejectPost } = useLinkedInPostActions();

  // Optimistic-patch map: post.id -> partial post state overriding the SSE
  // value. The SSE stream will eventually deliver the real state; until then
  // the patch dominates. On error we roll back by clearing the patch.
  const [patches, setPatches] = useState<
    Record<string, Partial<LinkedInPost>>
  >({});

  // Edit modal state
  const [editPostTarget, setEditPostTarget] = useState<LinkedInPost | null>(
    null,
  );
  const [editOpen, setEditOpen] = useState(false);

  // Plan 36-03: 400ms emerald flash map driven by the regen success handler.
  // CONTEXT §3 lock: NO success toast — the card itself flashes via
  // bg-emerald-50 + transition-colors (pre-wired in Plan 36-01 Task 6).
  const [justRegenerated, setJustRegenerated] = useState<
    Record<string, boolean>
  >({});

  const flashRegenSuccess = (postId: string) => {
    setJustRegenerated((prev) => ({ ...prev, [postId]: true }));
    window.setTimeout(() => {
      setJustRegenerated((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    }, 400);
  };

  // Project the SSE queue through the patch map. Posts optimistically
  // marked REJECTED fall out of the visible queue (REJECTED is terminal).
  const patchedQueue = useMemo<LinkedInPost[] | null>(() => {
    if (queue === null) return null;
    return (queue as unknown as LinkedInPost[])
      .map((p) => {
        const patch = patches[p.id];
        if (!patch) return p;
        return { ...p, ...patch } as LinkedInPost;
      })
      .filter((p) => p.status !== 'REJECTED');
  }, [queue, patches]);

  // Whenever a new queue state arrives (e.g. a post transitioned to
  // PUBLISHED), re-fetch the published history so the Recent tab stays
  // fresh without its own SSE.
  useEffect(() => {
    if (queue === null) return;
    void refreshPublished();
  }, [queue, refreshPublished]);

  const degraded =
    health?.upstream === 'unavailable'
      ? {
          reason: health.reason,
          onRetry: () => void refreshHealth(),
        }
      : null;

  function applyPatch(postId: string, patch: Partial<LinkedInPost>) {
    setPatches((prev) => ({
      ...prev,
      [postId]: { ...prev[postId], ...patch },
    }));
  }

  function clearPatch(postId: string) {
    setPatches((prev) => {
      const next = { ...prev };
      delete next[postId];
      return next;
    });
  }

  async function handleApprove(post: LinkedInPost) {
    applyPatch(post.id, { status: 'APPROVED' });
    try {
      await approvePost(post.id);
      toast.success('Approved');
      // Keep the optimistic patch until SSE refreshes the post with the
      // real state. CONTEXT §1: "local wins until the POST response resolves".
    } catch (err) {
      clearPatch(post.id);
      toast.error(actionErrorToToastText(err as PostActionError, 'approve'));
    }
  }

  async function handleReject(post: LinkedInPost) {
    applyPatch(post.id, { status: 'REJECTED' });
    try {
      await rejectPost(post.id);
      toast.success('Rejected');
    } catch (err) {
      clearPatch(post.id);
      toast.error(actionErrorToToastText(err as PostActionError, 'reject'));
    }
  }

  function handleEdit(post: LinkedInPost) {
    setEditPostTarget(post);
    setEditOpen(true);
  }

  function handleEditSaved(updated: {
    id: string;
    content: string;
    content_he: string | null;
  }) {
    applyPatch(updated.id, {
      content: updated.content,
      content_he: updated.content_he,
    });
    toast.success('Edit saved');
  }

  // Plan 36-03: Regenerate orchestration. Single-active-job semantics
  // mirror pm-authority's semaphore(1). All three callbacks below are
  // CONTEXT §3 locks:
  //  - onSucceeded → NO toast, instead emerald flash via flashRegenSuccess
  //  - onFailed → toast.error with Retry action
  //  - onCapped → toast.error "Regeneration cap reached for this post (5/5)"
  const { start: startRegen, isRegenerating: getRegenStatus } =
    useLinkedInRegenerate({
      onSucceeded: (postId, updated) => {
        // Updated may be null on shape-drift fallback; SSE will catch up.
        if (updated) {
          applyPatch(postId, {
            content: updated.content,
            content_he: updated.content_he,
            status: updated.status,
            regeneration_count: updated.regeneration_count,
            regeneration_capped: updated.regeneration_capped,
          });
        }
        // CONTEXT §3 lock: NO success toast — the card itself flashes.
        flashRegenSuccess(postId);
      },
      onFailed: (postId, errorMessage) => {
        // Clear any patches that may have leaked into the regen window.
        clearPatch(postId);
        toast.error(`Regeneration failed: ${errorMessage}`, {
          action: {
            label: 'Retry',
            onClick: () => {
              void handleRegenerate({ id: postId } as LinkedInPost);
            },
          },
        });
      },
      onCapped: (_postId) => {
        toast.error('Regeneration cap reached for this post (5/5)');
      },
    });

  async function handleRegenerate(post: LinkedInPost) {
    const result = await startRegen(post.id);
    if (result.kind === 'error') {
      toast.error(`Could not start regeneration: ${result.message}`);
    }
    // 'capped' already toasted via onCapped
    // 'started' → hook's internal poll handles the rest via callbacks
  }

  const renderPostActions = (post: LinkedInPost) => (
    <LinkedInPostActions
      post={post}
      isRegenerating={getRegenStatus(post.id)}
      onApprove={() => void handleApprove(post)}
      onReject={() => void handleReject(post)}
      onEdit={() => handleEdit(post)}
      onRegenerate={() => void handleRegenerate(post)}
    />
  );

  return (
    <>
      <LinkedInQueuePage
        queue={patchedQueue}
        published={published as unknown as LinkedInPost[] | null}
        streamStatus={streamStatus}
        degraded={degraded}
        renderPostActions={renderPostActions}
        isPostRegenerating={(p) => getRegenStatus(p.id)}
        isPostJustRegenerated={(p) => justRegenerated[p.id] === true}
      />
      <EditPostDialog
        post={editPostTarget}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={handleEditSaved}
      />
    </>
  );
}
