/**
 * useLinkedInPickLesson — orchestrate pick-lesson POST + job polling.
 *
 * Flow:
 *   1. Caller calls `pickLesson(postId, candidateId)`.
 *   2. Hook POSTs /api/linkedin/posts/:id/pick-lesson with {candidate_id}.
 *   3. On 202, captures job_id, sets state 'polling'.
 *   4. useLinkedInJob (Plan 36-03) polls until succeeded | failed.
 *   5. State transitions to 'succeeded' or 'failed'; caller reads via hook state.
 *
 * Errors (mapped to discriminated state kinds):
 *   - 409 LESSON_ALREADY_PICKED → 'already_picked'
 *   - 400 VALIDATION_ERROR      → 'validation_error'
 *   - network / unknown         → 'network'
 *   - other HTTP                → 'failed'
 *
 * Mirrors the structural pattern of `useLinkedInRegenerate` (Plan 36-03 Task 2):
 * POST + job polling hook chain + useEffect terminal-state promoter.
 *
 * Plan: 37-02 Task 1
 */
import { useCallback, useEffect, useState } from 'react';
import { useLinkedInJob } from './useLinkedInJob';

export type PickLessonState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'polling'; jobId: string }
  | { kind: 'succeeded' }
  | { kind: 'failed'; message: string }
  | { kind: 'already_picked'; message: string }
  | { kind: 'validation_error'; message: string }
  | { kind: 'network'; message: string };

export interface UseLinkedInPickLessonResult {
  state: PickLessonState;
  pickLesson: (postId: string, candidateId: number) => Promise<void>;
  reset: () => void;
}

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

export function useLinkedInPickLesson(): UseLinkedInPickLessonResult {
  const [state, setState] = useState<PickLessonState>({ kind: 'idle' });

  // Only poll while we're in the 'polling' state. `useLinkedInJob` accepts
  // null to stop polling, so the job hook is quiet during every other phase.
  const jobId = state.kind === 'polling' ? state.jobId : null;
  const { job, error: jobError } = useLinkedInJob(jobId);

  const pickLesson = useCallback(
    async (postId: string, candidateId: number): Promise<void> => {
      setState({ kind: 'submitting' });
      let res: Response;
      try {
        res = await fetch(
          `/api/linkedin/posts/${encodeURIComponent(postId)}/pick-lesson`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${getToken()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ candidate_id: candidateId }),
          },
        );
      } catch (err) {
        setState({
          kind: 'network',
          message: err instanceof Error ? err.message : 'network error',
        });
        return;
      }

      // Mirror apiFetch / useLinkedInPostActions auth handling.
      if (res.status === 401) {
        localStorage.removeItem('jwt');
        window.location.href = '/login';
        return;
      }

      if (res.status === 202) {
        let body: { job_id?: string } = {};
        try {
          body = (await res.json()) as { job_id?: string };
        } catch {
          setState({
            kind: 'failed',
            message: 'upstream returned unexpected accepted-job shape',
          });
          return;
        }
        if (typeof body.job_id !== 'string' || body.job_id.length === 0) {
          setState({
            kind: 'failed',
            message: 'upstream returned unexpected accepted-job shape',
          });
          return;
        }
        setState({ kind: 'polling', jobId: body.job_id });
        return;
      }

      // Error paths — discriminate on status + error envelope code
      let envelope: { error?: { code?: string; message?: string } } = {};
      try {
        envelope = (await res.json()) as {
          error?: { code?: string; message?: string };
        };
      } catch {
        /* body not JSON */
      }
      const code = envelope.error?.code ?? 'UNKNOWN';
      const message = envelope.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 409 || code === 'LESSON_ALREADY_PICKED') {
        setState({ kind: 'already_picked', message });
      } else if (res.status === 400 || code === 'VALIDATION_ERROR') {
        setState({ kind: 'validation_error', message });
      } else {
        setState({ kind: 'failed', message });
      }
    },
    [],
  );

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  // Promote job terminal states into the local state machine. Runs only
  // while we're actively polling to avoid stomping idle/error kinds.
  useEffect(() => {
    if (state.kind !== 'polling') return;
    if (jobError) {
      setState({ kind: 'failed', message: jobError });
      return;
    }
    if (!job) return;
    if (job.status === 'succeeded') {
      setState({ kind: 'succeeded' });
    } else if (job.status === 'failed') {
      const errMsg =
        job.error?.message ?? 'Lesson generation failed';
      setState({ kind: 'failed', message: errMsg });
    }
  }, [job, jobError, state.kind]);

  return { state, pickLesson, reset };
}
