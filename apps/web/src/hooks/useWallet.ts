import { useCallback, useEffect, useRef, useState } from 'react';
import { signInWithWallet, clearSession } from '@token-chat/ui';
import {
  getWalletConnectProvider,
  isWalletConnectConfigured,
  restoreWalletConnectSession,
  disconnectWalletConnect,
} from '../wallet/walletconnect';

export type WalletKind = 'evm' | 'solana';

/** An injected wallet the user can pick, discovered via EIP-6963 or a legacy global. */
export type DiscoveredWallet = {
  id: string;
  name: string;
  icon?: string;
  kind: WalletKind;
  /** Null for wallets whose provider is created on demand — see `getProvider`. */
  provider: any;
  /**
   * Lazily builds the provider. WalletConnect's bundle is large and most
   * visitors never need it, so it is only imported once actually chosen.
   */
  getProvider?: () => Promise<any>;
  /** Reaches a wallet app on a phone rather than an extension in this browser. */
  isMobileBridge?: boolean;
};

export type WalletState = {
  account: string | null;
  chainId: string | null;
  kind: WalletKind | null;
  walletName: string | null;
  error: string | null;
  connecting: boolean;
  isConnected: boolean;
  /** No injected wallet at all — the UI should prompt the user to install one. */
  noProvider: boolean;
  /** Everything injected in this browser; more than one means the user must choose. */
  wallets: DiscoveredWallet[];
  /** True while the wallet picker should be shown. */
  choosing: boolean;
  /** Ownership proved by signature — the identity is verified server-side. */
  verified: boolean;
};

const initialState: WalletState = {
  account: null,
  chainId: null,
  kind: null,
  walletName: null,
  error: null,
  connecting: false,
  isConnected: false,
  noProvider: false,
  wallets: [],
  choosing: false,
  verified: false,
};

type AnyWindow = Window & {
  ethereum?: any;
  solana?: any;
  phantom?: { solana?: any };
};

// A wallet popup the user never touches would otherwise leave the button stuck
// on "Connecting…" forever.
const REQUEST_TIMEOUT_MS = 60000;

/**
 * Approving on a phone means unlocking it, finding the wallet app and coming
 * back. The extension timeout is far too short for that, and firing it early
 * tells the user their wallet failed while they are still mid-approval.
 */
const MOBILE_REQUEST_TIMEOUT_MS = 180000;

function legacyEvm(): DiscoveredWallet | null {
  if (typeof window === 'undefined') return null;
  const provider = (window as AnyWindow).ethereum;
  if (!provider) return null;
  const name = provider.isMetaMask ? 'MetaMask' : provider.isRabby ? 'Rabby' : provider.isCoinbaseWallet ? 'Coinbase Wallet' : 'Browser wallet';
  return { id: 'legacy-evm', name, kind: 'evm', provider };
}

/**
 * WalletConnect, offered alongside the injected wallets rather than as a
 * separate flow — from the user's point of view it is just another wallet to
 * pick, and on a phone it is usually the only one available.
 */
function walletConnectOption(): DiscoveredWallet | null {
  if (!isWalletConnectConfigured()) return null;
  return {
    id: 'walletconnect',
    name: 'Mobile wallet (WalletConnect)',
    kind: 'evm',
    provider: null,
    getProvider: getWalletConnectProvider,
    isMobileBridge: true,
  };
}

// The target sites are Solana-focused, so Phantom and friends count as wallets too.
function solanaWallet(): DiscoveredWallet | null {
  if (typeof window === 'undefined') return null;
  const win = window as AnyWindow;
  const provider = win.phantom?.solana ?? (win.solana?.isPhantom || win.solana?.connect ? win.solana : null);
  if (!provider) return null;
  return { id: 'solana', name: provider.isPhantom ? 'Phantom' : 'Solana wallet', kind: 'solana', provider };
}

function dedupe(wallets: DiscoveredWallet[]): DiscoveredWallet[] {
  const seen = new Set<any>();
  return wallets.filter((wallet) => {
    // Lazy wallets have no provider yet, so they key on id instead. Keying
    // every one on `provider` would let two null-provider entries collide and
    // silently drop the second.
    const key = wallet.provider ?? `id:${wallet.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeError(err: any): string {
  const code = err?.code;
  if (code === 4001 || /reject|denied|declined/i.test(err?.message || '')) {
    return 'Connection request rejected in your wallet.';
  }
  if (code === -32002) {
    // MetaMask keeps one request queued; further clicks fail until it is handled.
    return 'Your wallet already has a connection request open — click the wallet extension in your toolbar to approve it.';
  }
  if (code === -32603) return 'Your wallet reported an internal error. Unlock it and try again.';
  return err?.message || 'Could not connect wallet.';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        Object.assign(new Error('Your wallet did not respond. Open the extension from your toolbar — the approval popup may be hidden behind this window.'), {
          code: 'TIMEOUT',
        })
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>(initialState);
  const walletsRef = useRef<DiscoveredWallet[]>([]);

  const publish = useCallback((wallets: DiscoveredWallet[]) => {
    walletsRef.current = wallets;
    setWallet((current) => ({ ...current, wallets, noProvider: wallets.length === 0 }));
  }, []);

  // Discover wallets. EIP-6963 is the modern path and is the only reliable way
  // to see every injected wallet — with several installed they all fight over
  // window.ethereum and only the last one to load wins.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const found = new Map<string, DiscoveredWallet>();

    function onAnnounce(event: any) {
      const { info, provider } = event.detail || {};
      if (!info || !provider) return;
      found.set(info.rdns || info.uuid, {
        id: info.rdns || info.uuid,
        name: info.name || 'Wallet',
        icon: info.icon,
        kind: 'evm',
        provider,
      });
      publish(dedupe([...found.values(), ...[solanaWallet(), walletConnectOption()].filter(Boolean) as DiscoveredWallet[]]));
    }

    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Wallets that predate EIP-6963 only expose the globals.
    const settle = setTimeout(() => {
      const legacy = found.size === 0 ? [legacyEvm()] : [];
      publish(
        dedupe([...found.values(), ...legacy, solanaWallet(), walletConnectOption()].filter(Boolean) as DiscoveredWallet[])
      );
    }, 350);

    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
      clearTimeout(settle);
    };
  }, [publish]);

  // Restore an already-authorised session without prompting.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      // A previously approved WalletConnect session survives a reload, so it is
      // restored first — but only if one already exists. Initialising the
      // provider unconditionally here would ambush every returning visitor with
      // a QR code they never asked for.
      const wc = await restoreWalletConnectSession();
      if (cancelled) return;
      if (wc?.accounts?.length) {
        setWallet((current) => ({
          ...current,
          account: wc.accounts[0],
          chainId: wc.chainId ? `0x${Number(wc.chainId).toString(16)}` : null,
          kind: 'evm',
          walletName: 'Mobile wallet (WalletConnect)',
          isConnected: true,
          error: null,
        }));
        return;
      }

      for (const candidate of walletsRef.current) {
        if (cancelled) return;
        // Lazy wallets are never probed here; touching one would build the
        // provider and open its modal.
        if (candidate.getProvider) continue;
        try {
          if (candidate.kind === 'evm') {
            const accounts = await candidate.provider.request({ method: 'eth_accounts' });
            if (accounts?.length) {
              const chainId = await candidate.provider.request({ method: 'eth_chainId' });
              if (cancelled) return;
              setWallet((current) => ({
                ...current,
                account: accounts[0],
                chainId,
                kind: 'evm',
                walletName: candidate.name,
                isConnected: true,
                error: null,
              }));
              return;
            }
          } else if (candidate.provider.isConnected && candidate.provider.publicKey) {
            setWallet((current) => ({
              ...current,
              account: candidate.provider.publicKey.toString(),
              chainId: 'solana',
              kind: 'solana',
              walletName: candidate.name,
              isConnected: true,
              error: null,
            }));
            return;
          }
        } catch (err) {
          /* try the next wallet */
        }
      }
    }

    if (wallet.wallets.length > 0 && !wallet.isConnected) restore();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.wallets]);

  const connectWith = useCallback(async (chosen: DiscoveredWallet) => {
    setWallet((current) => ({ ...current, connecting: true, error: null, choosing: false }));
    try {
      // A lazy wallet (WalletConnect) builds its provider on first use. From
      // here on it is an ordinary EIP-1193 provider and the paths below do not
      // care which kind it is.
      const provider = chosen.getProvider ? await chosen.getProvider() : chosen.provider;
      chosen = { ...chosen, provider };

      if (chosen.kind === 'evm') {
        const accounts = await withTimeout<string[]>(
          chosen.provider.request({ method: 'eth_requestAccounts' }),
          // A phone approval means unlocking a device and switching apps, which
          // takes far longer than clicking an extension popup.
          chosen.isMobileBridge ? MOBILE_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS
        );
        const chainId = await chosen.provider.request({ method: 'eth_chainId' });
        setWallet((current) => ({
          ...current,
          account: accounts[0] ?? null,
          chainId,
          kind: 'evm',
          walletName: chosen.name,
          connecting: false,
          isConnected: Boolean(accounts[0]),
          error: accounts[0] ? null : 'Wallet returned no account.',
        }));

        // Connecting only proves the wallet is present. Signing the server's
        // nonce proves ownership, which is what upgrades the session.
        if (accounts[0]) {
          try {
            await signInWithWallet({
              address: accounts[0],
              chain: 'evm',
              signMessage: (message) =>
                chosen.provider.request({ method: 'personal_sign', params: [message, accounts[0]] }),
            });
            setWallet((current) => ({ ...current, verified: true }));
          } catch (err: any) {
            setWallet((current) => ({
              ...current,
              verified: false,
              error: /reject|denied/i.test(err?.message || '')
                ? 'Wallet connected, but you declined the sign-in signature — you are posting as a guest.'
                : 'Wallet connected, but sign-in failed — you are posting as a guest.',
            }));
          }
        }

        chosen.provider.on?.('accountsChanged', (next: string[]) =>
          setWallet((current) => ({ ...current, account: next[0] || null, isConnected: next.length > 0 }))
        );
        chosen.provider.on?.('chainChanged', (next: string) => setWallet((current) => ({ ...current, chainId: next })));
        // A WalletConnect session can be ended from the phone, where this app
        // gets no other signal. Without this the UI keeps showing a connected
        // wallet that can no longer sign anything.
        chosen.provider.on?.('disconnect', () =>
          setWallet((current) => ({
            ...current,
            account: null,
            isConnected: false,
            verified: false,
            error: 'Wallet disconnected.',
          }))
        );
        return;
      }

      const response = await withTimeout<any>(chosen.provider.connect(), REQUEST_TIMEOUT_MS);
      const account = (response?.publicKey ?? chosen.provider.publicKey)?.toString();

      if (account) {
        try {
          await signInWithWallet({
            address: account,
            chain: 'solana',
            signMessage: async (message) => {
              const signed = await chosen.provider.signMessage(new TextEncoder().encode(message), 'utf8');
              const bs58 = await import('bs58');
              return (bs58.default?.encode || (bs58 as any).encode)(signed.signature ?? signed);
            },
          });
        } catch (err) {
          /* posting continues as a guest */
        }
      }
      setWallet((current) => ({
        ...current,
        account: account ?? null,
        chainId: 'solana',
        kind: 'solana',
        walletName: chosen.name,
        connecting: false,
        isConnected: Boolean(account),
        error: account ? null : 'Wallet returned no account.',
      }));
    } catch (err: any) {
      setWallet((current) => ({
        ...current,
        connecting: false,
        isConnected: false,
        error: describeError(err),
      }));
    }
  }, []);

  /**
   * Connects when exactly one wallet is injected. With several, the caller is
   * expected to show `wallet.wallets` and call `connectWith` for the choice.
   */
  const connect = useCallback(async () => {
    const wallets = walletsRef.current;

    if (wallets.length === 0) {
      // On a phone there is no extension to install, so the desktop advice is
      // actively unhelpful — say what is actually missing instead.
      const onMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      setWallet((current) => ({
        ...current,
        noProvider: true,
        error: onMobile
          ? 'Mobile wallet support is not configured on this site yet.'
          : 'No browser wallet detected. Install MetaMask or Phantom, then reload this page.',
      }));
      return;
    }

    if (wallets.length === 1) {
      await connectWith(wallets[0]);
      return;
    }

    // Surface the picker rather than guessing which wallet the user wants.
    setWallet((current) => ({ ...current, choosing: true, error: null }));
  }, [connectWith]);

  /**
   * Ends the connection.
   *
   * A WalletConnect session is not like an injected one: it survives a reload
   * and exists in the wallet app too. Clearing it only here would leave the
   * user's phone showing an active connection to a site that has forgotten it,
   * with no way to revoke from our side.
   */
  const disconnect = useCallback(async () => {
    await disconnectWalletConnect().catch(() => {});
    clearSession();
    setWallet((current) => ({ ...initialState, wallets: current.wallets }));
  }, []);

  const dismissError = useCallback(() => {
    setWallet((current) => ({ ...current, error: null }));
  }, []);

  const cancelChoosing = useCallback(() => {
    setWallet((current) => ({ ...current, choosing: false }));
  }, []);

  return { wallet, connect, connectWith, disconnect, dismissError, cancelChoosing };
}
