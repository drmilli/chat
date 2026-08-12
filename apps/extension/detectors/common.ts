// Shared address parsing for the per-site detectors.
//
// The target sites are client-rendered SPAs: at document_idle the DOM is an
// empty shell (see docs/spike-samples/*.html), so the URL is the only reliable
// source on first paint, and the DOM only becomes useful after the app renders.

export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// Base58 excludes 0, O, I and l — which is what keeps hex hashes and build ids
// from being mistaken for Solana mints.
export const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Boundary assertions matter: without them a 64-char transaction hash matches
// its first 40 hex characters, and a 45-char base58 run matches its first 44 —
// producing a plausible but wrong address instead of no match at all.
const EVM_IN_TEXT = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const BASE58_IN_TEXT = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;

export function isAddress(value: string): boolean {
  return EVM_ADDRESS.test(value) || BASE58_ADDRESS.test(value);
}

// EVM addresses are case-insensitive hex so they lowercase safely; base58 is
// case-sensitive and must be preserved or the room id changes.
export function normalizeCA(address: string): string {
  const value = address.trim();
  return EVM_ADDRESS.test(value) ? value.toLowerCase() : value;
}

/** Every address-shaped token inside a string, longest first. */
export function addressesInText(text: string): string[] {
  if (!text) return [];
  const found = [...(text.match(EVM_IN_TEXT) || []), ...(text.match(BASE58_IN_TEXT) || [])];
  return found.filter((value, index) => found.indexOf(value) === index);
}

/**
 * Address candidates from a URL: path segments first (most specific), then
 * query values, then the hash. Segments are searched rather than matched whole,
 * so wrappers like `ref_<addr>` or `<addr>-pump` still resolve.
 */
export function addressesInUrl(url: string): string[] {
  const candidates: string[] = [];
  try {
    const parsed = new URL(url);

    for (const segment of parsed.pathname.split('/')) {
      if (segment) candidates.push(...addressesInText(decodeURIComponent(segment)));
    }
    parsed.searchParams.forEach((value) => {
      for (const part of value.split(',')) candidates.push(...addressesInText(part));
    });
    if (parsed.hash) candidates.push(...addressesInText(decodeURIComponent(parsed.hash)));
  } catch (err) {
    // Not a parseable URL — fall back to scanning the raw string.
    candidates.push(...addressesInText(url));
  }
  return candidates.filter((value, index) => candidates.indexOf(value) === index);
}

/** First address in the URL, or null. */
export function addressFromUrl(url: string): string | null {
  const [first] = addressesInUrl(url);
  return first ? normalizeCA(first) : null;
}

/** Match a path against `/<prefix>/<address>`, optionally with a chain segment. */
export function matchPathPattern(url: string, prefixes: string[]): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    for (let i = 0; i < segments.length; i += 1) {
      if (!prefixes.includes(segments[i].toLowerCase())) continue;
      // Accept `/prefix/<addr>` and `/prefix/<chain>/<addr>`.
      for (const candidate of [segments[i + 1], segments[i + 2]]) {
        if (!candidate) continue;
        const [address] = addressesInText(decodeURIComponent(candidate));
        if (address) return normalizeCA(address);
      }
    }
  } catch (err) {
    /* ignore */
  }
  return null;
}

/** True when the path is a known non-token route (wallet, portfolio, …). */
export function isExcludedPath(url: string, excluded: string[]): boolean {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
    return segments.some((segment) => excluded.includes(segment));
  } catch (err) {
    return false;
  }
}

const EXPLORER_HOSTS = [
  'solscan.io',
  'birdeye.so',
  'dexscreener.com',
  'pump.fun',
  'explorer.solana.com',
  'solana.fm',
  'etherscan.io',
  'basescan.org',
  'bscscan.com',
];

/**
 * DOM fallback. Only high-signal sources — explorer links, address data
 * attributes and meta tags. Scanning whole-page text is deliberately avoided:
 * it returns the first address-shaped string on the page, which is routinely
 * some other token from a sidebar list.
 */
export function addressFromDom(doc: Document | undefined, redirectParams: string[] = []): string | null {
  if (!doc) return null;

  try {
    // 1. Links out to an explorer — these point at the token being viewed.
    const links = Array.from(doc.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (!EXPLORER_HOSTS.some((host) => href.includes(host))) continue;
      const [address] = addressesInUrl(href.startsWith('http') ? href : `https://x.invalid${href}`);
      if (address) return normalizeCA(address);
    }

    // 2. Explicit address attributes.
    const attrSelectors = [
      '[data-token-address]',
      '[data-mint]',
      '[data-address]',
      '[data-contract-address]',
      '[data-ca]',
    ];
    for (const selector of attrSelectors) {
      const element = doc.querySelector(selector);
      if (!element) continue;
      const raw =
        element.getAttribute('data-token-address') ||
        element.getAttribute('data-mint') ||
        element.getAttribute('data-address') ||
        element.getAttribute('data-contract-address') ||
        element.getAttribute('data-ca') ||
        '';
      const [address] = addressesInText(raw);
      if (address) return normalizeCA(address);
    }

    // 3. Meta tags, including og:url which often carries the canonical token page.
    const metas = Array.from(doc.querySelectorAll('meta[content]')) as HTMLMetaElement[];
    for (const meta of metas) {
      const name = (meta.getAttribute('name') || meta.getAttribute('property') || '').toLowerCase();
      if (!/token|address|mint|og:url|canonical/.test(name)) continue;
      const [address] = addressesInText(meta.getAttribute('content') || '');
      if (address) return normalizeCA(address);
    }

    // 4. A redirect target carried in the current URL (Padre does this on login).
    if (redirectParams.length) {
      const redirect = redirectUrl(doc.defaultView?.location?.href || '', redirectParams);
      if (redirect) {
        const [address] = addressesInUrl(redirect);
        if (address) return normalizeCA(address);
      }
    }
  } catch (err) {
    // Cross-origin frames and hostile DOMs can throw — detection just fails.
  }

  return null;
}

export function redirectUrl(url: string, params: string[]): string | null {
  try {
    const parsed = new URL(url);
    for (const key of params) {
      const value = parsed.searchParams.get(key);
      if (value) return decodeURIComponent(value);
    }
  } catch (err) {
    /* ignore */
  }
  return null;
}
