// Axiom detector — URL-first, DOM fallback.
// Observed token pages: https://axiom.trade/meme/<address>?chain=sol&…
//
// Note: for some pairs the /meme/ segment carries the market address rather
// than the token mint. Once the page has rendered, a mint from an explorer link
// is preferred so the room id matches the one GMGN/Padre produce.

import { addressFromDom, isExcludedPath, matchPathPattern } from './common.ts';

const TOKEN_PREFIXES = ['meme', 'token', 'tokens', 't', 'pair'];
const EXCLUDED = ['portfolio', 'wallet', 'profile', 'settings', 'rewards'];

export function detectAxiom(url: string, doc?: Document): string | null {
  try {
    const fromDom = addressFromDom(doc);
    if (fromDom) return fromDom;

    const fromPattern = matchPathPattern(url, TOKEN_PREFIXES);
    if (fromPattern) return fromPattern;

    return null;
  } catch (err) {
    return null;
  }
}
