import { fetchJson, setAuthTokenReader } from './api';

const TOKEN_KEY = 'token-chat:session';

export type SessionIdentity = {
  id: string;
  kind: 'guest' | 'wallet';
  verified: boolean;
  displayName?: string | null;
  walletAddress?: string | null;
};

function read(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch (err) {
    return null;
  }
}

function write(token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    /* private mode — the session simply lasts for this page load */
  }
}

let token: string | null = typeof window === 'undefined' ? null : read();
let bootstrapping: Promise<string> | null = null;

export function getToken(): string | null {
  return token;
}

setAuthTokenReader(getToken);

export function setToken(next: string) {
  token = next;
  write(next);
}

export function clearSession() {
  token = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch (err) {
    /* ignore */
  }
}

/**
 * Guarantees a usable session, creating an anonymous one on first visit.
 *
 * The server picks the guest id — the client used to invent `guest-xxxx`
 * itself, which meant the id was just an unverified claim.
 */
export async function ensureSession(): Promise<string> {
  if (token) return token;
  // Concurrent callers (chat page + profile hook) must not each create one.
  if (!bootstrapping) {
    bootstrapping = fetchJson<{ token: string }>('/api/auth/guest', { method: 'POST' })
      .then((data) => {
        setToken(data.token);
        return data.token;
      })
      .finally(() => {
        bootstrapping = null;
      });
  }
  return bootstrapping;
}

export async function fetchIdentity(): Promise<SessionIdentity | null> {
  if (!token) return null;
  try {
    return await fetchJson<SessionIdentity>('/api/auth/me');
  } catch (err: any) {
    // ONLY a rejection by the server means the token is bad. This used to clear
    // the session on ANY error, so a single dropped request — a patchy mobile
    // connection, a backgrounded tab, a cold-starting database — destroyed a
    // perfectly valid session. The caller was then left with no identity and no
    // error, and the next write failed in a way that pointed nowhere near the
    // cause. Status 0 is "could not reach the API", which says nothing about
    // whether the token is still good.
    if (err?.status === 401 || err?.status === 403) {
      clearSession();
      return null;
    }
    // Transient: keep the session and let the caller retry.
    throw err;
  }
}

/**
 * Upgrades the current session to a verified wallet session.
 * `signMessage` is supplied by the app, which owns the wallet provider.
 */
export async function signInWithWallet({
  address,
  chain,
  signMessage,
}: {
  address: string;
  chain: 'evm' | 'solana';
  signMessage: (message: string) => Promise<string>;
}): Promise<SessionIdentity> {
  const { message } = await fetchJson<{ message: string; nonce: string }>('/api/auth/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, chain }),
  });

  const signature = await signMessage(message);

  const result = await fetchJson<{ token: string; identity: SessionIdentity }>('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature, chain }),
  });

  setToken(result.token);
  return result.identity;
}
