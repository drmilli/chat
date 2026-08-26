# Token Chat — Task Tracker

Living checklist. Supersedes the original sprint plan (recover with `git show HEAD:tasks.md`).
Sources: `brief.md`, `prd.md`, `development-plan.md`, `trading-module-update.docx`, plus the
pre-launch audit of the running system.

**How to use:** tick a box only when its acceptance criterion is demonstrably met. IDs are stable —
reference them in commits and PRs. Work top-down: P0 blocks launch, P3 blocks Phase 6.

Legend: `[ ]` open · `[x]` done · `[~]` partially done

---

## Status at a glance

| Phase | Plan | State |
|---|---|---|
| 0 — Spike | Detection report, CSP, chain evidence | done |
| 1 — Core Backend | Rooms, messages, persistence, rate limits, realtime | done (realtime deviates, see T-201) |
| 2 — Web App | `/room/<CA>`, `/embed/<CA>`, report/mute | done |
| 3 — Extension MVP | GMGN detection + iframe | done |
| 4 — Additional Sites | Axiom + Padre, moderation | done |
| 5 — Identity & Moderation | WalletConnect, verified badge, tiers | partial |
| 6–7 — Trading | Embedded wallet + execution engine | not started (blocked on T-300) |

---

## P0 — Launch blockers

Nothing ships to real users until every box here is ticked.

- [ ] **T-001 · Rotate the leaked database credential** — Owner: Backend · 30 min · CRITICAL
  The live Neon URL (with password) sat in `.env.example`, which is **not** gitignored. Assume it is
  compromised.
  *Acceptance:* new password issued in Neon, old one revoked, `.env` and Render env updated, app
  healthy afterwards. `.env.example` contains placeholders only (already fixed).

- [x] **T-002 · Authenticate the moderation API** — Owner: Backend · 1–2 days · CRITICAL
  `POST /api/admin/blocklist` returns 201 to an anonymous caller; `/api/bans` and `/admin` are equally
  open. Anyone can disable the blocklist or mass-ban users.
  *Built:* wallet allowlist (`ADMIN_WALLETS`), reusing the sign-in sessions from T-003 — no second
  credential to leak, nothing admin-shaped in the client bundle. **Fails closed:** unset means nobody
  can moderate.
  *Verified:* unauthenticated write → 401; guest session → 401; verified but non-allowlisted wallet →
  403; allowlisted wallet → 201. Ships on deploy (T-005 must set `ADMIN_WALLETS`).

- [x] **T-003 · Verify wallet ownership (stop identity spoofing)** — Owner: Backend + Frontend · 3–5 days · CRITICAL
  `identityId` is taken from the request body unchecked — posting as somebody else's wallet address
  succeeds today (verified: 201). Disqualifying before trading, where identity maps to a funded wallet.
  *Built:* HMAC-signed sessions (`src/auth/sessions.js`) + sign-in-with-wallet (`/api/auth/nonce` →
  `/api/auth/verify`) with EVM (ecrecover) and Solana (ed25519) signature checks. Guests get a
  server-issued id; every write takes its author from the session and ignores `req.body.identityId`.
  *Verified:* unauthenticated post → 401; forged token → 401; body-claimed author ignored; foreign-key
  signature → 401; replayed nonce → 400; rename restricted to self → 403. Reads stay public.

- [ ] **T-004 · Deploy the backend to Render** — Owner: Ops · 1 hr
  Live API predates the live-chat work: `/api/rooms/:id/stream` returns 404 in production, so chat does
  not update without a reload.
  *Acceptance:* `/api/rooms/testroom123/stream` returns `text/event-stream`; two browsers see each
  other's messages on the live site.

- [ ] **T-005 · Set production env vars on Render** — Owner: Ops · 15 min
  `NODE_ENV=production` (error masking only engages there), `TRUST_PROXY=1` (behind Cloudflare —
  without it every visitor shares one rate-limit bucket), `CORS_ORIGIN=https://token-chat.vercel.app`,
  **`SESSION_SECRET`** (32+ chars — the server now refuses to boot in production without it), and
  **`ADMIN_WALLETS`** (your moderator wallet address, or nobody can moderate).
  Leave `REALTIME_URL`/`REALTIME_KEY` blank — the SSE hub needs no provider.
  *Acceptance:* a 500 returns `{"error":"Internal server error"}`; preflight shows the single origin;
  `/api/auth/guest` returns 201; your admin wallet can write to the blocklist and others cannot.

- [ ] **T-006 · Redeploy the web app to Vercel** — Owner: Ops · 15 min
  Picks up `vercel.json` (API paths excluded from the SPA rewrite) and `.env.production`
  (`VITE_API_URL`), plus the nav/mobile/CA fixes.
  *Acceptance:* `/api/rooms/stats` on the Vercel domain no longer returns HTML; the app calls Render
  directly; deep links still resolve; a first-time visitor gets a guest session and can post.
  *Order:* deploy the backend (T-004/T-005) first — the new client sends `Authorization` headers and
  expects `/api/auth/*` to exist.

- [x] **T-007 · Point the extension at production** — Owner: Frontend · 30 min
  `WEB_APP_URL` in `apps/extension/config.ts` is still `localhost:4173`, so room links and the on-page
  widget only work on a dev machine. `API_URL` is already the Render host.
  *Done:* `WEB_APP_URL` is `https://token-chat.vercel.app`, added to `host_permissions`, and baked into
  the rebuilt bundles. Still needs a manual check on a live token page after the extension is reloaded.

---

## P1 — Pre-launch hardening

Not strictly blocking, but each is a real exposure or a trust problem.

- [x] **T-101 · Stop publishing message content publicly** — Owner: Backend/Product · 2 hrs
  `/api/activity` returns real message text to anonymous visitors and the landing page renders it.
  *Done:* `/api/activity` no longer returns message bodies. The feed still reports that someone posted
  (and whether it was a voice note), so the landing page stays alive without republishing chat.
  Reversible via `ACTIVITY_SHOW_PREVIEWS=true` if you decide otherwise.
  *Verified:* 20 events, 0 previews from the API; 0 preview elements rendered on the landing page.

- [x] **T-102 · Protect voice-clip endpoints** — Owner: Backend · 1 day
  `GET /api/messages/:id/audio` serves any clip to anyone who guesses an id (verified: 200, 65 KB).
  *Done:* migration 006 adds a per-message `audio_token` (existing clips backfilled). The URL carries
  it (`?t=…`) because `<audio src>` cannot send an Authorization header; the server compares in
  constant time and answers 404 — not 403 — so a wrong token does not confirm the clip exists.
  *Verified:* bare id → 404; wrong/short token → 404; correct token → 200 with byte-exact delivery
  (65219/65219, valid WebM); sweeping ids 1–60 without tokens leaked nothing; in-browser playback
  advances on the tokenised src.

- [ ] **T-103 · Purge test data from the production database** — Owner: Backend · 30 min · AWAITING YOUR GO-AHEAD
  `testroom123`, `voicetest-…112222`, identities `alice`/`bob`/`tester`, and audit-probe messages are
  live data feeding the public activity feed.
  *Dry run done, nothing deleted.* Would remove 4 rooms / 42 messages (`testroom123`,
  `voicetest-…112222`, `p0-audit-room`, `p0-app-room`) and 42 of 46 identities, keeping the 3 real
  token rooms (8 messages) and the 4 wallet identities. Irreversible, so it needs an explicit go-ahead.
  *Acceptance:* test rooms and identities removed; activity feed shows only genuine traffic.

- [x] **T-104 · Document the single-instance realtime constraint** — Owner: Ops · 15 min
  The SSE hub keeps subscribers in process memory: with 2+ Render instances a message only reaches
  clients on the same one.
  *Done:* prominent RUN ONE INSTANCE warning at the top of `hub.js`, naming the two other in-memory
  stores that share the constraint (sign-in nonces, rate-limiter counters) and what to do before
  scaling out. **Still to do on your side:** pin the Render instance count to 1.

- [ ] **T-105 · Move voice audio out of Postgres** — Owner: Backend · 2–3 days · Medium · NEEDS A PROVIDER CHOICE
  Clips are `bytea` rows at up to 2 MB; a few thousand make backups painful.
  *Blocked on:* which storage to use (Cloudflare R2, S3, or Supabase Storage) and its credentials.
  The `audio_token` from T-102 maps cleanly onto a signed-URL scheme when you pick one.
  *Acceptance:* clips in object storage, DB holds a URL, existing rows migrated.

- [x] **T-106 · Remove dead duplicate components** — Owner: Frontend · 15 min · Low
  `apps/web/src/components/ChatHistory.tsx` and `ChatComposer.tsx` are unused copies still carrying the
  old dark styling.
  *Done:* both deleted after confirming zero imports; build and typecheck pass. Recoverable from git.

---

## P2 — Chat MVP gaps (Phase 5 completion)

Called for by `development-plan.md` and not yet built.

- [ ] **T-201 · Decide the realtime end state** — Owner: Backend/Product · 1 day
  The plan specifies a managed provider (Supabase/Ably) behind an adapter. We ship an in-process SSE
  hub instead: no vendor, no cost, single instance. Either accept the deviation or plan the migration.
  *Acceptance:* decision recorded in the plan; if migrating, the adapter is implemented and swapped
  behind the existing interface.

- [x] **T-202 · CI pipeline** — Owner: DevOps · 3 days
  No `.github/workflows` exists; the only test script is `test:detect`.
  *Done:* `.github/workflows/ci.yml` — typecheck, backend unit tests, detector tests, all three builds,
  plus a guard that the extension bundles stay self-contained (an ESM import there breaks MV3 silently).
  A second job runs the integration suite only where the `DATABASE_URL` secret is reachable.
  *Verified:* every step run locally — typecheck clean, 19 unit + 34 detector tests, 3 builds, bundle
  guard passes.
  *Still yours:* add the `DATABASE_URL` / `SESSION_SECRET` repo secrets, and wire the staging deploy +
  manual production promotion to your hosts.

- [x] **T-203 · Automated test suite** — Owner: Backend + Frontend · 5 days
  *Done:* 19 unit tests (sessions, signatures, moderation, rate-limit tiers) and 9 integration tests
  (health, auth enforcement, persistence and ordering, reply quoting, cross-room reply rejection,
  moderation guards, activity privacy, stats) on Node's built-in runner — no new dependencies.
  `src/index.js` was split into `app.js` (exports) + `index.js` (listens) so tests can boot the API
  without a stray server.
  *Verified:* `npm test` 19/19; `npm run test:integration` 9/9 against the real database, and 9 skipped
  (0 failed) when `DATABASE_URL` is absent, which is what CI sees on a fork.
  *Not covered:* browser e2e still lives in ad-hoc scripts rather than the repo — worth folding in.

- [ ] **T-204 · Chain-aware room ids** — Owner: Backend · 2 days
  Plan calls for `rooms.chain` and chain-prefixed ids; the table is `(id, created_at)`. Cheaper now than
  after more rooms accumulate.
  *Acceptance:* `chain`, `last_active_at`, `settings` columns added; existing rows backfilled; room ids
  chain-prefixed consistently across web app and extension.
  *Note:* the plan's related "address normalization fix" is already done — EVM lowercased, Solana
  base58 preserved (`normalizeCA`).

- [x] **T-205 · Graduated rate-limit tiers** — Owner: Backend · 2 days
  Plan wants `identities.rate_limit_tier`; the column does not exist and limits are flat.
  *Done:* the tier comes from the verified session, not a client claim — guest 30/min, verified wallet
  120/min (`RATE_LIMIT_GUEST_REQUESTS` / `RATE_LIMIT_WALLET_REQUESTS`). A throttled guest is told to
  connect a wallet to raise the limit, and 429s now carry `Retry-After`. Counters are pruned so the
  maps cannot grow without bound.
  *Verified:* with the guest tier set to 5, a guest is blocked on request 6 while a verified wallet
  sends 12 without throttling.

- [~] **T-209 · Live voice chat (WebRTC)** — Owner: Backend + Frontend · NEW
  Live talk in the chat screen, alongside the existing async voice notes.
  *Built:* signalling over the existing SSE hub (`publishToPeer` addresses one peer, so SDP and ICE
  never broadcast to the room's listeners), `voice/rooms.js` presence with a hard cap, `voice/ice.js`
  issuing **ephemeral** coturn REST credentials so the TURN secret never reaches a browser, and
  `routes/voice.js` for join/signal/mute/heartbeat/leave. Client: `useVoiceLounge.ts` (mesh, ICE
  queueing, level meters) and `VoiceLounge.tsx`, rendered in both the full room and the widget.
  *Design calls worth knowing:*
  - **Mesh, capped at 6, counting listeners.** Each browser uploads its mic N-1 times, so a silent
    listener still costs every speaker an upload. "Unlimited listeners" is an SFU feature and is not
    faked here.
  - **Verified wallets only**, for moderation rather than revenue: live audio cannot be scanned by the
    blocklist that guards text, and a mute must attach to something more durable than a browser tab.
  - **Deterministic initiator** (larger peer id offers) instead of full perfect negotiation — no round
    trip, no SDP glare.
  - **Slots are bound to the SSE connection**, so a closed tab frees its slot immediately; the
    staleness sweep is only the backstop.
  - Everyone joins **muted**.
  *Verified:* 22 new backend tests (51 total green), typecheck and all three builds pass.
  *Still yours:* **stand up a TURN server and set `TURN_URLS`/`TURN_SECRET`** — without it 10-20% of
  users cannot connect at all. Then test with 3+ real browsers on different networks; a mesh cannot be
  meaningfully tested on one machine.
  *Moderation (added):* admin-only force-mute and kick, reusing `ADMIN_WALLETS` rather than inventing a
  second authority, plus a room ban now covering voice — someone banned from posting could otherwise
  still hold the floor out loud.
  **Enforcement lives with the listeners, and that is the only thing that works here.** Audio never
  passes through the server, so it cannot stop anyone transmitting; a modified client told to mute can
  keep sending. What it can do is tell every *other* client to stop listening — receivers silence a
  mod-muted peer locally and refuse to renegotiate with a kicked one. The offender's cooperation is
  never required. Kicks are keyed by **identity, not peer id**, or a refresh would undo them.
  *Not built:* no SFU path — see the note in `voice/rooms.js` before letting rooms grow.

- [ ] **T-206 · WalletConnect for mobile wallets** — Owner: Frontend · 3 days
  EIP-6963 + injected Phantom covers browser-extension wallets only. Mobile users cannot connect.
  *Acceptance:* a mobile wallet connects via QR and can post as a verified identity.

- [x] **T-207 · Verified badge** — Owner: Frontend · 1 day
  `identities.verified` exists but nothing renders it. Depends on T-003.
  *Done:* messages carry the author's `verified` flag (from the identities table, set by the T-003
  signature check) and the sender line renders a green check with a title explaining what it means.
  *Verified:* wallet-authored messages return `verified=true`, guest-authored `verified=false`.

- [ ] **T-208 · Monitoring and alerts** — Owner: Ops · 2 days
  *Acceptance:* dashboards for realtime connections, message rate, error rate, report volume; alerts on
  error spikes, throughput spikes (cost risk), and report spikes.

---

## P3 — Decisions blocking Phase 6

**Resolved 2026-08-25 — see `docs/decisions.md` for the reasoning and evidence.**

- [x] **T-300 · Launch chain → Robinhood Chain** (D-001) — Owner: Product
  **Decided: Robinhood Chain**, resolving brief-vs-PRD in favour of the PRD.
  *Consequence:* the execution engine is EVM-shaped, so Jupiter and Jito no longer apply. The
  replacement stack is now settled (D-005/T-305) and EVM is **confirmed**, not inferred: Arbitrum
  Orbit L2, chain ID 4663.
  *Watch item:* every observed page and all 4 real rooms are Solana, so until Robinhood tokens appear
  on the terminals, users can sit in rooms for tokens they cannot trade here. Options in D-001.

- [x] **T-301 · Key infrastructure → Turnkey** (D-002) — Owner: Product/Backend
  **Decided: Turnkey** — proven at Frontrun's scale for this exact shape, with the policy engine the
  plan needs for per-tx caps and allowed-program lists.
  *Next, before Phase 6 starts:* confirm Turnkey's Robinhood Chain support depth. Pairing D-001 with
  D-002 is the riskiest unverified assumption in the plan.

- [x] **T-302 · Fee model → 0.1% flat + cashback** (D-004) — Owner: Product
  **Decided: 0.1% flat with cashback**, matching the market reference.
  *Still open:* cashback percentage and funding source (revenue share vs treasury). `fee_ledger` must
  record fee and cashback separately from day one or the accounting cannot be reconstructed.

- [x] **T-303 · Alpha order scope → market AND limit** (D-003) — Owner: Product
  **Decided: both**, going beyond the trading doc's market-only recommendation.
  *Consequence:* limit orders add order storage, price monitoring, cancellation and expiry, plus
  partial-fill and stale-order handling. Phase 6 realistically becomes 5–7 weeks, not 3–5 (T-407).

- [ ] **T-304 · Staffing for execution work** — Owner: Product · STILL OPEN
  Phases 6–7 need an engineer who has shipped on-chain transaction infrastructure. D-001 (EVM) and
  D-003 (limit orders) both raise the bar: look for EVM execution experience specifically, not Solana.
  *Acceptance:* named engineer or contractor secured.

- [x] **T-305 · Choose the EVM execution stack** (D-005) — Owner: Backend · 3 days · UNBLOCKS T-402
  D-001 invalidated the Solana tooling the trading doc named. All five open questions now answered in
  `docs/decisions.md` (D-005), and the news is good on every one.
  *Chain model:* **EVM confirmed, not assumed** — Arbitrum Orbit (Nitro) L2, chain ID **4663**, ETH gas,
  ~100 ms blocks, mainnet live 2026-07-01. Migration 007's `tx_hash`/uint256 shape was right.
  *Aggregator:* **1inch primary, 0x fallback** — both live on 4663; Uniswap and Arcus deployed natively
  and the chain hit top-five DEX volume within two weeks, so liquidity is not the worry it might have been.
  *MEV:* **nothing to build.** Arbitrum's sequencer has no public mempool and orders FCFS, so sandwiching
  and gas-bidding frontruns are structurally unavailable — see T-504, which shrinks accordingly.
  *RPC:* Alchemy primary, first-party secondary, QuickNode third — the two-provider minimum is easy here.
  *Gas:* **do not port an EIP-1559 escalator.** Under FCFS a higher priority fee buys nothing; the real
  cost is the L1 data component. T-402's wording is corrected in D-005 item 4.
  *Caveat:* desk research from chain/vendor docs, nothing exercised against a live endpoint.
  *Still open before real money:* a working testnet swap (needs an RPC key), whether 4663 runs Timeboost,
  and **Turnkey's support for chain 4663** — still the riskiest unverified pairing (D-002).

---

## P4 — Phase 6: Trading Alpha (3–5 weeks, after P3)

- [x] **T-400 · Harden the widget boundary** — Owner: Frontend · 2 days
  The widget posts to the host with `postMessage(..., '*')` and no origin check. Fine for resizing a
  chat box; unacceptable once the iframe moves money — the doc names this "attack surface #1".
  *Done:* a real protocol replaces `postMessage(..., '*')`. The extension injects the iframe with
  `?host=<origin>&channel=<random>`; the widget posts **only** to that origin, and both sides validate
  source, origin, protocol name and channel. Sandbox tightened — `allow-popups-to-escape-sandbox`
  dropped (a popup from the widget stays sandboxed) and `referrerPolicy=no-referrer` added. Resize
  height stays clamped so the widget cannot cover the host page.
  *Verified* against a cross-origin host simulator (8/8): legitimate resize works; an unrelated frame
  receives **0** messages; forged page messages are rejected and reported as `source+origin`,
  `…+channel`, `…+protocol+channel`; a widget with no declared host stays silent.
  *Deferred to T-405:* the in-widget trade confirmation UX, which needs the trade panel to exist.
- [ ] **T-401 · Embedded wallet integration** (Turnkey/Privy) with signing policy: per-tx caps, allowed
  programs, rate limits — Owner: Backend · 1 week
- [~] **T-402 · `services/execution` scaffold** — Owner: Backend · 2 weeks
  *Built:* the whole path — `quote → guard → build → estimate gas → allocate nonce → sign →
  broadcast → confirm` — as `services/execution`, returning a row shaped for migration 007's `trades`.
  - **Multi-RPC failover** (`rpc.js`) separating transport failure (fail over) from application
    failure (do not — the node answered, and every other node will say the same). Per-provider
    cooldown, and a stale cooldown never blocks a submission.
  - **Router interface** (`router/`) with 1inch primary and 0x fallback per D-005, plus `quoteBest`
    comparing outputs as BigInt. Distinguishes "no route anywhere" (a fact about the token) from
    "our aggregators are down" (our problem) so the UI can say different things.
  - **Nitro-aware gas** (`gas.js`) splitting L1/L2 via the NodeInterface precompile and buffering only
    the L2 half, with a hard cost ceiling. **No priority-fee escalator** — under FCFS a tip buys
    nothing (D-005 item 4).
  - **Slippage guards** (`slippage.js`) — floor rounds down, input ceiling rounds up, quote freshness
    and price-impact limits. With no MEV relay to hide behind (D-005 item 2) these *are* the protection.
  - **Nonce management** (`nonce.js`) — serialised per address, never issues a duplicate under
    concurrency, never moves backwards on a lagging provider, releases only the newest allocation.
  - **Confirmation tracking** (`confirm.js`) — a reverted receipt is a *failed trade*, not a successful
    submission; a timeout returns `submitted` **with** its hash so a reconciler can finish, because
    re-signing is how one user intent becomes two live swaps.
  *Verified:* 98 tests, no network and no credentials — every RPC, router, gas and signer is injected,
  so the suite runs identically on a fork. Wired into CI.
  *Key custody is deliberately absent:* signing goes through an injected `Signer`, which is the T-401
  seam Turnkey drops into. A `policy` hook is called before any quote is fetched.
  *Still open before this is done:* the T-305 testnet swap (needs an RPC key), aggregator response
  field mapping confirmed against a live key, and a reconciler for `submitted` trades. See
  `services/execution/README.md`.
- [x] **T-403 · Trading data model** — `bot_wallets`, `trades`, `deposits`, `withdrawals`, plus
  `limit_orders` (D-003) and a `fee_ledger` that separates fee from cashback (D-004) — Owner: Backend · 3 days
  *Done:* migration 007. EVM-shaped per D-001 (`tx_hash`, not `tx_signature`). Amounts are
  `NUMERIC(78,0)` — a full uint256, exact; **no floats anywhere near money**. Constraints make bad
  states unstorable rather than merely discouraged: a confirmed trade must carry a hash, a tx hash is
  unique per chain, a deposit credits once, cashback can never exceed its fee, a filled limit order
  must link its trade, trigger prices must be positive, one wallet per identity per chain.
  *Verified:* 10 integration tests, including a 2^256-1 amount round-tripping exactly.
- [ ] **T-404 · Deposit flow** — deposit address/QR, deposit detection — Owner: Backend · 1 week
- [ ] **T-405 · Trade panel UI** — presets, buy/sell, visible tx status; reuses the CA-detection layer — Owner: Frontend · 1 week
- [ ] **T-407 · Limit-order lifecycle** (D-003) — order storage, price monitoring, fill detection,
  cancellation, expiry, partial fills — Owner: Backend · 1–2 weeks
- [ ] **T-406 · Whitelist gating + dogfooding** with small real balances — Owner: Product/Ops · 3 days
  *Phase acceptance:* a whitelisted user deposits, executes a market buy and sell, and sees confirmed
  status; failures surface a clear error; policy caps verified by test.

---

## P5 — Phase 7: Trading GA (3–5 weeks)

- [ ] **T-500 · Withdrawal processing** — Owner: Backend · 1 week
- [ ] **T-501 · Quick-buy hotkeys** — Owner: Frontend · 3 days
- [ ] **T-502 · Position and PnL display** for the active CA — Owner: Frontend · 1 week
- [~] **T-503 · Fee capture + `fee_ledger` accounting**, including cashback payout and its funding
  source (D-004) — Owner: Backend · 1 week
  *Arithmetic done* (`src/trading/fees.js`): 0.1% + cashback in **BigInt** throughout — a float here
  would corrupt the revenue line above 2^53 and only surface in an audit months later. Fees and
  cashback both round **down**, so we never overcharge and never pay out more than earned; an
  implausible fee (>10%) or a lossy input is refused rather than stored.
  *Verified:* 10 unit tests, including 0.1% of 1000 ETH in wei landing on exactly 1 ETH.
  *Still blocked:* wiring it to real trades (needs T-402) and the cashback funding source (D-004).
- [ ] **T-504 · Sequencer ordering: confirm and document** — Owner: Backend · ~1 day (was 1 week)
  D-005 item 2: Robinhood Chain inherits Arbitrum's private mempool and FCFS ordering, so there is no
  Jito equivalent to integrate and little for one to protect against. Confirm whether 4663 runs
  Timeboost, document the guarantee honestly in the UI, and let T-402's slippage guards do the real
  user protection. **Do not imply a private relay we do not have.**
- [~] **T-505 · Pen test of the widget boundary** — Owner: External · 1 week
  *Baseline ready:* `npm run test:security` runs the boundary suite from the repo against a
  cross-origin host simulator — legitimate resize, silence toward unrelated frames, and rejection of
  forged messages (8/8). Hand this to the pen tester as the current guarantee, and add any finding
  they produce as a new case so it can never regress.
  *Still external:* the pen test itself.
- [ ] **T-506 · Legal sign-off** on custody / money-transmission exposure — Owner: Product · START NOW
  This has the longest lead time of anything in Phase 7 and does not depend on a single line of code.
  Starting it now runs it in parallel with the execution work instead of after it.
- [~] **T-507 · Chrome Web Store re-review** — narrow permissions; consider open-sourcing the shipped
  build (Frontrun's trust approach) — Owner: Ops · budget for rejection loops
  *Review risk reduced:* the `tabs` permission is gone (host permissions already expose `tab.url` for
  our three sites, and the popup degrades cleanly elsewhere — verified both ways); `localhost` hosts
  are stripped from release builds by `scripts/finalize-manifest.mjs` (`npm run build:dev` keeps them);
  the description now says what the extension does for a user. Shipped permissions are now just
  `storage` plus eight per-site hosts.
  *Written:* `apps/extension/PRIVACY.md` (accurate to the code, including the IP-based rate limiting)
  and `apps/extension/STORE-SUBMISSION.md`.
  *Still yours:* host the privacy policy at a public URL — the store rejects data-handling extensions
  without one — plus screenshots, permission justifications and the data-use declaration.
  *Phase acceptance:* withdrawals work; fees captured to ledger; pen-test findings resolved; legal
  sign-off recorded; store re-review passed.

---

## Done — verified against the running system

- [x] **Sprint 0 · Detection spike** — `docs/spike-detection.md`; 34 detector tests pass (`npm run test:detect`)
- [x] **Postgres schema & migrations** — 005 migrations applied (rooms, messages, identities, reports, bans, blocklist, voice, replies, display names)
- [x] **Messages API** — POST/GET with history, limits, moderation
- [x] **Rate limiting** — per-IP and per-identity middleware (see T-005 for `TRUST_PROXY`)
- [x] **Web app** — `/room/<CA>`, `/embed/<CA>`, rooms directory, activity feed, admin console
- [x] **Extension MVP** — MV3, `document_start` detection, SPA polling, sandboxed iframe, toolbar popup
- [x] **Detectors for GMGN, Axiom, Padre** — URL-first with high-signal DOM fallback
- [x] **Moderation** — reports persist, ban list enforced, 10 blocklist patterns active (auth still open: T-002)
- [x] **Live chat over SSE** — verified two-browser delivery without reload (deviates from plan: T-201)
- [x] **Voice messages** — record, send, play, seek; 2 MB / 120 s caps enforced
- [x] **Replies** — persisted with quoted author and text snippet; click-to-jump
- [x] **Display names** — per-browser guest identity, name editing, blocklist-checked
- [x] **Wallet connect** — EIP-6963 multi-wallet discovery, picker, timeout and error handling
- [x] **Sessions & sign-in with wallet** — HMAC sessions, guest bootstrap, EVM + Solana signature verification, admin allowlist (17/17 backend, 8/8 in-browser)
- [x] **Site polish** — light glass redesign, logo, mobile menu, hash-scrolling nav (22/22 link audit), mobile audit fixes, copyable CA pill

---

## Notes

- `tasks-github-import.csv` is the **old** sprint list and no longer matches this file.
- `development-plan.md` and `development-plan.docx` are the same document in two formats.
- `docs/decisions.md` holds the decision log (D-001…D-006) with the evidence behind each call.
- Chat is the wedge and is not blocked on trading; trading monetizes the audience.
