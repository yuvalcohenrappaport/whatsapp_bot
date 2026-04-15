/**
 * useLinkedInPostActions — approve / reject / edit mutation helpers.
 *
 * CONTEXT §1 error taxonomy is enforced at the discriminated-union level:
 * every error path is typed so the caller can route errors to the right
 * toast copy via `actionErrorToToastText`.
 *
 * Auth: the dashboard uses JWT bearer tokens from localStorage (see
 * `src/api/client.ts`). We do NOT use cookie-credentials — we attach the
 * `Authorization: Bearer <jwt>` header on every call. A 401 clears the
 * token and redirects to `/login`, mirroring `apiFetch`'s behavior.
 *
 * Used by:
 *   - LinkedInPostActions buttons (Approve / Reject)
 *   - EditPostDialog (Save)
 *   - LinkedInQueueRoute (optimistic patch orchestration)
 *
 * Plan: 36-02
 */
import { useCallback } from 'react';
import { DashboardPostSchema, type DashboardPost } from '@/api/linkedinSchemas';

/** Discriminated error the caller routes to toast copy per CONTEXT §1. */
export type PostActionError =
  | {
      kind: 'state_violation';
      status: number;
      code: 'STATE_VIOLATION';
      message: string;
      currentStatus?: string;
    }
  | {
      kind: 'upstream_failure';
      status: number;
      code: 'UPSTREAM_FAILURE';
      message: string;
    }
  | {
      kind: 'internal_error';
      status: number;
      code: 'INTERNAL_ERROR';
      message: string;
    }
  | {
      kind: 'validation_error';
      status: number;
      code: 'VALIDATION_ERROR';
      message: string;
    }
  | { kind: 'network'; status: 0; code: 'NETWORK'; message: string }
  | { kind: 'unknown'; status: number; code: string; message: string };

export interface EditPostBody {
  content: string;
  content_he: string | null;
}

export interface UseLinkedInPostActionsResult {
  approvePost: (postId: string) => Promise<DashboardPost>;
  rejectPost: (postId: string) => Promise<DashboardPost>;
  editPost: (postId: string, body: EditPostBody) => Promise<DashboardPost>;
}

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

async function callAction(
  postId: string,
  action: 'approve' | 'reject' | 'edit',
  body: unknown = undefined,
): Promise<DashboardPost> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(
      `/api/linkedin/posts/${encodeURIComponent(postId)}/${action}`,
      {
        method: 'POST',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
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
    /* non-JSON response: handled below */
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
  const currentStatus =
    envelope?.details && typeof envelope.details.current_status === 'string'
      ? (envelope.details.current_status as string)
      : undefined;

  let err: PostActionError;
  switch (code) {
    case 'STATE_VIOLATION':
      err = {
        kind: 'state_violation',
        status: res.status,
        code: 'STATE_VIOLATION',
        message,
        currentStatus,
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
}

export function useLinkedInPostActions(): UseLinkedInPostActionsResult {
  const approvePost = useCallback(
    (postId: string) => callAction(postId, 'approve'),
    [],
  );
  const rejectPost = useCallback(
    (postId: string) => callAction(postId, 'reject'),
    [],
  );
  const editPost = useCallback(
    (postId: string, body: EditPostBody) => callAction(postId, 'edit', body),
    [],
  );
  return { approvePost, rejectPost, editPost };
}

/**
 * Router for toast copy per CONTEXT §1. Exported for reuse across Plan 36-03
 * (regenerate) and Plan 36-04 (image drop + PII gate).
 */
export function actionErrorToToastText(
  err: PostActionError,
  action: 'approve' | 'reject' | 'edit' | 'regenerate' | 'upload' | 'confirm-pii',
): string {
  switch (err.kind) {
    case 'state_violation':
      if (action === 'approve') {
        const suffix = err.currentStatus ? ` (${err.currentStatus})` : '';
        return `This post can't be approved from its current state${suffix}. Refresh and try again.`;
      }
      if (action === 'reject') {
        return 'This post is already in a terminal state.';
      }
      return err.message || 'Invalid state transition.';
    case 'upstream_failure':
      return 'pm-authority is unreachable. Retry?';
    case 'internal_error':
      return 'Something went wrong. Please refresh and try again.';
    case 'validation_error':
      return err.message || 'Validation failed.';
    case 'network':
      return 'Network error. Retry?';
    default:
      return err.message || 'Action failed.';
  }
}
