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
