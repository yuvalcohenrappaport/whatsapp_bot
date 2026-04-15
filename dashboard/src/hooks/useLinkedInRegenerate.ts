/**
 * useLinkedInRegenerate — orchestrates POST /regenerate + job polling +
 * terminal-state callbacks for the LinkedIn queue dashboard.
 *
 * Owns:
 *   - The single-active-regen-job state (postId + jobId)
 *   - The start(postId) function that POSTs /regenerate and kicks off polling
 *   - Terminal-state dispatch via useLinkedInJob → onSucceeded / onFailed
 *   - 409 REGEN_CAPPED routing to onCapped (vs other 409s falling through to error)
 *
 * Single-slot semantics match pm-authority's global semaphore(1). The
 * `isRegenerating(postId)` predicate the caller uses against multiple cards
 * is only "true" for the one active post at a time.
 *
 * Auth: Bearer-token from localStorage('jwt') matching the dashboard
 * apiFetch pattern (NOT cookies). 401 clears token + redirects to /login.
 *
 * Plan: 36-03 Task 2
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  DashboardPostSchema,
  type DashboardPost,
} from '@/api/linkedinSchemas';
import { useLinkedInJob } from './useLinkedInJob';

/** 202 response shape from POST /api/linkedin/posts/:id/regenerate. */
const JobAcceptedSchema = z.object({
  job_id: z.string(),
});

export type RegenStartResult =
  | { kind: 'started'; jobId: string }
  | { kind: 'capped'; message: string }
  | { kind: 'error'; message: string };

export interface UseLinkedInRegenerateOptions {
  /**
   * Called when a regeneration job succeeds. `updatedPost` is parsed out of
   * `job.result.post` (Plan 36-01 research Q5: pm-authority's
   * `workers.run_regenerate` ends with `return {"post": dto.model_dump(...)}`).
   *
   * On shape drift (job succeeded but result.post fails Zod parse), this
   * is invoked with `updatedPost = null` — the caller should treat that
   * as "silent success" and rely on SSE to deliver the new post within ~3s.
   */
  onSucceeded: (postId: string, updatedPost: DashboardPost | null) => void;
  /**
   * Called when a regeneration job ends in `status: 'failed'`. The caller
   * should clear any optimistic state and surface a toast.
   */
  onFailed: (postId: string, errorMessage: string) => void;
  /**
   * Called when the POST /regenerate call returns 409 REGEN_CAPPED (the
   * server-side defense against a devtools bypass of the disabled button).
   */
  onCapped: (postId: string) => void;
}

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

/**
 * LinkedInQueueRoute-level hook. Supports ONE active regen job at a time
 * (mirrors pm-authority's single-slot semaphore). The exposed API is
 * keyed by postId so the caller can imagine it's per-post.
 */
export function useLinkedInRegenerate(opts: UseLinkedInRegenerateOptions) {
  const [activeJob, setActiveJob] = useState<{
    postId: string;
    jobId: string;
  } | null>(null);
  const { job } = useLinkedInJob(activeJob?.jobId ?? null);

  // optsRef avoids stale-closure bugs in the terminal dispatcher — the
  // freshest callbacks are always read at terminal-state emission time.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Terminal-state dispatcher
  useEffect(() => {
    if (!job || !activeJob) return;
    if (job.status === 'succeeded') {
      // Plan 36-01 research Q5: pm-authority returns {"post": <PostDTO>} in
      // the job result. Parse it through the same DashboardPostSchema the
      // queue stream uses so types stay consistent downstream.
      const rawResult = job.result as { post?: unknown } | null | undefined;
      const rawPost = rawResult?.post ?? null;
      const parsed = DashboardPostSchema.safeParse(rawPost);
      if (parsed.success) {
        optsRef.current.onSucceeded(activeJob.postId, parsed.data);
      } else {
        // Shape drift: SSE will eventually re-deliver the post.
        optsRef.current.onSucceeded(activeJob.postId, null);
      }
      setActiveJob(null);
    } else if (job.status === 'failed') {
      const message =
        job.error?.message ||
        'Regeneration failed — pm-authority returned an error.';
      optsRef.current.onFailed(activeJob.postId, message);
      setActiveJob(null);
    }
  }, [job, activeJob]);

  const start = useCallback(
    async (postId: string): Promise<RegenStartResult> => {
      // Refuse concurrent regen — backend semaphore would serialize them
      // anyway but the UI state map assumes one at a time.
      if (activeJob !== null) {
        return {
          kind: 'error',
          message: 'another regeneration is already in flight',
        };
      }
      let res: Response;
      try {
        res = await fetch(
          `/api/linkedin/posts/${encodeURIComponent(postId)}/regenerate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${getToken()}`,
            },
          },
        );
      } catch (netErr) {
        return {
          kind: 'error',
          message: netErr instanceof Error ? netErr.message : 'network error',
        };
      }

      // Mirror apiFetch / useLinkedInPostActions auth handling.
      if (res.status === 401) {
        localStorage.removeItem('jwt');
        window.location.href = '/login';
        return { kind: 'error', message: 'Unauthorized' };
      }

      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON */
      }

      if (res.status === 409) {
        const code =
          json && typeof json === 'object' && 'error' in json
            ? (json as { error?: { code?: string } }).error?.code
            : undefined;
        if (code === 'REGEN_CAPPED') {
          optsRef.current.onCapped(postId);
          return {
            kind: 'capped',
            message: 'Regeneration cap reached for this post (5/5)',
          };
        }
        // Other 409s (STATE_VIOLATION) fall through as plain errors
        const envMsg =
          json && typeof json === 'object' && 'error' in json
            ? (json as { error?: { message?: string } }).error?.message
            : null;
        return {
          kind: 'error',
          message: envMsg || 'state violation',
        };
      }
      if (res.status !== 202) {
        return {
          kind: 'error',
          message: `unexpected status ${res.status}`,
        };
      }
      const parsed = JobAcceptedSchema.safeParse(json);
      if (!parsed.success) {
        return {
          kind: 'error',
          message: 'upstream returned unexpected accepted-job shape',
        };
      }
      setActiveJob({ postId, jobId: parsed.data.job_id });
      return { kind: 'started', jobId: parsed.data.job_id };
    },
    [activeJob],
  );

  const isRegenerating = useCallback(
    (postId: string) => activeJob !== null && activeJob.postId === postId,
    [activeJob],
  );

  return { start, isRegenerating, activeJob };
}
