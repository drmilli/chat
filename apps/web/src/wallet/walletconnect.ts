/**
 * WalletConnect v2 — the only path a phone wallet has into this app (T-206).
 *
 * EIP-6963 and the injected globals cover browser-extension wallets only. On a
 * phone there is no extension to inject anything, so without this a mobile user
 * simply cannot connect. WalletConnect covers both directions: a QR code when
 * the page is on a desktop and the wallet is on a phone, and a deep link when
 * the page is already on the phone.
 *
 * WHY THIS IS LOADED LAZILY. The bundle is large — comparable to the rest of the
 * app — and most visitors have an extension wallet and never need it. It is
 * imported only when the user actually picks WalletConnect, so it costs nothing
 * on first paint.
 *
 * WHY THE PROVIDER IS EIP-1193. It exposes the same `request()` interface as an
 * injected wallet, so once connected it flows through the existing EVM path
 * untouched — including the `personal_sign` that proves ownership to the server.
 * WalletConnect is a transport here, not a second kind of wallet.
 */

/** Reown/WalletConnect project id. Without it the relay refuses every session. */
const PROJECT_ID = (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

/**
 * Chains offered to the wallet. `optionalChains` rather than `chains` on
 * purpose: a required chain the wallet does not support makes it refuse the
 * whole session, and we only need an address and a signature, not a network.
 */
const OPTIONAL_CHAINS = [1, 8453, 42161, 10, 137, 56, 4663];

export function isWalletConnectConfigured(): boolean {
  return Boolean(PROJECT_ID);
}

let providerPromise: Promise<any> | null = null;

/**
 * Initialises the provider once per page load. Repeated calls return the same
 * instance — creating a second one opens a second relay socket and leaves the
 * first session orphaned.
 */
export function getWalletConnectProvider(): Promise<any> {
  if (!PROJECT_ID) {
    return Promise.reject(
      new Error(
        'WalletConnect is not configured. Set VITE_WALLETCONNECT_PROJECT_ID (free, from cloud.reown.com) and rebuild.'
      )
    );
  }

  providerPromise ||= (async () => {
    const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
    return EthereumProvider.init({
      projectId: PROJECT_ID,
      optionalChains: OPTIONAL_CHAINS as any,
      showQrModal: true,
      // Only what identity needs. Requesting more than we use is what makes a
      // wallet's approval prompt look alarming.
      optionalMethods: ['personal_sign', 'eth_signTypedData_v4'],
      metadata: {
        name: 'Chorus',
        description: 'Live chat for every token page.',
        url: window.location.origin,
        icons: [`${window.location.origin}/icons/icon-128.png`],
      },
    });
  })().catch((err) => {
    // Never cache a failed init, or one flaky network moment disables
    // WalletConnect for the rest of the page's life.
    providerPromise = null;
    throw err;
  });

  return providerPromise;
}

/**
 * Returns the provider only if a session was already approved, without opening
 * the QR modal. Used to restore a connection on load — calling the normal
 * initialiser there would ambush every returning visitor with a QR code.
 */
export async function restoreWalletConnectSession(): Promise<any | null> {
  if (!PROJECT_ID) return null;
  try {
    const provider = await getWalletConnectProvider();
    return provider.session && provider.accounts?.length ? provider : null;
  } catch {
    return null;
  }
}

/**
 * Ends the session on both sides.
 *
 * Unlike an injected wallet, a WalletConnect session survives a page reload and
 * lives in the wallet app too. Dropping it locally without telling the relay
 * leaves the user with a connection their phone still shows as active.
 */
export async function disconnectWalletConnect(): Promise<void> {
  if (!providerPromise) return;
  try {
    const provider = await providerPromise;
    await provider.disconnect?.();
  } catch {
    /* the session may already be gone from the wallet's side */
  } finally {
    providerPromise = null;
  }
}
