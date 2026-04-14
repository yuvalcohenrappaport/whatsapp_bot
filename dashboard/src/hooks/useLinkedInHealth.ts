/**
 * Health poll hook — hits /api/linkedin/health every 30s and exposes
 * {upstream, reason}. Used by the page wrapper to render the degraded
 * banner in the StatusStrip when upstream is unavailable.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/api/client';

export interface ProxyHealthOk {
  upstream: 'ok';
  detail: { status: string; version: string; db_ready: boolean };
}

export interface ProxyHealthUnavailable {
  upstream: 'unavailable';
  reason:
    | 'connection_refused'
    | 'timeout'
    | 'upstream_5xx'
    | 'schema_mismatch'
    | 'unknown';
}

export type ProxyHealth = ProxyHealthOk | ProxyHealthUnavailable;

const POLL_INTERVAL_MS = 30_000;

export function useLinkedInHealth(): {
  health: ProxyHealth | null;
  refresh: () => Promise<void>;
} {
  const [health, setHealth] = useState<ProxyHealth | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<ProxyHealth>('/api/linkedin/health');
      setHealth(data);
    } catch (err) {
      console.warn('[useLinkedInHealth] fetch failed', err);
      // /api/linkedin/health should always return 200 per Phase 34 SC#4.
      // A fetch rejection here means the whatsapp-bot itself is unreachable
      // (network failure, 401, etc.) — treat as unknown degraded.
      setHealth({ upstream: 'unavailable', reason: 'unknown' });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { health, refresh };
}
