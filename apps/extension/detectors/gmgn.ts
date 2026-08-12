// GMGN detector — URL-first, DOM fallback.
// Observed token pages: https://gmgn.ai/sol/token/<mint>
// Also handled: /<chain>/token/<mint>, /token/<mint>, ?address=/?token= query forms.

import { addressFromDom, isExcludedPath, matchPathPattern, normalizeCA } from './common.ts';

const TOKEN_PREFIXES = ['token', 'tokens', 'meme'];
// Wallet/portfolio routes carry an address too — detecting those would open a
// room for a wallet instead of a token.
const EXCLUDED = ['address', 'wallet', 'portfolio', 'copytrade', 'follow', 'holdings', 'profile'];

export function detectGMGN(url: string, doc?: Document): string | null {
  try {
    const fromPattern = matchPathPattern(url, TOKEN_PREFIXES);
    if (fromPattern) return fromPattern;

    if (isExcludedPath(url, EXCLUDED)) return null;

    const fromQuery = queryAddress(url);
    if (fromQuery) return fromQuery;

    return addressFromDom(doc);
  } catch (err) {
    return null;
  }
}

function queryAddress(url: string): string | null {
  try {
    const params = new URL(url).searchParams;
    for (const key of ['address', 'token', 'mint', 'ca']) {
      const value = params.get(key);
      if (value && /^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/.test(value.trim())) {
        return normalizeCA(value.trim());
      }
    }
  } catch (err) {
    /* ignore */
  }
  return null;
}
