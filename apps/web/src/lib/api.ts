// Tiny fetch wrapper. Same-origin in prod (server serves the SPA); proxied in dev.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // parsed JSON error body, when the server sent one
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path} → ${res.status}`, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
