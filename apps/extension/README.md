apps/extension — Browser extension

Focus: Manifest V3 content scripts, URL-first detectors for GMGN/Axiom/Padre, inject sandboxed iframe to /embed/<CA>.

Surfaces:
- `content-script.ts` — detects the token CA on supported sites, injects the widget iframe, and reports the detection to the background worker.
- `background.ts` — tracks the detected CA per tab, keeps a 15-entry history in `chrome.storage.local`, and badges the toolbar icon.
- `popup.ts` / `public/popup.html` — the toolbar dropdown: detected CA + room detail for the current tab, live room stats, manual CA entry, connect wallet, and recently detected addresses.

Build:
- `npm run build` bundles each surface separately (`vite build --mode <entry>`). A single multi-entry build would hoist shared modules into an ESM chunk, and MV3 content scripts cannot be ES modules.
- Load `dist/` as an unpacked extension.

Detection:
- All three sites are client-rendered SPAs. The DOM is an empty shell at load (see `docs/spike-samples/gmgn-1.html`), so the **URL is the primary source** and the DOM is only a late fallback.
- The content script runs at `document_start`, retries on a decaying schedule (0ms → 13s) while the page renders, and **polls `location.href` every 700ms** so in-app navigation to another token re-detects. History patching does not work here — a content script's isolated world cannot see the page's `pushState` calls.
- `detectors/common.ts` holds the shared address parsing. Base58 and EVM matches use boundary assertions so a 64-char tx hash or a 45-char base58 run is rejected rather than truncated into a plausible wrong address.
- DOM fallback only reads high-signal sources (explorer links, `data-*` address attributes, address-ish meta tags). Scanning page text is deliberately avoided: it returns the first address on the page, which is usually some other token in a sidebar.
- Wallet/portfolio routes are excluded per site so they don't open a "token" room for a wallet address.

Tests:
- `npm run test:detect` — runs the real detector modules against a URL fixture list plus DOM stubs. No browser needed.
- `npm run spike:detect` — loads the URLs in `scripts/detect/urls.json` in Chrome and runs the same real detectors against the live pages.

Dev notes:
- Backend (`localhost:3000`) and web app (`localhost:4173`) URLs live in `config.ts`; point them at deployed hosts before shipping and update `host_permissions` to match.
- Use host_permissions limited to target domains only.
- Keep widget HTML/CSS isolated (iframe + sandbox or Shadow DOM).
- `normalizeCA` lowercases EVM addresses only — base58/Solana addresses are case-sensitive and must stay verbatim so extension and web app resolve to the same room. `apps/web/src/utils/ca.ts` mirrors this rule.
