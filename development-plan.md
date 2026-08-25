# Token Chat — Project Development Plan

Chat MVP (Phases 0–5) + Trading Module (Phases 6–7)
Companion to `brief.md` / `prd.md` / `trading-module-update.docx` · August 24, 2026

## 1. Purpose & Assumptions

A practical development plan with phases, tasks, owners, and timelines to ship the token-scoped chat MVP quickly, followed by the in-extension trading module. Designed for a small engineering team with clear upgrade paths.

- **Chain — UNRESOLVED (blocking for Phase 6):** brief says Solana; PRD says Robinhood Chain. Target terminals (GMGN, Axiom, Padre) may span both — Frontrun supports Solana and Robinhood. Decide before any execution-engine work.
- **Realtime:** start with a managed provider (Supabase Realtime or Ably) behind an adapter abstraction.
- **UI:** one shared React chat/trade component used by the web app and the extension iframe.
- **Team:** 2 engineers (frontend/backend), 1 product owner, 1 QA/ops. Phases 6–7 require at least one engineer with prior on-chain transaction infrastructure experience — plan a third engineer or contractor for the execution engine if neither current engineer qualifies.
- **Wallet keys:** secure-enclave provider only (Turnkey or Privy). Self-managed key storage is prohibited.

## 2. Phases & Timeline

| Phase | Scope & deliverable | Estimate |
|---|---|---|
| 0 — Spike | Verify CA detection on GMGN, Axiom, Padre (URL vs DOM); test host-page CSP tolerance for injected iframes; confirm SPA navigation handling; record which chains each site lists. **Deliverable:** detection report with selectors, URL patterns, CSP findings, and chain evidence. | 2 days |
| 1 — Core Backend | Room model, messages API, Postgres persistence, rate-limiting primitives, realtime adapter (managed provider), ephemeral sessions + optional WalletConnect. **Deliverable:** deployed API with docs and schema. | 2–3 weeks |
| 2 — Web App | `/room/<CA>` and `/embed/<CA>` routes, chat UI, join flow, paste-CA fallback, report/mute, presence. **Deliverable:** deployed web app + e2e happy path. | 1–2 weeks |
| 3 — Extension MVP | Manifest V3 extension for GMGN only: detection content script, sandboxed iframe injection, host permissions scoped to GMGN. **Deliverable:** extension package + internal install guide. | 2–3 weeks |
| 4 — Additional Sites | Axiom & Padre detectors, UX polish, rate-limit tuning, moderation rules finalized. **Deliverable:** public-ready extension + cross-site QA report. | 2 weeks |
| 5 — Identity & Moderation | WalletConnect expanded, verified badge, graduated rate-limit tiers, scam-link filtering, ban lists. **Deliverable:** basic moderation dashboard + procedures. | 2 weeks |
| 6 — Trading Alpha | Turnkey/Privy embedded wallet + signing policy, deposit flow, market buy/sell via aggregator, trade panel (presets), single chain, whitelist only, internal dogfooding with small real balances. **Deliverable:** whitelisted users deposit, buy, sell, and see confirmations reliably. | 3–5 weeks |
| 7 — Trading GA | Withdrawals, hotkeys, position + PnL, fee capture + accounting, Jito/MEV hardening, pen test of widget boundary, legal sign-off, Chrome Web Store re-review, open access. **Deliverable:** open-access trading with fee revenue live. | 3–5 weeks |

Chat MVP (0–5): roughly 9–12 weeks. Trading (6–7): +6–10 weeks. Chat is not blocked on trading; it validates detection, injection, and distribution, all of which trading reuses.

## 3. Task List by Role

### Backend Engineer
- Schema: `rooms`, `messages`, `identities`, `reports` tables (chain-aware CA normalization — never lowercase Solana base58 addresses).
- API: REST/WebSocket endpoints for join, send, fetch history, report, admin ban.
- Realtime: provider adapter + reconnection handling with backend-confirmed history fetch.
- Rate limits: per-identity and per-IP throttling middleware (IP as one signal, not the primary control).
- Tests: unit tests for APIs; integration test for message persistence.
- Trading (Phase 6+): key-infra adapter (Turnkey/Privy), signing policy configuration (per-tx caps, allowed programs), execution service (aggregator routing, priority fees, retries, confirmation tracking, multi-RPC failover), deposit detection, withdrawal processing, fee ledger.

### Frontend Engineer
- Shared React UI: message list, composer, presence, join flow, report/mute.
- Web app pages: `/room/<CA>`, `/embed/<CA>`, paste-CA fallback.
- Extension: URL-first detector with DOM fallback, SPA navigation watcher, iframe injection, CSS/Shadow DOM isolation.
- E2E tests: join → send → receive roundtrip; reconnect recovery; report flow.
- Trading (Phase 6+): trade panel (presets, buy/sell, hotkeys), deposit/withdraw screens, position + PnL display, hardened postMessage protocol with origin validation, in-widget trade confirmation UX.

### QA / Ops
- Run detection spike across sample pages; record failures and CSP findings.
- Smoke tests for API and web app after each phase.
- Monitor realtime connection stats, error rates; in Phase 6+, execution success rate and confirmation latency.

### Product
- Define numeric success metrics (DAU, join-to-message time, spam thresholds).
- Decide launch chain (blocking for Phase 6), fee structure, and cashback policy.
- Own moderation policy: escalation path for abuse reports, takedown contact, message-deletion authority.

## 4. Deliverables & Acceptance Criteria

| Milestone | Acceptance criteria |
|---|---|
| Spike | Detection report with sample pages, reliable selectors, CSP verdict per site, chain evidence per site. |
| Backend v1 | APIs + realtime running; messages persist and reload correctly on reconnect. |
| Web App v1 | Join and send without extension; `/embed/<CA>` works inside an iframe. |
| Extension v1 | On GMGN, widget detects CA and opens the correct room in ≥90% of test cases, including SPA navigations. |
| Moderation v1 | Reports logged server-side; blocklist and per-identity rate limits enforced. |
| Trading Alpha | Whitelisted user can deposit, execute a market buy and sell, and see confirmed status; failed txs surface a clear error; policy caps verified by test. |
| Trading GA | Withdrawals work; fees captured to ledger; pen test findings resolved; legal sign-off recorded; store re-review passed. |

## 5. Data Model

| Table | Key fields |
|---|---|
| rooms | id (chain-prefixed CA), chain, created_at, last_active_at, settings |
| messages | id, room_id, sender_id, body, metadata, created_at |
| identities | id, wallet_address (nullable), nickname, created_at, rate_limit_tier |
| reports | id, message_id, reporter_id, reason, created_at |
| bot_wallets (P6+) | id, identity_id, provider_wallet_id, chain, deposit_address, created_at |
| trades (P6+) | id, identity_id, room_id, side, amount_in, amount_out, tx_signature, status, fee_amount, created_at, confirmed_at |
| deposits / withdrawals (P6+) | id, identity_id, amount, tx_signature, status, created_at |
| fee_ledger (P7) | id, trade_id, fee_amount, cashback_amount, created_at |

## 6. CI, Testing & Monitoring

- **Repo layout:** `packages/ui`, `apps/web`, `apps/extension`, `services/backend`, `services/execution` (Phase 6+).
- **CI:** unit tests, UI build, headless e2e before staging deploy; staging auto-deploys on merge to `main`; production gated by manual promotion.
- **Testing:** unit (backend logic, components), integration (persistence, history), e2e (join/send/receive, reconnect, report), load testing of realtime assumptions. Phase 6+: execution tests against devnet/testnet, policy-cap enforcement tests, deposit/withdraw integration tests.
- **Monitoring:** realtime connections, message rate, error rates, report volume. Phase 6+: execution success rate, confirmation latency, RPC health, fee revenue. Alerts on high error rates, throughput spikes (cost risk), report spikes, and execution success below SLO.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Detection fragility (site DOM/URL changes, incl. deliberate breakage) | URL-first detection, paste-CA fallback, per-site try/catch, standalone web app as first-class product. |
| Host-page CSP blocks injected iframe | Test in spike (go/no-go per site); fallback to popup/side-panel rendering if blocked. |
| Spam / phishing in rooms | WalletConnect opt-in tiers, rate limits, scam-link blocklist, reports + bans. |
| Realtime vendor lock-in / cost | Adapter abstraction, monthly cost review, self-hosted WebSocket exit path. |
| Execution reliability (dropped txs, stale blockhashes, RPC outages) | Retry + confirmation infra, execution SLOs, multi-RPC failover, visible tx status in UI. |
| Widget signing abuse by malicious host page | Origin-locked postMessage, strict iframe sandbox, per-tx caps enforced at key-infra policy layer (defense in depth). |
| Regulatory exposure (custody / money transmission) | Non-custodial key-policy architecture (Turnkey-style); counsel review before Phase 7 GA. |
| Chrome Web Store review delays / rejections | Budget review time into Phase 7; narrow permissions; consider open-sourcing the shipped build (Frontrun's approach). |
| Competitive pressure (Frontrun ~50k users, TradeWiz, others) | Differentiate on the per-token chat/social layer; chat is the wedge, trading is monetization. |

## 8. Next Immediate Steps (First 5 Workdays)

1. **Day 1–2:** Run detection + CSP spike on GMGN, Axiom, Padre; publish findings incl. chain evidence (owner: frontend engineer).
2. **Day 1 (parallel):** Product decides launch chain — Solana vs Robinhood Chain — using spike evidence as it lands (owner: product).
3. **Day 3:** Initialize repo structure and Postgres schema with chain-aware CA normalization (owner: backend engineer).
4. **Day 4–5:** Minimal messages API + realtime adapter stub (owner: backend engineer).
5. **Day 4–5:** Bare-minimum chat UI (message list + composer) and `/embed/<CA>` route (owner: frontend engineer).
