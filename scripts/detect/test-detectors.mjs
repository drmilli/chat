#!/usr/bin/env node
// Regression tests for the shipped detectors. Imports the real detector
// modules (Node strips the TypeScript types), so this cannot drift from what
// the extension actually runs the way a re-implemented copy would.
//
//   node scripts/detect/test-detectors.mjs

import { detectGMGN } from '../../apps/extension/detectors/gmgn.ts';
import { detectAxiom } from '../../apps/extension/detectors/axiom.ts';
import { detectPadre } from '../../apps/extension/detectors/padre.ts';
import { stubDocument } from './stub-dom.mjs';

const SOL = '2P5FSiR4vhNcrXn6ttp1tgvvdqbH8tDMrQ7cDUijA5ry';
const SOL2 = '4o1G1NcA2sjq3VK7Xa4JANCn1ZKy2igqb3ZyZi991hWG';
const AXIOM_PAIR = 'Ba2baips1Rz2RhUSoSxknndVCwAJDwzzdEH8Z7kthkEe';
// A pump.fun-style mint: 44 base58 chars ending in "pump".
const PUMP = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump';
// 45 chars — not a valid Solana address. Must be rejected, not truncated to 44.
const TOO_LONG = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGpump';
// A transaction hash, not an address. Must not be truncated to a 40-hex address.
const TX_HASH = '0x9a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809';
const EVM = '0x6982508145454Ce325dDbE47a25d4ec3d2311933';
// A base64 payload (session id, referral blob) that happens to be 32-44 chars.
// This is what previously became a room id like "MTYyN2Q0…hIZDZm".
const BASE64_BLOB = 'MTYyN2Q0YjMtZmY0NC00ZjA5LWI5ZDgtNmEz';
// The same shape but with no base58-illegal characters, so only scoping saves us.
const BASE64_CLEAN = 'MTYyNzQ5YjMtZmY0NC00Zjk5LWI5ZDgtNmEz'.replace(/0/g, 'x').replace(/-/g, 'y');

const CASES = [
  // --- GMGN ---
  ['gmgn', `https://gmgn.ai/sol/token/${SOL}`, SOL, 'canonical token page'],
  ['gmgn', `https://www.gmgn.ai/sol/token/${SOL}`, SOL, 'www subdomain'],
  ['gmgn', `https://gmgn.ai/sol/token/${PUMP}`, PUMP, 'freshly launched pump.fun mint'],
  ['gmgn', `https://gmgn.ai/sol/token/${SOL}?tab=holders&maker=x`, SOL, 'query params appended'],
  ['gmgn', `https://gmgn.ai/token/${SOL}`, SOL, 'no chain segment'],
  ['gmgn', `https://gmgn.ai/eth/token/${EVM}`, EVM.toLowerCase(), 'EVM token lowercased'],
  ['gmgn', `https://gmgn.ai/?chain=sol&address=${SOL}`, SOL, 'address in query'],
  ['gmgn', `https://gmgn.ai/sol/address/${SOL}`, null, 'wallet page must not open a token room'],
  ['gmgn', 'https://gmgn.ai/', null, 'home page'],
  ['gmgn', 'https://gmgn.ai/trend/1h?chain=sol', null, 'trending list'],
  ['gmgn', `https://gmgn.ai/sol/token/${TOO_LONG}`, null, 'overlong base58 rejected, not truncated'],
  ['gmgn', `https://gmgn.ai/sol/tx/${TX_HASH}`, null, 'tx hash is not an address'],
  ['gmgn', `https://gmgn.ai/?ref=${BASE64_BLOB}`, null, 'base64 blob in a query param is not a token'],
  ['gmgn', `https://gmgn.ai/?ref=${BASE64_CLEAN}`, null, 'base58-legal base64 blob is not a token either'],
  ['gmgn', `https://gmgn.ai/some/unknown/route/${BASE64_CLEAN}`, null, 'unknown route is not scraped for ids'],

  // --- Axiom ---
  [
    'axiom',
    `https://axiom.trade/meme/${AXIOM_PAIR}?chain=sol&pulseChains=sol,robinhood,bnb&trackerChains=sol,robinhood,bnb,eth`,
    AXIOM_PAIR,
    'spike URL with multi-value query params',
  ],
  ['axiom', `https://axiom.trade/meme/${PUMP}`, PUMP, 'new mint'],
  ['axiom', `https://axiom.trade/token/${SOL}`, SOL, 'token route'],
  ['axiom', `https://axiom.trade/t/${SOL}`, SOL, 'short route'],
  ['axiom', 'https://axiom.trade/discover', null, 'discover page'],
  ['axiom', 'https://axiom.trade/pulse?chain=sol', null, 'pulse feed'],
  ['axiom', `https://axiom.trade/?session=${BASE64_CLEAN}`, null, 'session blob is not a token'],

  // --- Padre ---
  ['padre', `https://trade.padre.gg/trade/solana/${SOL2}`, SOL2, 'canonical trade page'],
  ['padre', `https://trade.padre.gg/trade/solana/${PUMP}`, PUMP, 'new mint'],
  [
    'padre',
    `https://trade.padre.gg/?backToUrl=%2Ftrade%2Fsolana%2F${SOL2}`,
    SOL2,
    'login bounce with encoded redirect',
  ],
  ['padre', `https://trade.padre.gg/trade/${SOL2}`, SOL2, 'no chain segment'],
  ['padre', 'https://trade.padre.gg/', null, 'home page'],
  ['padre', `https://trade.padre.gg/?token=${BASE64_CLEAN}`, null, 'opaque token param is not a mint'],
];

const DETECTORS = { gmgn: detectGMGN, axiom: detectAxiom, padre: detectPadre };

let failures = 0;
for (const [site, url, expected, label] of CASES) {
  const actual = DETECTORS[site](url, undefined);
  const ok = actual === expected;
  if (!ok) failures += 1;
  const shown = url.length > 74 ? `${url.slice(0, 74)}…` : url;
  console.log(`${ok ? '  ok  ' : ' FAIL '} [${site}] ${label}\n        ${shown}`);
  if (!ok) console.log(`        expected ${expected} — got ${actual}`);
}

// --- DOM fallback, for pages whose route carries no address ---

const DOM_CASES = [
  [
    'explorer link wins',
    { links: ['/discover', `https://solscan.io/token/${SOL}`] },
    SOL,
  ],
  [
    'data attribute',
    { attrs: [{ 'data-mint': SOL2 }] },
    SOL2,
  ],
  [
    'og:url meta',
    { metas: [{ property: 'og:url', content: `https://axiom.trade/meme/${AXIOM_PAIR}` }] },
    AXIOM_PAIR,
  ],
  [
    'unrelated links are ignored',
    { links: ['/pulse', 'https://twitter.com/someproject', '/settings'] },
    null,
  ],
  [
    'a sidebar full of other tokens must not be scraped',
    { metas: [{ name: 'description', content: `Trending: ${SOL} and ${SOL2}` }] },
    null,
  ],
];

for (const [label, signals, expected] of DOM_CASES) {
  const actual = detectAxiom('https://axiom.trade/discover', stubDocument(signals));
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} [dom] ${label}`);
  if (!ok) console.log(`        expected ${expected} — got ${actual}`);
}

// Case sensitivity matters: base58 is case-sensitive, so lowercasing a Solana
// mint would route the extension to a different room than the web app.
const caseCheck = detectGMGN(`https://gmgn.ai/sol/token/${SOL}`, undefined);
if (caseCheck !== SOL) {
  failures += 1;
  console.log(' FAIL  [unit] base58 case must be preserved');
}

const total = CASES.length + DOM_CASES.length + 1;
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
