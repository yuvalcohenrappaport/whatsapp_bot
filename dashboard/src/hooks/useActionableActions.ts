/**
 * useActionableActions — approve / reject / edit / unreject mutation hook
 * for the /pending-tasks page.
 *
 * Design mirrors `useLinkedInPostActions` (Phase 36) — the CONTEXT-pinned
 * reference — with two adaptations for actionables:
 *
 *   1. Return a discriminated-union **result** instead of throwing. The
 *      caller routes the `reason` tag straight to the right UX branch
 *      (409 `already_handled` → neutral toast + no rollback; everything
 *      else → rollback + error toast). This keeps the page-level handler
 *      free of try/catch juggling and mirrors CONTEXT §Toasts and
 *      feedback where `already_handled` has fundamentally different UX
 *      from a network error.
 *
 *   2. Direct bearer-auth + 401 redirect (same as `apiFetch`) without
 *      wrapping — we need per-status-code branching on the raw Response,
 *      so we call `fetch` directly and parse the body ourselves.
 *
 * Used by:
 *   - `pages/PendingTasks.tsx` — per-row Approve / Reject / Edit handlers
 *   - Reject's Undo-toast onClick also calls `unrejectActionable`
 *
 * Plan: 45-03.
 */
import { useCallback } from 'react';
import {
  ActionableResponseSchema,
  AlreadyHandledErrorSchema,
  GraceExpiredErrorSchema,
  type Actionable,
} from '@/api/actionablesSchemas';

/**
 * Discriminated result of a single write-action call. Every failure
 * mode the server can return (and our own network/parse failures) has a
 * distinct `reason` tag so the page routes straight to the right UX.
 */
export type ActionableActionResult =
  | { ok: true; actionable: Actionable }
  | {
      ok: false;
      reason: 'already_handled';
      currentStatus: 'approved' | 'rejected' | 'fired' | 'expired';
      actionable?: Actionable;
    }
  | { ok: false; reason: 'grace_expired'; graceMs: number; actionable?: Actionable }
  | { ok: false; reason: 'bot_disconnected' }
  | { ok: false; reason: 'validation'; message: string }
  | { ok: false; reason: 'network'; message: string }
  | { ok: false; reason: 'unknown'; status: number; message: string };

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

async function callAction(
  id: string,
  path: 'approve' | 'reject' | 'edit' | 'unreject',
  body?: unknown,
): Promise<ActionableActionResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(
      `/api/actionables/${encodeURIComponent(id)}/${path}`,
      {
        method: 'POST',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
    );
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      message: err instanceof Error ? err.message : 'network error',
    };
  }

  // Match apiFetch: 401 clears the JWT and redirects to /login.
  if (res.status === 401) {
    localStorage.removeItem('jwt');
    window.location.href = '/login';
    return {
      ok: false,
      reason: 'unknown',
      status: 401,
      message: 'Unauthorized',
    };
  }

  // Best-effort body parse — we inspect the envelope for every non-200
  // code so we MUST read the body even on failure.
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* handled below: surfaces as `reason: 'unknown'` with the raw status. */
  }

  if (res.status === 200) {
    const parsed = ActionableResponseSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        reason: 'unknown',
        status: 200,
        message: 'unexpected response shape',
      };
    }
    return { ok: true, actionable: parsed.data.actionable };
  }

  if (res.status === 409) {
    // grace_expired takes precedence over already_handled — it's the
    // tighter match (only emitted by /unreject). safeParse drops
    // already_handled for mismatching literals so either check works.
    const grace = GraceExpiredErrorSchema.safeParse(json);
    if (grace.success) {
      return {
        ok: false,
        reason: 'grace_expired',
        graceMs: grace.data.graceMs,
        actionable: grace.data.actionable,
      };
    }
    const alreadyHandled = AlreadyHandledErrorSchema.safeParse(json);
    if (alreadyHandled.success) {
      return {
        ok: false,
        reason: 'already_handled',
        currentStatus: alreadyHandled.data.currentStatus,
        actionable: alreadyHandled.data.actionable,
      };
    }
    return {
      ok: false,
      reason: 'unknown',
      status: 409,
      message: 'unrecognized 409 envelope',
    };
  }

  if (res.status === 503) {
    return { ok: false, reason: 'bot_disconnected' };
  }

  if (res.status === 400) {
    const msg =
      json &&
      typeof json === 'object' &&
      'error' in json &&
      typeof (json as { error: unknown }).error === 'string'
        ? (json as { error: string }).error
        : 'Invalid input';
    return { ok: false, reason: 'validation', message: msg };
  }

  // 404, 500, anything else.
  return {
    ok: false,
    reason: 'unknown',
    status: res.status,
    message: `HTTP ${res.status}`,
  };
}

export function useActionableActions() {
  const approveActionable = useCallback(
    (id: string) => callAction(id, 'approve'),
    [],
  );
  const rejectActionable = useCallback(
    (id: string) => callAction(id, 'reject'),
    [],
  );
  const editActionable = useCallback(
    (id: string, task: string) => callAction(id, 'edit', { task }),
    [],
  );
  const unrejectActionable = useCallback(
    (id: string) => callAction(id, 'unreject'),
    [],
  );
  return {
    approveActionable,
    rejectActionable,
    editActionable,
    unrejectActionable,
  };
}

/**
 * Shared toast-copy router. The page-level handler passes any non-ok
 * result through this and picks `toast()` vs `toast.error()` based on
 * the reason (neutral for already_handled/grace_expired, error for
 * everything else).
 */
export function actionableErrorToToastText(
  result: Extract<ActionableActionResult, { ok: false }>,
): string {
  switch (result.reason) {
    case 'already_handled':
      return 'Already handled in WhatsApp';
    case 'grace_expired':
      return "Undo window closed — it's already final";
    case 'bot_disconnected':
      return 'Bot is disconnected — try again in a moment';
    case 'validation':
      return result.message;
    case 'network':
      return 'Network error — retry?';
    default:
      return result.message || 'Action failed';
  }
}
