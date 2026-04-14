/**
 * SSE hook for /api/linkedin/queue/stream.
 *
 * Pattern mirrors useConnectionStatus.ts but with a richer state machine
 * and Zod validation on every event payload (per CONTEXT §4:
 * "Client useLinkedInQueueStream hook with Zod validation per event").
 *
 * On any Zod safeParse failure — missing id, type drift on analytics, drift
 * on variants/lesson_candidates array shape, etc. — the hook logs the
 * line-numbered issue list and falls back to polling /api/linkedin/posts
 * every 5s. It does NOT crash the page and does NOT silently swallow the
 * bad data.
 *
 * NO React Query (CONTEXT §4). Plain useState + SSE + optional fallback poll.
 */
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiFetch, sseUrl } from '@/api/client';
import {
  DashboardPostSchema,
  QueueUpdatedPayloadSchema,
  type DashboardPost,
} from '@/api/linkedinSchemas';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'error';

// Schema for the polling-fallback response shape (bare array of posts,
// not wrapped in `{posts: ...}` like the SSE event payload is).
const PostsArraySchema = z.array(DashboardPostSchema);

export function useLinkedInQueueStream(): {
  posts: DashboardPost[] | null;
  status: StreamStatus;
} {
  const [posts, setPosts] = useState<DashboardPost[] | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = sseUrl('/api/linkedin/queue/stream');
    const es = new EventSource(url);

    const fastPoll = async () => {
      if (cancelled) return;
      try {
        const raw = await apiFetch<unknown>('/api/linkedin/posts');
        const result = PostsArraySchema.safeParse(raw);
        if (!result.success) {
          console.error(
            '[useLinkedInQueueStream] fallback poll schema drift:',
            result.error.issues,
          );
          // Leave last-known-good state; next tick will retry.
          return;
        }
        if (!cancelled) setPosts(result.data);
      } catch {
        // Network error — leave last-known-good state; health hook drives the banner.
      }
    };

    const switchToPolling = () => {
      if (fallbackRef.current !== null) return;
      void fastPoll();
      fallbackRef.current = setInterval(() => void fastPoll(), 5_000);
    };

    es.addEventListener('queue.updated', (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse((event as MessageEvent).data);
      } catch (err) {
        console.error(
          '[useLinkedInQueueStream] JSON parse failure on queue.updated; falling back to polling',
          err,
        );
        switchToPolling();
        return;
      }
      const result = QueueUpdatedPayloadSchema.safeParse(raw);
      if (!result.success) {
        // Schema drift — log the line-numbered Zod issues and fall back to polling.
        console.error(
          '[useLinkedInQueueStream] schema drift on queue.updated; falling back to polling',
          result.error.issues,
        );
        switchToPolling();
        return;
      }
      if (!cancelled) setPosts(result.data.posts);
    });

    es.onopen = () => {
      if (!cancelled) setStatus('open');
    };
    es.onerror = () => {
      // Browser EventSource auto-reconnects; we just surface the state.
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

  return { posts, status };
}
