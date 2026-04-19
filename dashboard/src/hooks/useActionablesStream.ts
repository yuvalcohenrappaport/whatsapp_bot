/**
 * SSE hook for /api/actionables/stream.
 *
 * Mirrors the shape and failure-mode handling of `useLinkedInQueueStream.ts`
 * (Phase 35) for consistency:
 *   - EventSource with `?token=<jwt>` query-string auth (browsers can't set
 *     Authorization headers on EventSource).
 *   - Single event type `actionables.updated` carrying
 *     `{pending: Actionable[], recent: Actionable[]}`.
 *   - Zod `safeParse` on every frame. On JSON-parse failure or schema drift,
 *     log the issues and fall back to 5s polling against
 *     `/api/actionables/pending` + `/api/actionables/recent` (both
 *     `{actionables: Actionable[]}` envelopes) — last-known-good stays
 *     visible on drift, the UI does NOT crash.
 *   - `onopen` → 'open'; `onerror` → 'reconnecting' (the browser
 *     auto-reconnects; we just surface the state for the banner).
 *   - Cleanup closes the socket + clears the fallback interval.
 *
 * NO React Query — same house-pattern reason as the linkedin hook: plain
 * useState + useEffect is sufficient and consistent with every other SSE
 * hook in the dashboard.
 */
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiFetch, sseUrl } from '@/api/client';
import {
  ActionableSchema,
  ActionablesUpdatedPayloadSchema,
  type Actionable,
} from '@/api/actionablesSchemas';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'error';

// REST polling-fallback response shape: `{actionables: Actionable[]}`.
const ActionablesListEnvelopeSchema = z.object({
  actionables: z.array(ActionableSchema),
});

export function useActionablesStream(): {
  pending: Actionable[] | null;
  recent: Actionable[] | null;
  status: StreamStatus;
} {
  const [pending, setPending] = useState<Actionable[] | null>(null);
  const [recent, setRecent] = useState<Actionable[] | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = sseUrl('/api/actionables/stream');
    const es = new EventSource(url);

    const fastPoll = async () => {
      if (cancelled) return;
      try {
        const [rawPending, rawRecent] = await Promise.all([
          apiFetch<unknown>('/api/actionables/pending'),
          apiFetch<unknown>('/api/actionables/recent'),
        ]);
        const pendingResult = ActionablesListEnvelopeSchema.safeParse(rawPending);
        const recentResult = ActionablesListEnvelopeSchema.safeParse(rawRecent);
        if (!pendingResult.success) {
          console.error(
            '[useActionablesStream] fallback poll /pending schema drift:',
            pendingResult.error.issues,
          );
        } else if (!cancelled) {
          setPending(pendingResult.data.actionables);
        }
        if (!recentResult.success) {
          console.error(
            '[useActionablesStream] fallback poll /recent schema drift:',
            recentResult.error.issues,
          );
        } else if (!cancelled) {
          setRecent(recentResult.data.actionables);
        }
      } catch {
        // Network error — leave last-known-good; next tick retries.
      }
    };

    const switchToPolling = () => {
      if (fallbackRef.current !== null) return;
      void fastPoll();
      fallbackRef.current = setInterval(() => void fastPoll(), 5_000);
    };

    es.addEventListener('actionables.updated', (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse((event as MessageEvent).data);
      } catch (err) {
        console.error(
          '[useActionablesStream] JSON parse failure on actionables.updated; falling back to polling',
          err,
        );
        switchToPolling();
        return;
      }
      const result = ActionablesUpdatedPayloadSchema.safeParse(raw);
      if (!result.success) {
        console.error(
          '[useActionablesStream] schema drift on actionables.updated; falling back to polling',
          result.error.issues,
        );
        switchToPolling();
        return;
      }
      if (!cancelled) {
        setPending(result.data.pending);
        setRecent(result.data.recent);
      }
    });

    es.onopen = () => {
      if (!cancelled) setStatus('open');
    };
    es.onerror = () => {
      // Browser EventSource auto-reconnects; surface the state for the banner.
      if (!cancelled) setStatus('reconnecting');
    };

    return () => {
      cancelled = true;
      es.close();
      if (fallbackRef.current !== null) {
        clearInterval(fallbackRef.current);
        fallbackRef.current = null;
      }
    };
  }, []);

  return { pending, recent, status };
}
