// Padre detector — URL-first, DOM fallback.
// Observed token pages: https://trade.padre.gg/trade/solana/<mint>
// Padre also bounces through login with the destination in a redirect param.

import {
  addressFromDom,
  addressesInUrl,
  isExcludedPath,
  matchPathPattern,
  normalizeCA,
  redirectUrl,
} from './common.ts';

const TOKEN_PREFIXES = ['trade', 'token', 'tokens'];
const EXCLUDED = ['portfolio', 'wallet', 'profile', 'settings', 'positions'];
const REDIRECT_PARAMS = ['backToUrl', 'next', 'redirect', 'returnTo'];

export function detectPadre(url: string, doc?: Document): string | null {
  try {
    const fromPattern = matchPathPattern(url, TOKEN_PREFIXES);
    if (fromPattern) return fromPattern;

    // Login/redirect hops carry the real destination in a query param.
    const redirect = redirectUrl(url, REDIRECT_PARAMS);
    if (redirect) {
      const fromRedirect = matchPathPattern(redirect, TOKEN_PREFIXES) || addressesInUrl(redirect)[0];
      if (fromRedirect) return normalizeCA(fromRedirect);
    }

    return addressFromDom(doc, REDIRECT_PARAMS);
  } catch (err) {
    return null;
  }
}
