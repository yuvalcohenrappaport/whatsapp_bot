/**
 * useLinkedInPickVariant — pick-variant mutation with mixed 200/202 handling.
 *
 * Flow:
 *   1. Caller: pickVariant(postId, variantId)
 *   2. POST /api/linkedin/posts/:id/pick-variant with {variant_id}
 *   3. 200 PostDTO → state 'succeeded_fast' with the returned post
 *      → page shows toast + navigates back to queue
 *   4. 202 JobAccepted → state 'waiting_for_sse' (ignore body.job_id entirely)
 *      → page observes post.image.url via useLinkedInQueueStream; when the
 *        URL flips null → populated (or post.status leaves PENDING_VARIANT),
 *        the page flips the hook state to 'succeeded_slow' via the ackSlow()
 *        callback returned by this hook.
 *   5. Error envelopes (409 VARIANT_ALREADY_PICKED, 400 VALIDATION_ERROR,
 *      network) → discriminated state kinds
 *
 * CRITICAL DESIGN: This hook deliberately does NOT import or use the generic
 * linkedin job-polling hook. That hook enforces a hard client-side timeout
 * (POLL_MAX_MS = 120_000ms) which would violate CONTEXT §Area 3 Scenario B
 * ("no client-side timeout; trust backend/SSE to surface completion or
 * failure"). pick-variant's slow path runs fal.ai inside the job worker;
 * fal.ai can exceed 120s. The SSE stream already re-emits the post when
 * image.url or status changes, so the page-level queue stream is the natural
 * observation point — no polling, no cap.
 *
 * Plan: 37-03
 */
import { useCallback, useState } from 'react';
import { DashboardPostSchema, type DashboardPost } from '@/api/linkedinSchemas';

export type PickVariantState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'succeeded_fast'; post: DashboardPost }
  | { kind: 'waiting_for_sse' } // 202 received; waiting for SSE to reveal image or status change
  | { kind: 'succeeded_slow' } // flipped by the page via ackSlow() once SSE delivers the terminal state
  | { kind: 'failed'; message: string }
  | { kind: 'already_picked'; message: string }
  | { kind: 'validation_error'; message: string }
  | { kind: 'network'; message: string };

export interface UseLinkedInPickVariantResult {
  state: PickVariantState;
  pickVariant: (postId: string, variantId: number) => Promise<void>;
  /** Called by the page when SSE reveals the post's terminal state for the slow path. */
  ackSlow: () => void;
  reset: () => void;
}

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

export function useLinkedInPickVariant(): UseLinkedInPickVariantResult {
  const [state, setState] = useState<PickVariantState>({ kind: 'idle' });

  const pickVariant = useCallback(async (postId: string, variantId: number) => {
    setState({ kind: 'submitting' });
    try {
      const res = await fetch(
        `/api/linkedin/posts/${encodeURIComponent(postId)}/pick-variant`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ variant_id: variantId }),
        },
      );
      if (res.status === 200) {
        const raw = await res.json();
        const parsed = DashboardPostSchema.safeParse(raw);
        if (parsed.success) {
          setState({ kind: 'succeeded_fast', post: parsed.data });
        } else {
          // 200 schema drift — log and degrade to waiting_for_sse so the page
          // can still observe a terminal state via SSE.
          console.error(
            '[useLinkedInPickVariant] 200 schema drift:',
            parsed.error.issues,
          );
          setState({ kind: 'waiting_for_sse' });
        }
        return;
      }
      if (res.status === 202) {
        // Ignore job_id. We do NOT poll — SSE is the sole observer for the slow path.
        setState({ kind: 'waiting_for_sse' });
        return;
      }
      // Error path
      let envelope: { error?: { code?: string; message?: string } } = {};
      try {
        envelope = await res.json();
      } catch {
        /* non-JSON */
      }
      const code = envelope.error?.code ?? 'UNKNOWN';
      const message = envelope.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 409 || code === 'VARIANT_ALREADY_PICKED') {
        setState({ kind: 'already_picked', message });
      } else if (res.status === 400 || code === 'VALIDATION_ERROR') {
        setState({ kind: 'validation_error', message });
      } else {
        setState({ kind: 'failed', message });
      }
    } catch (err) {
      setState({
        kind: 'network',
        message: err instanceof Error ? err.message : 'network error',
      });
    }
  }, []);

  const ackSlow = useCallback(() => {
    setState((prev) =>
      prev.kind === 'waiting_for_sse' ? { kind: 'succeeded_slow' } : prev,
    );
  }, []);

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, pickVariant, ackSlow, reset };
}
