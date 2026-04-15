/**
 * useLinkedInConfirmPii — POST /api/linkedin/posts/:id/confirm-pii helper.
 *
 * Mirrors `useLinkedInPostActions`'s callAction pattern for the single
 * confirm-pii endpoint. Returns a typed promise that resolves with the
 * updated post or rejects with a `PostActionError`.
 *
 * Auth: JWT bearer token from localStorage, 401 -> /login (same as
 * useLinkedInPostActions).
 *
 * Used by:
 *   - LinkedInQueueRoute handleConfirmPii (PII-gate clearance flow)
 *
 * Plan: 36-04
 */
import { useCallback } from 'react';
import { DashboardPostSchema, type DashboardPost } from '@/api/linkedinSchemas';
import type { PostActionError } from './useLinkedInPostActions';

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

export interface UseLinkedInConfirmPiiResult {
  /**
   * POST /api/linkedin/posts/:id/confirm-pii with optional reviewer note.
   * Resolves with the updated post on 2xx; rejects with `PostActionError`.
   */
  confirmPii: (postId: string, note?: string) => Promise<DashboardPost>;
}

export function useLinkedInConfirmPii(): UseLinkedInConfirmPiiResult {
  const confirmPii = useCallback(
    async (postId: string, note?: string): Promise<DashboardPost> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
      };

      let res: Response;
      try {
        res = await fetch(
          `/api/linkedin/posts/${encodeURIComponent(postId)}/confirm-pii`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(note !== undefined ? { note } : {}),
          },
        );
      } catch (netErr) {
        const err: PostActionError = {
          kind: 'network',
          status: 0,
          code: 'NETWORK',
          message: netErr instanceof Error ? netErr.message : 'network error',
        };
        throw err;
      }

      // Mirror apiFetch: a 401 clears the JWT and redirects to /login.
      if (res.status === 401) {
        localStorage.removeItem('jwt');
        window.location.href = '/login';
        const err: PostActionError = {
          kind: 'unknown',
          status: 401,
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        };
        throw err;
      }

      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON response — handled below */
      }

      if (res.ok) {
        const parsed = DashboardPostSchema.safeParse(json);
        if (!parsed.success) {
          const err: PostActionError = {
            kind: 'internal_error',
            status: res.status,
            code: 'INTERNAL_ERROR',
            message: 'upstream returned unexpected shape',
          };
          throw err;
        }
        return parsed.data;
      }

      // Non-2xx: map the error envelope to PostActionError
      const envelope =
        json &&
        typeof json === 'object' &&
        'error' in json &&
        typeof (json as { error: unknown }).error === 'object'
          ? (json as {
              error: {
                code?: string;
                message?: string;
                details?: Record<string, unknown>;
              };
            }).error
          : null;
      const code = envelope?.code || 'UNKNOWN';
      const message = envelope?.message || `HTTP ${res.status}`;

      let err: PostActionError;
      switch (code) {
        case 'STATE_VIOLATION':
          err = {
            kind: 'state_violation',
            status: res.status,
            code: 'STATE_VIOLATION',
            message,
          };
          break;
        case 'UPSTREAM_FAILURE':
          err = {
            kind: 'upstream_failure',
            status: res.status,
            code: 'UPSTREAM_FAILURE',
            message,
          };
          break;
        case 'VALIDATION_ERROR':
          err = {
            kind: 'validation_error',
            status: res.status,
            code: 'VALIDATION_ERROR',
            message,
          };
          break;
        case 'INTERNAL_ERROR':
          err = {
            kind: 'internal_error',
            status: res.status,
            code: 'INTERNAL_ERROR',
            message,
          };
          break;
        default:
          err = { kind: 'unknown', status: res.status, code, message };
      }
      throw err;
    },
    [],
  );

  return { confirmPii };
}
