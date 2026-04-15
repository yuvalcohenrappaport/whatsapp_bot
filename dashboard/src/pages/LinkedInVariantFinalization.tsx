/**
 * /linkedin/queue/posts/:id/variant — variant finalization page.
 *
 * Renders 2 full-post variants side-by-side (2 cols on md+, stacked on
 * mobile), handles focus-then-confirm pattern, POSTs pick-variant with
 * mixed 200/202 response handling, and observes the fal.ai image state
 * via useLinkedInQueueStream (no polling, no client-side timeout).
 *
 * Terminal-state timing: after the focused variant's image URL appears
 * (or post.status transitions out of PENDING_VARIANT) the page calls
 * ackSlow() on the hook, then delays navigation back to /linkedin/queue
 * by exactly 1500ms so the owner can visually confirm the image rendered
 * on the focused card. Without this delay the image would flash for <1
 * frame before the router navigates away, making SC#3 ("image renders
 * inline on the variant card") visually unobservable.
 *
 * Plan: 37-03.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/api/client';
import { DashboardPostSchema, type DashboardPost } from '@/api/linkedinSchemas';
import { VariantCard } from '@/components/linkedin/VariantCard';
import type { VariantImageMode } from '@/components/linkedin/VariantImageSlot';
import { StickyConfirmBar } from '@/components/linkedin/StickyConfirmBar';
import {
  useLinkedInPickVariant,
  type PickVariantState,
} from '@/hooks/useLinkedInPickVariant';
import { useLinkedInQueueStream } from '@/hooks/useLinkedInQueueStream';

export default function LinkedInVariantFinalization() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<DashboardPost | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [focusedVariantId, setFocusedVariantId] = useState<number | null>(null);
  const { state, pickVariant, ackSlow } = useLinkedInPickVariant();
  const { posts: streamPosts } = useLinkedInQueueStream();

  // One-shot initial fetch
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await apiFetch<unknown>(
          `/api/linkedin/posts/${encodeURIComponent(id)}`,
        );
        if (cancelled) return;
        const parsed = DashboardPostSchema.safeParse(raw);
        if (!parsed.success) {
          setFetchError('schema drift — please report');
          return;
        }
        setPost(parsed.data);
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'fetch failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // SSE-driven post updates (piggyback on queue stream — CONTEXT §Discretion lean).
  // If the post leaves the non-terminal queue (e.g., transitions to PUBLISHED),
  // keep the last-known-good local state so the in-progress flow doesn't flicker.
  useEffect(() => {
    if (!id || !streamPosts) return;
    const updated = streamPosts.find((p) => p.id === id);
    if (updated) setPost(updated);
  }, [id, streamPosts]);

  // Fast path: 200 PostDTO came back inline. Toast + delay nav by 1500ms so
  // the success state is visible before the router jumps away.
  useEffect(() => {
    if (state.kind !== 'succeeded_fast') return;
    toast.success('Variant finalized');
    const t = setTimeout(() => navigate('/linkedin/queue'), 1500);
    return () => clearTimeout(t);
  }, [state.kind, navigate]);

  // Slow path step 1: while waiting for SSE, watch post.image.url and
  // post.status. As soon as EITHER transitions (image URL populated, or
  // status moved out of PENDING_VARIANT), flip the hook via ackSlow() so
  // the page can own the 1500ms visual-confirmation delay.
  useEffect(() => {
    if (state.kind !== 'waiting_for_sse') return;
    if (!post) return;
    const imageReady = !!post.image?.url;
    const statusAdvanced = post.status !== 'PENDING_VARIANT';
    if (imageReady || statusAdvanced) {
      ackSlow();
    }
  }, [state.kind, post?.image?.url, post?.status, ackSlow, post]);

  // Slow path step 2: after ackSlow() flipped us to succeeded_slow, delay
  // navigation by exactly 1500ms so the image is visible on the focused
  // variant card for ~1.5s before the router navigates back to the queue.
  // This is the single setTimeout that owns the terminal visual delay.
  useEffect(() => {
    if (state.kind !== 'succeeded_slow') return;
    toast.success('Variant finalized — image ready');
    const t = setTimeout(() => navigate('/linkedin/queue'), 1500);
    return () => clearTimeout(t);
  }, [state.kind, navigate]);

  // ─── Loading / error states ───
  if (fetchError) {
    return (
      <div className="p-6">
        <Link
          to="/linkedin/queue"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="size-4" /> Back to queue
        </Link>
        <Card className="p-6 border-red-200 bg-red-50 dark:bg-red-950/20">
          <AlertCircle className="inline size-5 text-red-600 mr-2" />
          <span className="font-medium">Failed to load post:</span> {fetchError}
        </Card>
      </div>
    );
  }
  if (!post) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (post.status !== 'PENDING_VARIANT') {
    return (
      <div className="p-6">
        <Link
          to="/linkedin/queue"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="size-4" /> Back to queue
        </Link>
        <Card className="p-6 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <p className="font-medium">
            This post is no longer waiting for variant finalization.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Current status: <span className="font-mono">{post.status}</span>
          </p>
        </Card>
      </div>
    );
  }

  if (post.variants.length < 2) {
    return (
      <div className="p-6">
        <Link
          to="/linkedin/queue"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="size-4" /> Back to queue
        </Link>
        <Card className="p-6 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <p className="font-medium">Not enough variants on this post.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Expected 2, found {post.variants.length}.
          </p>
        </Card>
      </div>
    );
  }

  // ─── Main render ───
  const onConfirm = () => {
    if (focusedVariantId !== null && id) {
      void pickVariant(id, focusedVariantId);
    }
  };

  // Inline helper — local to this file to avoid cross-file coupling.
  const modeFor = (variantId: number): VariantImageMode => {
    const isFocused = variantId === focusedVariantId;
    const hasImage = !!post.image?.url;
    if (hasImage && isFocused) return 'ready';
    if (hasImage && !isFocused) return 'idle';
    // No image yet:
    if (
      (state.kind === 'waiting_for_sse' || state.kind === 'submitting') &&
      isFocused
    ) {
      return 'pending';
    }
    if (state.kind === 'failed' && isFocused) return 'error';
    return 'idle';
  };

  const errorBanner = renderErrorBanner(state);

  const helperText =
    state.kind === 'waiting_for_sse'
      ? 'fal.ai image is generating… (SSE-driven, no timeout)'
      : state.kind === 'submitting'
        ? 'Submitting…'
        : state.kind === 'succeeded_fast' || state.kind === 'succeeded_slow'
          ? 'Variant finalized — returning to queue…'
          : focusedVariantId === null
            ? 'Click a variant card above to select'
            : 'Ready to finalize';

  return (
    <div className="p-4 md:p-6 pb-24 space-y-6">
      <div>
        <Link
          to="/linkedin/queue"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to queue
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Finalize a variant</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick one of the 2 full-post variants. Your choice becomes the final
          post. If the variant has an image prompt, fal.ai will generate an
          image after you finalize.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <MetaItem label="Project" value={post.project_name} />
          <MetaItem label="Perspective" value={post.perspective} />
          <MetaItem label="Language" value={post.language} />
          <MetaItem
            label="Generated"
            value={new Date(post.created_at).toLocaleString()}
          />
        </div>
        {post.source_snippet && (
          <details className="mt-4">
            <summary className="text-xs uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground">
              Source snippet ({post.source_snippet.length} chars)
            </summary>
            <div className="mt-2 text-xs p-3 rounded bg-slate-50 dark:bg-slate-900/50 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {post.source_snippet}
            </div>
          </details>
        )}
      </Card>

      {errorBanner}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {post.variants.slice(0, 2).map((variant) => (
          <VariantCard
            key={variant.id}
            variant={variant}
            post={post}
            focused={focusedVariantId === variant.id}
            onFocus={() => setFocusedVariantId(variant.id)}
            imageMode={modeFor(variant.id)}
          />
        ))}
      </div>

      <StickyConfirmBar
        label="Finalize this variant"
        disabled={
          focusedVariantId === null ||
          state.kind === 'submitting' ||
          state.kind === 'waiting_for_sse' ||
          state.kind === 'succeeded_fast' ||
          state.kind === 'succeeded_slow'
        }
        onConfirm={onConfirm}
        helper={helperText}
      />
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-medium truncate">{value}</p>
    </div>
  );
}

function renderErrorBanner(state: PickVariantState) {
  if (
    state.kind !== 'failed' &&
    state.kind !== 'already_picked' &&
    state.kind !== 'validation_error' &&
    state.kind !== 'network'
  ) {
    return null;
  }
  return (
    <Card className="p-4 border-red-200 bg-red-50 dark:bg-red-950/20">
      <div className="flex items-start gap-3">
        <AlertCircle className="size-5 text-red-600 mt-0.5" />
        <div>
          <p className="font-medium text-red-900 dark:text-red-100">
            {state.kind === 'already_picked'
              ? 'Variant already picked'
              : state.kind === 'validation_error'
                ? 'Invalid request'
                : state.kind === 'network'
                  ? 'Network error'
                  : 'Variant finalization failed'}
          </p>
          <p className="text-sm text-red-700 dark:text-red-300 mt-1">
            {state.message}
          </p>
        </div>
      </div>
    </Card>
  );
}
