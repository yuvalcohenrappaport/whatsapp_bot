import { useState, useEffect } from 'react';
import { sseUrl } from '@/api/client';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | 'qr_pending';

interface ConnectionState {
  status: ConnectionStatus;
  qr: string | null;
}

export function useConnectionStatus(): ConnectionState {
  const [state, setState] = useState<ConnectionState>({
    status: 'disconnected',
    qr: null,
  });

  useEffect(() => {
    const url = sseUrl('/api/status/stream');
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { connection: ConnectionStatus; qr: string | null };
        setState({ status: data.connection, qr: data.qr });
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setState((prev) => ({ ...prev, status: 'disconnected' }));
    };

    return () => es.close();
  }, []);

  return state;
}
