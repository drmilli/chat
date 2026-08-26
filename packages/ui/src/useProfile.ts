import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from './api';
import { ensureSession, fetchIdentity } from './session';

const NAME_KEY = 'token-chat:display-name';

export const MAX_NAME_LENGTH = 32;

/** The database sleeps when idle, so a first request can be slow, not broken. */
const MAX_BOOTSTRAP_ATTEMPTS = 4;
const backoffMs = (attempt: number) => Math.min(1000 * 2 ** attempt, 8000);

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

export function useProfile(walletAccount?: string, sessionEpoch = 0) {
  // The identity now comes from a server-issued session. It used to be a
  // client-invented `guest-xxxx` string, which the API accepted on trust.
  const [identityId, setIdentityId] = useState<string>('');
  const [displayName, setDisplayName] = useState<string | null>(readStoredName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function bootstrap(attempt = 0) {
      try {
        await ensureSession();
        const identity = await fetchIdentity();
        if (cancelled) return;
        if (!identity) {
          // No identity and no throw means the session was rejected and
          // cleared. Start a fresh one rather than sitting here with a blank
          // id, which is what made the rename fail against `/api/identities/`.
          if (attempt < MAX_BOOTSTRAP_ATTEMPTS) {
            retryTimer = setTimeout(() => bootstrap(attempt + 1), backoffMs(attempt));
          } else {
            setError('Could not start a session — reload the page to try again.');
          }
          return;
        }
        setIdentityId(identity.id);
        setError(null);
        if (identity.displayName) {
          setDisplayName(identity.displayName);
          try {
            window.localStorage.setItem(NAME_KEY, identity.displayName);
          } catch (err) {
            /* storage unavailable */
          }
        }
      } catch (err) {
        if (cancelled) return;
        // A flaky connection is the common case on mobile, so retry before
        // giving up. Failing on the first blip left the user with no identity.
        if (attempt < MAX_BOOTSTRAP_ATTEMPTS) {
          retryTimer = setTimeout(() => bootstrap(attempt + 1), backoffMs(attempt));
          return;
        }
        setError('Could not start a session — messages cannot be sent.');
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // Re-runs when the wallet connects, and when the extension hands the widget
    // a session from the web app tab, so either upgrade is picked up.
  }, [walletAccount, sessionEpoch]);

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

      // Without this the request goes to `/api/identities/`, which matches no
      // route and comes back as a 404 HTML page — surfacing to the user as
      // "the API returned a web page instead of data", which points nowhere
      // near the real problem.
      if (!identityId) {
        setError('Still connecting — try again in a moment.');
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

  return {
    identityId,
    displayName,
    saving,
    error,
    /** False until the session resolves; writes cannot succeed before it. */
    ready: Boolean(identityId),
    saveName,
    clearError: () => setError(null),
  };
}
