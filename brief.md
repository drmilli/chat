Token Chat — Engineering Brief
Cross-platform, token-scoped chat rooms via browser extension + web app
1. Product Summary
A chat room exists per token, keyed by contract address (CA). A browser extension injects a chat widget into GMGN, Axiom, and Padre when a user is viewing a token page; a standalone web app lets anyone join the same room by pasting a token address directly. Whether a user arrives via extension or web, they land in the same room for that token — the room's identity is the CA, not the platform.
1.1 Goals
●One shared, real-time chat room per token, addressable by contract address.
●Extension auto-detects the active token page on supported sites and opens the matching room with zero setup.
●Web app provides the same room via manual CA entry — works without the extension installed.
●Low-friction join (no mandatory signup) balanced against spam/bot resistance.
1.2 Non-Goals (v1)
●Trading, wallet transactions, or order execution inside the chat.
●Deep integration with each site's own UI beyond a floating/embedded widget.
●Native mobile app (extension + responsive web only for v1).
2. System Architecture
Three components share one backend:
Component	Role	Stack (proposed)
Browser Extension	Detects token address on GMGN/Axiom/Padre, injects chat widget iframe	Manifest V3, content scripts, TypeScript
Web App	Standalone room access via CA input; same UI as widget	React (Vite), TypeScript
Backend	Room management, message relay, presence, moderation	Node.js, WebSocket (Ably/Supabase Realtime), Postgres

Both the extension widget and the web app render the same chat UI component (shared React package) against the same backend API — this avoids building and maintaining two chat clients.
3. Browser Extension
3.1 Token Detection
Each site formats token pages differently, so detection is per-site and brittle by nature. Recommended approach: content script matches on URL pattern first (fast, resilient to minor DOM changes), falls back to DOM scraping for the CA if the URL doesn't contain it directly.
Site	Detection strategy (to verify)	Risk
GMGN	CA typically in URL path (/token/<chain>/<address>)	Low — URL-based
Axiom	May require DOM query for CA (check page structure)	Medium — DOM-dependent, breaks on redesign
Padre	May require DOM query for CA (check page structure)	Medium — DOM-dependent, breaks on redesign

●Action item: spend a focused spike (1–2 days) confirming actual URL/DOM structure on each site before committing to detection logic — do not assume URL-based detection works for all three.
●Resilience: wrap each site's detector in a try/catch with a manual fallback (small "paste CA" input in the widget) so a broken detector degrades gracefully instead of breaking the widget.
3.2 Injection
●Content script injects a fixed-position floating widget (collapsed by default, expandable) — avoid interfering with host site layout/CSS.
●Widget renders in a sandboxed iframe pointed at the web app's room route (e.g. chat.yourapp.com/embed/<CA>) — this reuses the same chat UI/backend without duplicating logic in the extension bundle.
●Shadow DOM or iframe isolation required to prevent host-site CSS from leaking into the widget.
3.3 Permissions
●host_permissions scoped to the three target domains only, not <all_urls> — minimizes review friction and user distrust at install.
●No access to page content beyond what's needed to read the token address.
4. Web App
●Single input: paste/enter a token address → routes to /room/<CA>.
●Same room state as the extension widget for that CA (shared backend, no separate data path).
●Shareable room URLs (e.g. for a token's official Telegram/X to link directly into the chat).
5. Backend
5.1 Room Model
●Room ID = normalized token contract address (lowercase, chain-prefixed if supporting multiple chains, e.g. sol:<address>, eth:<address>).
●Rooms are created implicitly on first join — no pre-registration step.
●Consider TTL/archival for rooms with zero activity for N days to control storage growth.
5.2 Real-Time Layer
Options, in order of build speed vs. control tradeoff:
Option	Pros	Cons
Managed (Ably / Supabase Realtime / Pusher)	Fast to ship, handles scaling/reconnects	Ongoing cost per connection/message, vendor lock-in
Self-hosted WebSocket (Node + ws/socket.io)	Full control, cheaper at scale	You own scaling, reconnection logic, and infra ops

●Recommendation: start managed (Supabase Realtime pairs well with Postgres for message history and is cheap at early volume); revisit self-hosting only if cost or control becomes a real constraint at scale.
5.3 Identity & Auth
Open decision — affects spam resistance significantly:
●Anonymous with nickname: lowest friction, highest spam/bot risk.
●Wallet-connect (sign message, no transaction): moderate friction, ties identity to an on-chain address, enables holder-gated features later (e.g. "verified holder" badge).
●Recommended: wallet-connect optional at launch — anonymous entry allowed but rate-limited harder; connected wallets get higher message-rate limits and a badge. Gives a spam-control lever without a hard signup wall.
5.4 Moderation & Anti-Spam
●Per-room rate limiting (messages/minute per identity/IP).
●Basic content filter for known scam patterns (links to common drainer domains, impersonation phrases) — token chats are a high-value phishing target.
●Report + mute (client-side hide) at minimum for v1; server-side ban list per room for repeat offenders.
●Wallet-linked identities make ban evasion harder than pure anonymous — reinforces the identity recommendation above.
6. Data Model (initial)
Table	Key fields
rooms	id (CA), chain, created_at, last_active_at
messages	id, room_id, sender_id, body, created_at
identities	id, wallet_address (nullable), nickname, created_at, reputation/rate_limit_tier
reports	id, message_id, reporter_id, reason, created_at
7. Open Decisions (need Milli's input before build)
●Confirm detection mechanism per site (URL vs DOM) — needs the spike in 3.1 before extension work starts.
●Identity model: anonymous / wallet-connect / hybrid (recommend hybrid, see 5.3).
●Realtime backend: managed vs self-hosted (recommend managed to start, see 5.2).
●Single-chain (Solana, given GMGN/Axiom/Padre are Solana-focused) or multi-chain from v1?
●Moderation ownership: automated only, or human moderators for high-volume rooms?
8. Suggested Build Sequence
Phase	Scope
0 — Spike	Confirm token-address detection on GMGN, Axiom, Padre (URL vs DOM per site)
1 — Core backend	Room model, WebSocket relay, message persistence, basic rate limiting
2 — Web app	CA input → room UI, shareable room links
3 — Extension (single site)	Ship on one site first (e.g. GMGN) to validate injection + detection end-to-end
4 — Extension (remaining sites)	Add Axiom, Padre once pattern is proven
5 — Identity + moderation	Wallet-connect, rate-limit tiers, report/mute, scam-link filtering
