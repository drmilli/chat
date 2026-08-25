import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from './api';
import { ensureSession, fetchIdentity } from './session';

const NAME_KEY = 'token-chat:display-name';

export const MAX_NAME_LENGTH = 32;

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
  // The identity now comes from a server-issued session. It used to be a
  // client-invented `guest-xxxx` string, which the API accepted on trust.
  const [identityId, setIdentityId] = useState<string>('');
  const [displayName, setDisplayName] = useState<string | null>(readStoredName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        await ensureSession();
        const identity = await fetchIdentity();
        if (cancelled || !identity) return;
        setIdentityId(identity.id);
        if (identity.displayName) {
          setDisplayName(identity.displayName);
          try {
            window.localStorage.setItem(NAME_KEY, identity.displayName);
          } catch (err) {
            /* storage unavailable */
          }
        }
      } catch (err) {
        if (!cancelled) setError('Could not start a session — messages cannot be sent.');
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // Re-runs when the wallet connects, so the session upgrade is picked up.
  }, [walletAccount]);

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
        const data = await fetchJson<{ displayName: string }>(
          `/api/identities/${encodeURIComponent(identityId)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: trimmed, walletAddress: walletAccount || null }),
          }
        );
        setDisplayName(data.displayName);
        try {
          window.localStorage.setItem(NAME_KEY, data.displayName);
        } catch (err) {
          /* storage unavailable */
        }
        return true;
      } catch (err: any) {
        setError(err?.message || 'Network error — your name was not saved.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [identityId, walletAccount]
  );

  return { identityId, displayName, saving, error, saveName, clearError: () => setError(null) };
}
