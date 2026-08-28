// Shared config + contract-address helpers for the extension surfaces
// (content script, background worker, popup).

// Build-time overrides for local development:
//   VITE_API_URL=http://localhost:3000 VITE_WEB_APP_URL=http://localhost:4173 npm run build
// Whatever these resolve to must also appear in manifest.json `host_permissions`,
// or the popup's fetches and the widget iframe are blocked.
const fromEnv = (key: string, fallback: string): string =>
  (((import.meta as any).env?.[key] as string | undefined) || fallback).replace(/\/+$/, '');

export const API_URL = fromEnv('VITE_API_URL', 'https://chat-ol91.onrender.com');

// ─── THE DOMAIN SWITCH ───────────────────────────────────────────────────────
// The project is moving to chorustrade.online. Both domains are already in
// `host_permissions` and in session-bridge's matches, so flipping this line and
// rebuilding needs NO Chrome Web Store re-review.
//
// It still points at the Vercel domain because chorustrade.online does not
// serve the app yet — it resolves to a parking page. Shipping a build aimed at
// a domain that returns nothing means a reviewer opens the extension, sees it
// fail, and rejects it.
//
// FLIP THIS once https://chorustrade.online actually serves the web app.
export const WEB_APP_URL = fromEnv('VITE_WEB_APP_URL', 'https://chorustrade.online');

export const SUPPORTED_SITES = [
  { host: 'gmgn.ai', label: 'GMGN' },
  { host: 'axiom.trade', label: 'Axiom' },
  { host: 'trade.padre.gg', label: 'Padre' },
];

export type DetectedToken = {
  ca: string;
  url: string;
  title: string;
  site: string;
  detectedAt: number;
};

export function roomUrl(ca: string): string {
  return `${WEB_APP_URL}/room/${encodeURIComponent(ca)}`;
}

export function embedUrl(ca: string): string {
  return `${WEB_APP_URL}/embed/${encodeURIComponent(ca)}`;
}

export function connectWalletUrl(ca?: string): string {
  const target = ca ? `/room/${encodeURIComponent(ca)}` : '/';
  return `${WEB_APP_URL}${target}?connect=1`;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Room id normalization, shared by the detectors, the popup, and the web app.
// EVM addresses are case-insensitive hex, so they lowercase safely; base58
// (Solana) addresses are case-sensitive and must be preserved verbatim, or the
// extension and the web app would open two different rooms for the same token.
export function normalizeCA(address: string): string {
  const value = address.trim();
  return EVM_ADDRESS.test(value) ? value.toLowerCase() : value;
}

export function isValidCA(address: string): boolean {
  const value = address.trim();
  return EVM_ADDRESS.test(value) || BASE58_ADDRESS.test(value);
}

export function shortenCA(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 3) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function siteLabel(hostname: string): string {
  const match = SUPPORTED_SITES.find((site) => hostname.endsWith(site.host));
  return match ? match.label : hostname;
}

export function timeAgo(timestamp: number | string | null): string {
  if (!timestamp) return 'never';
  const then = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (Number.isNaN(then)) return 'unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
