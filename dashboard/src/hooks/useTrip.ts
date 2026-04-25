/**
 * useTrip — single-trip data layer for the trip dashboard.
 *
 * Topology:
 *   1. Initial fetch on mount: GET /api/trips/:groupJid → TripBundleSchema.safeParse
 *   2. SSE subscription: open EventSource to /api/trips/:groupJid/stream
 *      on successful initial load. Listen for `trip.updated` events.
 *   3. Three optimistic mutations (deleteDecision, resolveQuestion, updateBudget)
 *      — snapshot → optimistic state update → API call → on success toast +
 *      canonical state (budget only); on failure revert + error toast.
 *   4. Polling fallback: on schema drift in SSE frame, switch to 10s polling
 *      against /api/trips/:groupJid and stop SSE.
 *   5. Cleanup: effect cleanup closes EventSource + clears polling interval.
 *
 * Read-only enforcement: the hook does NOT block mutations on readOnly trips
 * (that's the UI's job — hide/disable buttons on readOnly). The backend returns
 * 403, the optimistic update reverts, and the toast says "Read-only trip".
 *
 * Toast config (CONTEXT lock):
 *   - Success: subtle, 2 s auto-dismiss, bottom-right (sonner)
 *   - Error: red, 5 s, bottom-right (sonner)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, sseUrl } from '@/api/client';
import {
  TripBundleSchema,
  type TripBundle,
  type TripCategory,
} from '@/api/tripSchemas';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error';

export interface UseTripResult {
  bundle: TripBundle | null;
  isLoading: boolean;
  error: string | null;
  sseStatus: SseStatus;
  mutations: {
    deleteDecision: (id: string) => Promise<void>;
    restoreDecision: (id: string) => Promise<void>;
    resolveQuestion: (id: string) => Promise<void>;
    updateBudget: (patch: Partial<Record<TripCategory, number>>) => Promise<void>;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000;

const TOAST_OPTS = { position: 'bottom-right' as const, duration: 2000 };
const TOAST_ERROR_OPTS = { position: 'bottom-right' as const, duration: 5000 };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTrip(groupJid: string | undefined): UseTripResult {
  const [bundle, setBundle] = useState<TripBundle | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [sseStatus, setSseStatus] = useState<SseStatus>('idle');

  // Refs for effect cleanup + cancellation.
  const cancelledRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sseOpenRef = useRef(false);

  // ─── Polling fallback (schema drift safety) ──────────────────────────────
  const pollBundle = useCallback(async () => {
    if (cancelledRef.current || !groupJid) return;
    try {
      const json = await apiFetch<unknown>(`/api/trips/${groupJid}`);
      const result = TripBundleSchema.safeParse(json);
      if (!result.success) {
        console.error('[useTrip] polling schema drift:', result.error.issues);
        return;
      }
      if (!cancelledRef.current) setBundle(result.data);
    } catch {
      // Network error — leave last-known-good; next tick retries.
    }
  }, [groupJid]);

  // ─── Start polling fallback, stop SSE ───────────────────────────────────
  const startPollingFallback = useCallback(() => {
    // Close SSE — schema drift means the SSE frames won't parse anyway.
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (pollRef.current !== null) return;
    void pollBundle();
    pollRef.current = setInterval(() => void pollBundle(), POLL_INTERVAL_MS);
  }, [pollBundle]);

  // ─── SSE opener — called after initial fetch succeeds ───────────────────
  const openSse = useCallback(() => {
    if (sseOpenRef.current || cancelledRef.current || !groupJid) return;
    sseOpenRef.current = true;
    setSseStatus('connecting');

    const url = sseUrl(`/api/trips/${groupJid}/stream`);
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('trip.updated', (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse((event as MessageEvent).data);
      } catch (err) {
        console.error('[useTrip] JSON parse failure on trip.updated; falling back to polling', err);
        startPollingFallback();
        return;
      }
      const result = TripBundleSchema.safeParse(raw);
      if (!result.success) {
        console.error('[useTrip] schema drift on trip.updated; falling back to polling', result.error.issues);
        startPollingFallback();
        return;
      }
      if (!cancelledRef.current) setBundle(result.data);
    });

    es.onopen = () => {
      if (!cancelledRef.current) setSseStatus('open');
    };

    es.onerror = () => {
      // Browser EventSource auto-reconnects; surface state for the indicator.
      if (!cancelledRef.current) setSseStatus('reconnecting');
    };
  }, [groupJid, startPollingFallback]);

  // ─── Initial fetch on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!groupJid) return;

    cancelledRef.current = false;
    sseOpenRef.current = false;
    setIsLoading(true);
    setError(null);
    setBundle(null);
    setSseStatus('idle');

    apiFetch<unknown>(`/api/trips/${groupJid}`)
      .then((json) => {
        if (cancelledRef.current) return;
        const result = TripBundleSchema.safeParse(json);
        if (result.success) {
          setBundle(result.data);
          setIsLoading(false);
          // Open SSE after bundle is set.
          openSse();
        } else {
          console.error('[useTrip] initial fetch schema drift:', result.error.issues);
          setError('Unexpected response shape from server');
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || msg.includes('Trip not found')) {
          setBundle(null);
          setError('Trip not found');
        } else {
          setError(msg);
        }
        setIsLoading(false);
      });

    return () => {
      cancelledRef.current = true;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [groupJid, openSse]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  // Optimistically mark a decision as deleted. Reverts on API failure.
  const deleteDecision = useCallback(
    async (id: string): Promise<void> => {
      if (!groupJid || !bundle) return;
      const snapshot = bundle;

      // Optimistic update: mark decision status='deleted'.
      setBundle({
        ...bundle,
        decisions: bundle.decisions.map((d) =>
          d.id === id ? { ...d, status: 'deleted' as const } : d,
        ),
        // Remove from open questions too if it was there.
        openQuestions: bundle.openQuestions.filter((q) => q.id !== id),
      });

      try {
        await apiFetch(`/api/trips/${groupJid}/decisions/${id}`, {
          method: 'DELETE',
        });
        toast.success('Deleted', TOAST_OPTS);
      } catch (err: unknown) {
        // Revert on failure.
        setBundle(snapshot);
        const msg = err instanceof Error ? err.message : String(err);
        const displayMsg = msg.includes('403')
          ? 'Read-only trip — cannot edit'
          : msg;
        toast.error(displayMsg, TOAST_ERROR_OPTS);
      }
    },
    [groupJid, bundle],
  );

  // Optimistically flip a deleted decision back to active. Reverts on failure.
  const restoreDecision = useCallback(
    async (id: string): Promise<void> => {
      if (!groupJid || !bundle) return;
      const snapshot = bundle;

      // Optimistic update: flip status back to 'active'.
      setBundle({
        ...bundle,
        decisions: bundle.decisions.map((d) =>
          d.id === id ? { ...d, status: 'active' as const } : d,
        ),
      });

      try {
        await apiFetch(`/api/trips/${groupJid}/decisions/${id}/restore`, {
          method: 'POST',
        });
        toast.success('Restored', TOAST_OPTS);
      } catch (err: unknown) {
        setBundle(snapshot);
        const msg = err instanceof Error ? err.message : String(err);
        const displayMsg = msg.includes('403')
          ? 'Read-only trip — cannot edit'
          : 'Restore failed';
        toast.error(displayMsg, TOAST_ERROR_OPTS);
      }
    },
    [groupJid, bundle],
  );

  // Optimistically flip resolved=true on an open question. Reverts on failure.
  const resolveQuestion = useCallback(
    async (id: string): Promise<void> => {
      if (!groupJid || !bundle) return;
      const snapshot = bundle;

      // Optimistic update: mark resolved=true in both arrays.
      setBundle({
        ...bundle,
        openQuestions: bundle.openQuestions.map((q) =>
          q.id === id ? { ...q, resolved: true } : q,
        ),
        decisions: bundle.decisions.map((d) =>
          d.id === id ? { ...d, resolved: true } : d,
        ),
      });

      try {
        await apiFetch(`/api/trips/${groupJid}/questions/${id}/resolve`, {
          method: 'PATCH',
        });
        toast.success('Resolved', TOAST_OPTS);
      } catch (err: unknown) {
        setBundle(snapshot);
        const msg = err instanceof Error ? err.message : String(err);
        const displayMsg = msg.includes('403')
          ? 'Read-only trip — cannot edit'
          : msg;
        toast.error(displayMsg, TOAST_ERROR_OPTS);
      }
    },
    [groupJid, bundle],
  );

  // Optimistically merge budget patch, then replace with canonical server state.
  const updateBudget = useCallback(
    async (patch: Partial<Record<TripCategory, number>>): Promise<void> => {
      if (!groupJid || !bundle) return;
      const snapshot = bundle;

      // Optimistic update: merge patch into budget.targets and budgetByCategory.
      const newTargets = { ...bundle.budget.targets, ...patch };
      const newRemaining: Record<string, number> = {};
      for (const cat of Object.keys(newTargets)) {
        newRemaining[cat] =
          (newTargets[cat as TripCategory] ?? 0) -
          (bundle.budget.spent[cat as TripCategory] ?? 0);
      }

      // Also update budgetByCategory JSON string on context if present.
      let newContext = bundle.context;
      if (newContext) {
        let existing: Partial<Record<string, number>> = {};
        try {
          existing = JSON.parse(newContext.budgetByCategory) as Partial<Record<string, number>>;
        } catch { /* ignore */ }
        newContext = {
          ...newContext,
          budgetByCategory: JSON.stringify({ ...existing, ...patch }),
        };
      }

      setBundle({
        ...bundle,
        context: newContext,
        budget: {
          ...bundle.budget,
          targets: newTargets as Record<string, number>,
          remaining: newRemaining,
        },
      });

      try {
        const response = await apiFetch<{ budget: unknown }>(
          `/api/trips/${groupJid}/budget`,
          {
            method: 'PATCH',
            body: JSON.stringify(patch),
          },
        );
        // Replace budget with the canonical server state.
        if (!cancelledRef.current && response?.budget) {
          setBundle((current) =>
            current
              ? { ...current, budget: response.budget as TripBundle['budget'] }
              : current,
          );
        }
        toast.success('Budget updated', TOAST_OPTS);
      } catch (err: unknown) {
        setBundle(snapshot);
        const msg = err instanceof Error ? err.message : String(err);
        const displayMsg = msg.includes('403')
          ? 'Read-only trip — cannot edit'
          : msg;
        toast.error(displayMsg, TOAST_ERROR_OPTS);
      }
    },
    [groupJid, bundle],
  );

  return {
    bundle,
    isLoading,
    error,
    sseStatus,
    mutations: {
      deleteDecision,
      restoreDecision,
      resolveQuestion,
      updateBudget,
    },
  };
}
