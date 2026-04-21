/**
 * Mutation hook for POST /api/linkedin/posts (Phase 48).
 *
 * Returns {createPost, loading} where createPost resolves to a discriminated
 * result so NewPostDialog can route each error to the right UI surface:
 *   - {kind: 'created', post}                   -- 201 (pm-authority) / 200 forwarded
 *   - {kind: 'validation', fieldErrors, message} -- 400 VALIDATION_ERROR (Zod proxy OR Pydantic upstream)
 *   - {kind: 'not_found', message}               -- 404 (e.g. project missing upstream)
 *   - {kind: 'error', message}                   -- anything else
 *
 * On 401 we clear the JWT and redirect /login (mirrors apiFetch conventions).
 *
 * Not using apiFetch because we need to distinguish validation vs upstream
 * vs network errors — the discriminated result keeps that information
 * surfaced to the dialog.
 */
import { useCallback, useState } from 'react';
import type { DashboardPost } from '@/api/linkedinSchemas';

export interface CreatePostParams {
  title: string;
  content: string;
  content_he?: string | null;
  language: 'en' | 'he' | 'he+en';
  project_name: string;
  perspective: 'yuval' | 'claude';
}

export type CreatePostResult =
  | { kind: 'created'; post: DashboardPost }
  | { kind: 'validation'; fieldErrors: Record<string, string>; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'error'; message: string };

export function useLinkedInCreatePost() {
  const [loading, setLoading] = useState(false);

  const createPost = useCallback(
    async (params: CreatePostParams): Promise<CreatePostResult> => {
      setLoading(true);
      try {
        const token = localStorage.getItem('jwt') ?? '';
        const res = await fetch('/api/linkedin/posts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(params),
        });

        if (res.status === 200 || res.status === 201) {
          const post = (await res.json()) as DashboardPost;
          return { kind: 'created', post };
        }

        const body = await res.json().catch(() => ({}));
        const errorCode = body?.error?.code;
        const errorMessage = body?.error?.message ?? `HTTP ${res.status}`;
        const details = body?.error?.details ?? {};

        if (res.status === 401) {
          localStorage.removeItem('jwt');
          window.location.href = '/login';
          return { kind: 'error', message: 'Not authenticated' };
        }
        if (res.status === 400 && errorCode === 'VALIDATION_ERROR') {
          // Zod proxy + Pydantic upstream both arrive with details.issues[].
          // Flatten to a field-keyed map (e.g. {content_he: "Hebrew required"}).
          const fieldErrors: Record<string, string> = {};
          const issues = Array.isArray(details?.issues) ? details.issues : [];
          for (const issue of issues) {
            const path = Array.isArray(issue.path)
              ? issue.path.join('.')
              : String(issue.path ?? '');
            if (path) fieldErrors[path] = issue.message ?? errorMessage;
          }
          return { kind: 'validation', fieldErrors, message: errorMessage };
        }
        if (res.status === 404) {
          return { kind: 'not_found', message: errorMessage };
        }
        return { kind: 'error', message: errorMessage };
      } catch (err) {
        return {
          kind: 'error',
          message: err instanceof Error ? err.message : 'Network error',
        };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { createPost, loading };
}
