const BASE = '';  // same origin in prod; Vite proxy in dev

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
    ...(init?.headers as Record<string, string> ?? {}),
  };
  // Only set Content-Type for requests that have a body
  if (init?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });
  if (res.status === 401) {
    localStorage.removeItem('jwt');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// For SSE: pass JWT as URL param since EventSource cannot send headers
export function sseUrl(path: string): string {
  const token = getToken();
  const separator = path.includes('?') ? '&' : '?';
  return `${BASE}${path}${separator}token=${encodeURIComponent(token)}`;
}
