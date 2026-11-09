import { format } from 'date-fns';

export class ApiError extends Error {}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        // Scheduling and repeat logic on the server follow the browser's local clock.
        'X-Local-Now': format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Network error — is the server running?');
  }
  if (!res.ok) {
    // Session ended while using the app → the auth layer shows the welcome screen again.
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('auth:expired'));
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: (url: string) => request<void>('DELETE', url),
};
