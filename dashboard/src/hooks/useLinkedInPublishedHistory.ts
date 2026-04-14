/**
 * One-shot fetch for the Recent Published tab. N=20 hardcoded per CONTEXT §3.
 *
 * Re-fetch semantics: exposes a `refresh()` callback. Plan 35-04's page
 * wrapper calls refresh() whenever the queue stream emits a change — this
 * is cheap (a single apiFetch against localhost pm-authority through the
 * Fastify proxy) and keeps the published tab in sync when a post transitions
 * to PUBLISHED.
 *
 * Zod validation: uses the same `DashboardPostSchema` as useLinkedInQueueStream
 * (shared source of truth at dashboard/src/api/linkedinSchemas.ts). On a parse
 * failure, logs the Zod issues and leaves last-known-good state.
 */
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '@/api/client';
import {
  DashboardPostSchema,
  type DashboardPost,
} from '@/api/linkedinSchemas';

const PUBLISHED_LIMIT = 20;
const PublishedListSchema = z.array(DashboardPostSchema);

export function useLinkedInPublishedHistory(): {
  posts: DashboardPost[] | null;
  refresh: () => Promise<void>;
} {
  const [posts, setPosts] = useState<DashboardPost[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await apiFetch<unknown>(
        '/api/linkedin/posts?status=PUBLISHED',
      );
      const result = PublishedListSchema.safeParse(raw);
      if (!result.success) {
        console.error(
          '[useLinkedInPublishedHistory] schema drift on /posts?status=PUBLISHED:',
          result.error.issues,
        );
        // Leave last-known-good
        return;
      }
      // Sort newest first, cap to N
      const sorted = [...result.data]
        .filter((p) => p.published_at !== null)
        .sort((a, b) => {
          const at = new Date(a.published_at as string).getTime();
          const bt = new Date(b.published_at as string).getTime();
          return bt - at;
        })
        .slice(0, PUBLISHED_LIMIT);
      setPosts(sorted);
    } catch (err) {
      console.warn('[useLinkedInPublishedHistory] fetch failed', err);
      // Leave last-known-good
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { posts, refresh };
}
