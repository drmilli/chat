Product Requirements Document — Token Chat

Overview
A cross-platform, token-scoped chat system with one shared real-time room per token contract address (CA). Users join via a browser extension widget injected into supported token pages (GMGN, Axiom, Padre) or through a standalone web app by pasting the CA. Room identity is the CA, not the hosting platform.

Objectives (MVP)
- Provide a single, real-time chat room per token (room ID = normalized CA).
- Enable low-friction joining with optional wallet-connect for verified identity.
- Ship a browser extension (iframe widget) that auto-detects tokens on target sites and opens the matching room.
- Ship a responsive web app that opens the same room via manual CA entry.
- Provide basic moderation and anti-spam controls sufficient for v1.

Success Metrics (first 3 months)
- DAU in token rooms (target: X active rooms / Y daily unique users) — define numeric targets with product.
- Time-to-first-message after room join < 60s for 75% of sessions.
- Spam incidents per 1k messages below an acceptable threshold (to be defined).
- Extension install to first join conversion rate > 30%.

Target Users
- Token holders and traders browsing GMGN, Axiom, Padre (Robinhood Chain initial focus).
- Token teams and projects that want a low-friction room for community discussion.
- Curious web users who paste a CA into the web app to join a room.

MVP Feature List
- Room creation on first join (implicit).
- Real-time messaging with message persistence (Postgres + realtime layer).
- Extension content script that detects CA (URL-first, DOM fallback) and injects a sandboxed iframe pointing to the embed route.
- Web app route `/room/<CA>` and `/embed/<CA>` for iframe use.
- Optional WalletConnect sign-in granting a `verified` badge and relaxed rate limits.
- Anonymous nickname entry with stricter rate limits.
- Per-room rate-limiting, simple scam-link/content filters, report + client-side mute, server-side ban list.
- Basic UI: message list, message composer, presence indicator, simple moderation controls (report/mute), paste-CA fallback.

User Stories
- As a visitor on GMGN, I want the extension to open the token chat automatically so I can see and participate in conversations without leaving the page.
- As a casual user, I want to paste a CA into the web app so I can join a token room without installing the extension.
- As a token holder, I want to optionally connect my wallet to verify my identity and receive a badge.
- As a moderator, I want to mute or ban repeat offenders and configure per-room rate limits.

UX / Flows (high-level)
- Extension: detect CA → inject collapsed floating widget → user opens widget → iframe loads `/embed/<CA>` → join room flow: choose anonymous nickname or connect wallet → join.
- Web app: open site → paste CA or visit `/room/<CA>` → same join flow as widget.
- Report flow: user reports message → client hides message locally → server records report and increments offense count for potential ban.

Technical Architecture
- Frontend: shared React chat UI (Vite + TypeScript) consumed by both web app and extension iframe.
- Extension: Manifest V3, content scripts, host_permissions limited to target domains, detection modules per site.
- Backend: Node.js service + Postgres for persistence; Realtime via managed provider (Supabase Realtime or Ably) recommended for v1.
- Authentication: optional WalletConnect signature-based login; session token for transient identity.
- Hosting: cloud-hosted app and API endpoints; CDN for static assets and widget embedding.

Data Model (MVP)
- rooms: id (CA), chain, created_at, last_active_at, settings (rate limits, archived)
- messages: id, room_id, sender_id, body, metadata (links), created_at
- identities: id, wallet_address (nullable), nickname, created_at, rate_limit_tier
- reports: id, message_id, reporter_id, reason, created_at

Scaling & Realtime Strategy
- Start with a managed realtime provider (Supabase Realtime or Ably) to handle connections and reconnections quickly.
- Design an abstraction layer so the realtime implementation can be swapped for a self-hosted WebSocket solution later.
- Implement message persistence and reconnect recovery via backend-confirmed history fetch on reconnect.

Security & Moderation
- Enforce per-identity and per-IP rate limits server-side.
- Block known scam/drainer domains and suspicious patterns (configurable blocklist).
- Optional wallet verification reduces ban evasion and allows graduated rate limits.
- Scope extension permissions narrowly to the three target domains; use iframe sandboxing to isolate widget.

Privacy
- No mandatory PII collection. WalletConnect only stores public wallet addresses when user opts in.
- Allow anonymous nicknames; consider ephemeral sessions for fully anonymous users.

- Open Decisions (requires product input)
- Single-chain (Robinhood Chain-only) vs multi-chain support at launch.
- Exact spam thresholds and rate-limit tiers for anonymous vs wallet-verified users.
- Managed realtime vendor selection and cost targets.
- Moderation ownership: fully automated vs staffed moderators for high-risk rooms.

Milestones & Timeline (rough)
- Spike (1–2 days): verify CA detection approach on GMGN, Axiom, Padre.
- Phase 1 (2–3 weeks): core backend (rooms, messages, realtime integration, rate-limiting basics).
- Phase 2 (1–2 weeks): web app room UI and shareable links.
- Phase 3 (2–3 weeks): extension initial site (GMGN) with detection + iframe injection.
- Phase 4 (2 weeks): add remaining sites, polish, and basic moderation UX.

Risks
- Site DOM/URL changes breaking detectors — mitigate via URL-first approach and paste-CA fallback.
- Spam and phishing in token rooms — mitigate via wallet verification, rate-limits, and link filters.
- Vendor lock-in/cost with managed realtime — mitigate via abstraction and cost monitoring.

Next Steps
- Product to confirm chain scope and numeric success metrics.
- Engineering to run the 1–2 day detection spike and report findings.
- Start Phase 1 backend work with Supabase Realtime + Postgres integration (or chosen realtime vendor).

