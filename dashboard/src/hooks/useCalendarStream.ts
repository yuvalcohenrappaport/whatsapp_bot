/**
 * SSE hook for /api/calendar/stream + per-source parallel initial-load.
 *
 * Topology (CONTEXT §5 — no waiting for slowest):
 *   Phase 1 — on mount, fire independent fetch calls to per-source
 *   routes from Plan 44-03 + Plan 47-01. Each source flips to 'ok'/'error' independently
 *   as soon as its own fetch resolves. No source waits for another.
 *
 *   Phase 2 — once any single source resolves, open the unified SSE
 *   /api/calendar/stream. On every calendar.updated frame, safeParse with
 *   CalendarEnvelopeSchema, then split the envelope back into per-source
 *   slices (filter by .source). Per-source slices are replaced atomically.
 *
 *   Polling fallback (10s): polls /api/calendar/items on schema drift.
 *   Mirrors the actionables hook pattern.
 *
 * State shape:
 *   tasks:    { items: CalendarItem[], status: 'loading'|'ok'|'error' }
 *   events:   { items: CalendarItem[], status: 'loading'|'ok'|'error' }
 *   linkedin: { items: CalendarItem[], status: 'loading'|'ok'|'error' }
 *   gcal:     { items: CalendarItem[], status: 'loading'|'ok'|'error' }   // Phase 47 Plan 03
 *   sseStatus: 'idle'|'connecting'|'open'|'reconnecting'|'error'
 *
 * Per-source refetch functions exposed for the Retry buttons in Calendar.tsx.
 *
 * Plan 44-04 (base); Phase 47 Plan 03 added the gcal slice — gtasks is
 * intentionally NOT surfaced as a separate slice because Phase 46 has not
 * shipped yet and gtasks is optional in the envelope.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiFetch, sseUrl } from '@/api/client';
import {
  CalendarItemSchema,
  CalendarEnvelopeSchema,
  type CalendarItem,
} from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

type SourceStatus = 'loading' | 'ok' | 'error';

export interface SourceSlice {
  items: CalendarItem[];
  status: SourceStatus;
}

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error';

export interface UseCalendarStreamResult {
  tasks: SourceSlice;
  events: SourceSlice;
  linkedin: SourceSlice;
  gcal: SourceSlice;
  sseStatus: SseStatus;
  refetch: (source: 'tasks' | 'events' | 'linkedin' | 'gcal') => void;
}

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

const LOADING_SLICE: SourceSlice = { items: [], status: 'loading' };

// Per-source fetch routes from Plan 44-03 + Plan 47-01.
const TASKS_URL = '/api/actionables/with-due-dates';
const EVENTS_URL = '/api/personal-calendar/events/window';
const LINKEDIN_URL = '/api/linkedin/posts/scheduled';
// Gcal uses the unified aggregator for the initial load because the per-source
// route (/api/google-calendar/events) requires a from/to window that matches
// the aggregator — simpler to let the aggregator handle dedup + windowing
// and pull the gcal items from the unified envelope on first load.

// Unified polling fallback URL (cheaper than N per-source fetches post-load).
const UNIFIED_URL = '/api/calendar/items';

// Per-source response envelope (wraps CalendarItem[]).
const PerSourceEnvelopeSchema = z.object({
  items: z.array(CalendarItemSchema),
});

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------

export function useCalendarStream(): UseCalendarStreamResult {
  const [tasks, setTasks] = useState<SourceSlice>(LOADING_SLICE);
  const [events, setEvents] = useState<SourceSlice>(LOADING_SLICE);
  const [linkedin, setLinkedin] = useState<SourceSlice>(LOADING_SLICE);
  const [gcal, setGcal] = useState<SourceSlice>(LOADING_SLICE);
  const [sseStatus, setSseStatus] = useState<SseStatus>('idle');

  // Tracks how many sources have resolved (any value > 0 → open SSE).
  const resolvedCountRef = useRef(0);
  // Tracks whether SSE is already open.
  const sseOpenRef = useRef(false);
  // Fallback polling interval ref.
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // EventSource ref for cleanup.
  const esRef = useRef<EventSource | null>(null);
  // Cancelled flag for async effect cleanup.
  const cancelledRef = useRef(false);

  // -----------------------------------------------------------------------
  // SSE opener — called after first source resolves.
  // -----------------------------------------------------------------------
  const openSse = useCallback(() => {
    if (sseOpenRef.current || cancelledRef.current) return;
    sseOpenRef.current = true;
    setSseStatus('connecting');

    const url = sseUrl('/api/calendar/stream');
    const es = new EventSource(url);
    esRef.current = es;

    const startPolling = () => {
      if (fallbackRef.current !== null) return;
      void pollUnified();
      fallbackRef.current = setInterval(() => void pollUnified(), 10_000);
    };

    es.addEventListener('calendar.updated', (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse((event as MessageEvent).data);
      } catch (err) {
        console.error('[useCalendarStream] JSON parse failure on calendar.updated; falling back to polling', err);
        startPolling();
        return;
      }
      const result = CalendarEnvelopeSchema.safeParse(raw);
      if (!result.success) {
        console.error('[useCalendarStream] schema drift on calendar.updated; falling back to polling', result.error.issues);
        startPolling();
        return;
      }
      if (cancelledRef.current) return;
      // Split unified envelope back into per-source slices.
      const { items, sources } = result.data;
      const taskItems = items.filter((i) => i.source === 'task');
      const eventItems = items.filter((i) => i.source === 'event');
      const linkedinItems = items.filter((i) => i.source === 'linkedin');
      const gcalItems = items.filter((i) => i.source === 'gcal');
      setTasks({ items: taskItems, status: sources.tasks });
      setEvents({ items: eventItems, status: sources.events });
      setLinkedin({ items: linkedinItems, status: sources.linkedin });
      setGcal({ items: gcalItems, status: sources.gcal });
    });

    es.onopen = () => {
      if (!cancelledRef.current) setSseStatus('open');
    };

    es.onerror = () => {
      // Browser EventSource auto-reconnects; surface state for the banner.
      if (!cancelledRef.current) setSseStatus('reconnecting');
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Unified polling fallback (schema drift safety).
  // -----------------------------------------------------------------------
  const pollUnified = async () => {
    if (cancelledRef.current) return;
    try {
      const json = await apiFetch<unknown>(UNIFIED_URL);
      const result = CalendarEnvelopeSchema.safeParse(json);
      if (!result.success) {
        console.error('[useCalendarStream] unified poll schema drift:', result.error.issues);
        return;
      }
      if (cancelledRef.current) return;
      const { items, sources } = result.data;
      setTasks({ items: items.filter((i) => i.source === 'task'), status: sources.tasks });
      setEvents({ items: items.filter((i) => i.source === 'event'), status: sources.events });
      setLinkedin({ items: items.filter((i) => i.source === 'linkedin'), status: sources.linkedin });
      setGcal({ items: items.filter((i) => i.source === 'gcal'), status: sources.gcal });
    } catch {
      // Network error — leave last-known-good; next tick retries.
    }
  };

  // -----------------------------------------------------------------------
  // Per-source fetch helpers.
  // -----------------------------------------------------------------------
  const fetchTasks = useCallback(() => {
    let cancelled = false;
    apiFetch<unknown>(TASKS_URL)
      .then((json) => {
        if (cancelled || cancelledRef.current) return;
        const parsed = PerSourceEnvelopeSchema.safeParse(json);
        setTasks(parsed.success ? { items: parsed.data.items, status: 'ok' } : { items: [], status: 'error' });
        if (parsed.success) {
          resolvedCountRef.current += 1;
          if (resolvedCountRef.current === 1) openSse();
        }
      })
      .catch(() => {
        if (!cancelled && !cancelledRef.current) setTasks({ items: [], status: 'error' });
      });
    return () => { cancelled = true; };
  }, [openSse]);

  const fetchEvents = useCallback(() => {
    let cancelled = false;
    apiFetch<unknown>(EVENTS_URL)
      .then((json) => {
        if (cancelled || cancelledRef.current) return;
        const parsed = PerSourceEnvelopeSchema.safeParse(json);
        setEvents(parsed.success ? { items: parsed.data.items, status: 'ok' } : { items: [], status: 'error' });
        if (parsed.success) {
          resolvedCountRef.current += 1;
          if (resolvedCountRef.current === 1) openSse();
        }
      })
      .catch(() => {
        if (!cancelled && !cancelledRef.current) setEvents({ items: [], status: 'error' });
      });
    return () => { cancelled = true; };
  }, [openSse]);

  const fetchLinkedin = useCallback(() => {
    let cancelled = false;
    apiFetch<unknown>(LINKEDIN_URL)
      .then((json) => {
        if (cancelled || cancelledRef.current) return;
        const parsed = PerSourceEnvelopeSchema.safeParse(json);
        setLinkedin(parsed.success ? { items: parsed.data.items, status: 'ok' } : { items: [], status: 'error' });
        if (parsed.success) {
          resolvedCountRef.current += 1;
          if (resolvedCountRef.current === 1) openSse();
        }
      })
      .catch(() => {
        if (!cancelled && !cancelledRef.current) setLinkedin({ items: [], status: 'error' });
      });
    return () => { cancelled = true; };
  }, [openSse]);

  // Gcal initial load — pulls from the unified aggregator and filters to gcal
  // items. The aggregator handles dedup + windowing so the dashboard doesn't
  // have to know about calendar-event ↔ personal_pending_events linkage.
  const fetchGcal = useCallback(() => {
    let cancelled = false;
    apiFetch<unknown>(UNIFIED_URL)
      .then((json) => {
        if (cancelled || cancelledRef.current) return;
        const parsed = CalendarEnvelopeSchema.safeParse(json);
        if (!parsed.success) {
          setGcal({ items: [], status: 'error' });
          return;
        }
        const gcalItems = parsed.data.items.filter((i) => i.source === 'gcal');
        setGcal({ items: gcalItems, status: parsed.data.sources.gcal });
        resolvedCountRef.current += 1;
        if (resolvedCountRef.current === 1) openSse();
      })
      .catch(() => {
        if (!cancelled && !cancelledRef.current) setGcal({ items: [], status: 'error' });
      });
    return () => { cancelled = true; };
  }, [openSse]);

  // -----------------------------------------------------------------------
  // Phase 1: parallel initial load on mount.
  // -----------------------------------------------------------------------
  useEffect(() => {
    cancelledRef.current = false;
    resolvedCountRef.current = 0;
    sseOpenRef.current = false;

    // Fire independent fetches — each resolves on its own timeline.
    fetchTasks();
    fetchEvents();
    fetchLinkedin();
    fetchGcal();

    return () => {
      cancelledRef.current = true;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (fallbackRef.current !== null) {
        clearInterval(fallbackRef.current);
        fallbackRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Public refetch for Retry buttons.
  // -----------------------------------------------------------------------
  const refetch = useCallback(
    (source: 'tasks' | 'events' | 'linkedin' | 'gcal') => {
      // Reset the source to loading state before refetching.
      if (source === 'tasks') {
        setTasks(LOADING_SLICE);
        fetchTasks();
      } else if (source === 'events') {
        setEvents(LOADING_SLICE);
        fetchEvents();
      } else if (source === 'linkedin') {
        setLinkedin(LOADING_SLICE);
        fetchLinkedin();
      } else {
        setGcal(LOADING_SLICE);
        fetchGcal();
      }
    },
    [fetchTasks, fetchEvents, fetchLinkedin, fetchGcal],
  );

  return { tasks, events, linkedin, gcal, sseStatus, refetch };
}
