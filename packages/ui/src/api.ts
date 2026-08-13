/**
 * Where the API lives.
 *
 * Empty (the dev default) keeps every request relative, so Vite's `/api` proxy
 * handles it. In a production build `VITE_API_URL` points at the deployed API —
 * without it the built frontend would request `/api/...` from whatever host is
 * serving the static files, which has no API.
 */
const RAW_BASE = ((import.meta as any).env?.VITE_API_URL as string | undefined) ?? '';

// Trailing slashes would produce `//api/...`.
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

/** Absolute URL for an API path, or the path unchanged when running behind the proxy. */
export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * The API returns audio links as relative paths (`/api/messages/:id/audio`),
 * which only resolve when the frontend and API share an origin.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * fetch + parse, with the failure modes that actually bite in production:
 *
 *  - A static host with an SPA fallback answers unknown paths with index.html
 *    and a 200, so `res.ok` passes and `.json()` dies on "<" with the useless
 *    "JSON.parse: unexpected character at line 1 column 1". Checking the
 *    content type turns that into a message that names the cause.
 *  - Error responses carry a JSON `error` field worth surfacing.
 */
export async function fetchJson<T = any>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new ApiError(`Could not reach the API at ${API_BASE || 'this origin'}.`, 0);
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!isJson) {
    const body = await response.text().catch(() => '');
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(body);
    throw new ApiError(
      looksLikeHtml
        ? `The API returned a web page instead of data (HTTP ${response.status}). ${url} is not being routed to the backend.`
        : `Unexpected response from the API (HTTP ${response.status}, ${contentType || 'no content type'}).`,
      response.status
    );
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError((data && (data as any).error) || `Request failed (HTTP ${response.status}).`, response.status);
  }
  return data as T;
}
