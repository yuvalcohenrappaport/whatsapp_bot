/**
 * Mutation hook for POST /api/linkedin/lesson-runs/generate.
 * Returns {startRun, loading} where startRun returns a discriminated result:
 *   - {kind: 'started', jobId: string}
 *   - {kind: 'busy', retryAfterMs: number} -- 409 generator busy
 *   - {kind: 'not_found', message: string} -- 404 unknown project
 *   - {kind: 'error', message: string} -- other errors
 */
import { useCallback, useState } from 'react';

interface StartLessonRunParams {
  project_name: string;
  perspective: string;
  language: string;
  topic_hint?: string | null;
}

export type StartLessonRunResult =
  | { kind: 'started'; jobId: string }
  | { kind: 'busy'; retryAfterMs: number }
  | { kind: 'not_found'; message: string }
  | { kind: 'error'; message: string };

export function useLinkedInStartLessonRun() {
  const [loading, setLoading] = useState(false);

  const startRun = useCallback(async (params: StartLessonRunParams): Promise<StartLessonRunResult> => {
    setLoading(true);
    try {
      const token = localStorage.getItem('jwt') ?? '';
      const res = await fetch('/api/linkedin/lesson-runs/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });

      if (res.status === 202) {
        const data = await res.json();
        return { kind: 'started', jobId: data.job_id };
      }

      const body = await res.json().catch(() => ({}));
      const errorMessage = body?.error?.message ?? `HTTP ${res.status}`;

      if (res.status === 409) {
        // Generator busy -- CONTEXT Area 3: inline error + 60s retry countdown
        return { kind: 'busy', retryAfterMs: 60_000 };
      }
      if (res.status === 404) {
        return { kind: 'not_found', message: errorMessage };
      }
      if (res.status === 401) {
        localStorage.removeItem('jwt');
        window.location.href = '/login';
      }
      return { kind: 'error', message: errorMessage };
    } catch (err) {
      return { kind: 'error', message: err instanceof Error ? err.message : 'Network error' };
    } finally {
      setLoading(false);
    }
  }, []);

  return { startRun, loading };
}
