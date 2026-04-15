/**
 * /linkedin/queue/posts/:id/lesson — lesson selection page.
 *
 * Plan 37-02 Task 3. Fleshes out the Plan 37-01 stub:
 *   - Fetches the post on mount via /api/linkedin/posts/:id and guards
 *     against non-PENDING_LESSON_SELECTION status (Research Fact #6).
 *   - Renders a header row with project name, perspective, language,
 *     generation timestamp, and a collapsible source snippet.
 *   - Stacks 4 LessonCandidateCard components vertically with letter tags
 *     A/B/C/D (CONTEXT §Area 1: letter tags are labels only, peers).
 *   - StickyConfirmBar at the viewport bottom commits the focused pick
 *     via useLinkedInPickLesson; disabled until a candidate is focused.
 *   - LessonGenerationModal locks the page during the variant-generation
 *     job; on success auto-navigates to /linkedin/queue/posts/:id/variant.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/api/client';
import {
  DashboardPostSchema,
  type DashboardPost,
} from '@/api/linkedinSchemas';
import { LessonCandidateCard } from '@/components/linkedin/LessonCandidateCard';
import { LessonGenerationModal } from '@/components/linkedin/LessonGenerationModal';
import { StickyConfirmBar } from '@/components/linkedin/StickyConfirmBar';
import { useLinkedInPickLesson } from '@/hooks/useLinkedInPickLesson';

const LETTERS = ['A', 'B', 'C', 'D'] as const;
type Letter = (typeof LETTERS)[number];

export default function LinkedInLessonSelection() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [post, setPost] = useState<DashboardPost | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);

  const { state, pickLesson, reset } = useLinkedInPickLesson();

  // ── Fetch the post on mount ─────────────────────────────────────────
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
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : 'fetch failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // ── Auto-navigate on success ────────────────────────────────────────
  useEffect(() => {
    if (state.kind === 'succeeded' && id) {
      navigate(`/linkedin/queue/posts/${encodeURIComponent(id)}/variant`);
    }
  }, [state.kind, id, navigate]);

  // ── Error state ─────────────────────────────────────────────────────
  if (fetchError) {
    return (
      <div className="p-6">
        <BackLink />
        <Card className="p-6 mt-4 border-red-200 bg-red-50 dark:bg-red-950/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-900 dark:text-red-100">
                Failed to load post
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                {fetchError}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ── Loading state ───────────────────────────────────────────────────
  if (!post) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  // ── Status guard (Research Fact #6) ─────────────────────────────────
  if (post.status !== 'PENDING_LESSON_SELECTION') {
    return (
      <div className="p-6">
        <BackLink />
        <Card className="p-6 mt-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <p className="font-medium">
            This post is no longer waiting for lesson selection.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Current status: <span className="font-mono">{post.status}</span>
          </p>
        </Card>
      </div>
    );
  }

  // ── Missing candidates guard ────────────────────────────────────────
  if (post.lesson_candidates.length === 0) {
    return (
      <div className="p-6">
        <BackLink />
        <Card className="p-6 mt-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <p className="font-medium">
            No lesson candidates found for this post.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            This is unexpected — pm-authority should always populate 4
            candidates before transitioning a post to
            PENDING_LESSON_SELECTION.
          </p>
        </Card>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────
  const onConfirm = () => {
    if (focusedId !== null && id && state.kind !== 'submitting') {
      void pickLesson(id, focusedId);
    }
  };

  const modalOpen =
    state.kind === 'polling' ||
    state.kind === 'failed' ||
    state.kind === 'already_picked' ||
    state.kind === 'validation_error' ||
    state.kind === 'network';
  const modalStatus: 'running' | 'failed' =
    state.kind === 'polling' ? 'running' : 'failed';
  const modalError =
    state.kind === 'failed' ||
    state.kind === 'already_picked' ||
    state.kind === 'validation_error' ||
    state.kind === 'network'
      ? state.message
      : undefined;

  const focusedIdx = post.lesson_candidates.findIndex(
    (c) => c.id === focusedId,
  );
  const focusedLetter: Letter | null =
    focusedIdx >= 0 && focusedIdx < LETTERS.length
      ? LETTERS[focusedIdx]
      : null;

  return (
    <div className="p-4 md:p-6 pb-24 space-y-6">
      <div>
        <BackLink />
        <h1 className="text-2xl font-semibold mt-2">Pick a lesson</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose one of the {post.lesson_candidates.length} candidate
          lessons generated for this post. The chosen lesson will drive
          variant generation.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <MetaItem label="Project" value={post.project_name} />
          <MetaItem label="Perspective" value={post.perspective} />
          <MetaItem label="Language" value={post.language} />
          <MetaItem
            label="Generated"
            value={formatTimestamp(post.created_at)}
          />
        </div>
        {post.source_snippet && (
          <details className="mt-4">
            <summary className="text-xs uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground">
              Source snippet ({post.source_snippet.length} chars)
            </summary>
            <div className="mt-2 text-xs p-3 rounded bg-slate-50 dark:bg-slate-900/50 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
              {post.source_snippet}
            </div>
          </details>
        )}
      </Card>

      <div className="space-y-3">
        {post.lesson_candidates.map((candidate, idx) => {
          const letter: Letter = LETTERS[idx] ?? 'A';
          return (
            <LessonCandidateCard
              key={candidate.id}
              candidate={candidate}
              letter={letter}
              focused={focusedId === candidate.id}
              onFocus={() => setFocusedId(candidate.id)}
            />
          );
        })}
      </div>

      <StickyConfirmBar
        label={
          state.kind === 'submitting' ? 'Submitting…' : 'Confirm selection'
        }
        disabled={focusedId === null || state.kind === 'submitting'}
        onConfirm={onConfirm}
        helper={
          focusedId === null
            ? 'Click a card above to select a lesson'
            : `Candidate ${focusedLetter ?? '?'} selected`
        }
      />

      <LessonGenerationModal
        open={modalOpen}
        status={modalStatus}
        errorMessage={modalError}
        onBackToQueue={() => {
          reset();
          navigate('/linkedin/queue');
        }}
      />
    </div>
  );
}

// ── Presentational helpers ────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      to="/linkedin/queue"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Back to queue
    </Link>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-medium truncate" title={value}>
        {value}
      </p>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
