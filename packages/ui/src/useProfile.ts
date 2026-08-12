import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from './api';

const GUEST_KEY = 'token-chat:guest-id';
const NAME_KEY = 'token-chat:display-name';

export const MAX_NAME_LENGTH = 32;

/**
 * Before this existed every signed-out user posted as the literal string
 * "anonymous" — one shared identity, so nobody could be told apart and a ban on
 * it would have hit everyone. Each browser now gets its own stable guest id.
 */
function readGuestId(): string {
  if (typeof window === 'undefined') return 'guest';
  try {
    const existing = window.localStorage.getItem(GUEST_KEY);
    if (existing) return existing;
    const created = `guest-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(GUEST_KEY, created);
    return created;
  } catch (err) {
    // Private mode with storage disabled — fall back to the shared identity.
    return 'anonymous';
  }
}

function readStoredName(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(NAME_KEY);
  } catch (err) {
    return null;
  }
}

export type Profile = {
  /** Stable id used as the message author key. */
  identityId: string;
  displayName: string | null;
  saving: boolean;
  error: string | null;
};

export function useProfile(walletAccount?: string) {
  const [guestId] = useState(readGuestId);
  const identityId = walletAccount || guestId;

  const [displayName, setDisplayName] = useState<string | null>(readStoredName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server is the source of truth once an identity exists — a name set on
  // another device should win over whatever this browser cached.
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl(`/api/identities/${encodeURIComponent(identityId)}`))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.displayName) {
          setDisplayName(data.displayName);
          try {
            window.localStorage.setItem(NAME_KEY, data.displayName);
          } catch (err) {
            /* storage unavailable */
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [identityId]);

  const saveName = useCallback(
    async (nextName: string): Promise<boolean> => {
      const trimmed = nextName.trim();
      if (trimmed.length === 0) {
        setError('Enter a name, or cancel to stay unnamed.');
        return false;
      }
      if (trimmed.length > MAX_NAME_LENGTH) {
        setError(`Names are limited to ${MAX_NAME_LENGTH} characters.`);
        return false;
      }

      setSaving(true);
      setError(null);
      try {
        const res = await fetch(apiUrl(`/api/identities/${encodeURIComponent(identityId)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: trimmed, walletAddress: walletAccount || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || `Could not save your name (HTTP ${res.status}).`);
          return false;
        }
        setDisplayName(data.displayName);
        try {
          window.localStorage.setItem(NAME_KEY, data.displayName);
        } catch (err) {
          /* storage unavailable */
        }
        return true;
      } catch (err) {
        setError('Network error — your name was not saved.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [identityId, walletAccount]
  );

  return { identityId, displayName, saving, error, saveName, clearError: () => setError(null) };
}
