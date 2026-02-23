const BASE = '';  // same origin in prod; Vite proxy in dev

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(init?.headers ?? {}),
    },
  });
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
