/**
 * useLinkedInJob — generic 1500ms polling hook for /api/linkedin/jobs/:id.
 *
 * NOT regenerate-specific by design — Plan 37's lesson/variant plans can
 * reuse this as-is. Pass null to stop polling. When the job reaches a
 * terminal state (succeeded | failed) polling stops automatically.
 *
 * Auth: like every other dashboard fetch, attaches Authorization: Bearer
 * from localStorage('jwt') to match `apiFetch` / `useLinkedInPostActions`'s
 * pattern. Plan-specified `credentials: 'include'` would NOT work against
 * whatsapp-bot's JWT-gated Fastify middleware.
 *
 * Plan: 36-03 Task 1
 */
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

/**
 * Minimal Zod schema for /api/linkedin/jobs/:id response. Decoupled from
 * the server-side JobSchema (Plan 35-03 decision) — the dashboard owns its
 * own runtime contract here. `.passthrough()` tolerates pm-authority adding
 * fields later without breaking polling.
 */
const JobResponseSchema = z
  .object({
    id: z.string(),
    job_type: z.string(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed']),
    result: z.record(z.string(), z.unknown()).nullable().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).default({}),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

export type JobResponse = z.infer<typeof JobResponseSchema>;

export type UseLinkedInJobResult = {
  /** Latest job payload, or null before the first poll completes. */
  job: JobResponse | null;
  /** True until the first poll fetch returns or a terminal state is reached. */
  loading: boolean;
  /** Final transport/Zod error if the polling itself fails catastrophically. */
  error: string | null;
};

const POLL_INTERVAL_MS = 1500;
/**
 * 2-minute hard cap on polling. CONTEXT §3 suggested 60s for network-error
 * paths, but Claude CLI cold-starts can stretch past 90s — we'd rather err
 * on "don't give up too early" than surface a misleading "unknown" toast.
 */
const POLL_MAX_MS = 120_000;
/** Cap successive failures at ~60s worth of polls (40 * 1.5s). */
const MAX_CONSECUTIVE_FAILURES = 40;

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

/**
 * Polls GET /api/linkedin/jobs/:jobId every 1500ms until the job reaches
 * a terminal state (succeeded | failed) or jobId becomes null.
 *
 * - Pass null to stop polling (e.g. "no active job for this post").
 * - When terminal is reached, polling stops and the final `job` value
 *   stays in state until the caller clears it by passing null.
 * - On network or schema errors, we log + continue polling up to POLL_MAX_MS.
 *   After that we expose `error` and stop.
 * - First poll fires immediately (no 1500ms cold gap).
 */
export function useLinkedInJob(jobId: string | null): UseLinkedInJobResult {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const consecutiveFailuresRef = useRef(0);

  useEffect(() => {
    if (jobId === null) {
      setJob(null);
      setLoading(false);
      setError(null);
      startedAtRef.current = null;
      consecutiveFailuresRef.current = 0;
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setJob(null);
    startedAtRef.current = Date.now();
    consecutiveFailuresRef.current = 0;

    async function pollOnce(): Promise<'terminal' | 'continue'> {
      try {
        const res = await fetch(
          `/api/linkedin/jobs/${encodeURIComponent(jobId!)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${getToken()}`,
            },
          },
        );
        if (res.status === 401) {
          // Mirror apiFetch / useLinkedInPostActions auth handling.
          localStorage.removeItem('jwt');
          window.location.href = '/login';
          return 'terminal';
        }
        if (!res.ok) {
          throw new Error(`http ${res.status}`);
        }
        const rawJson = await res.json();
        const parsed = JobResponseSchema.safeParse(rawJson);
        if (!parsed.success) {
          throw new Error('schema mismatch');
        }
        if (cancelled) return 'terminal';
        consecutiveFailuresRef.current = 0;
        setJob(parsed.data);
        setLoading(false);
        if (
          parsed.data.status === 'succeeded' ||
          parsed.data.status === 'failed'
        ) {
          return 'terminal';
        }
      } catch (e) {
        consecutiveFailuresRef.current += 1;
        const elapsed = Date.now() - (startedAtRef.current ?? Date.now());
        if (
          elapsed > POLL_MAX_MS ||
          consecutiveFailuresRef.current > MAX_CONSECUTIVE_FAILURES
        ) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : 'job polling failed');
            setLoading(false);
          }
          return 'terminal';
        }
      }
      return 'continue';
    }

    // Poll immediately, then on interval
    void (async () => {
      const first = await pollOnce();
      if (first === 'terminal' || cancelled) return;
      intervalRef.current = window.setInterval(async () => {
        if (cancelled) {
          if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return;
        }
        const result = await pollOnce();
        if (result === 'terminal' && intervalRef.current !== null) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }, POLL_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [jobId]);

  return { job, loading, error };
}

export { POLL_INTERVAL_MS };
