Sprint Tasks — Token Chat (Robinhood Chain)

Overview
This document breaks the project into sprint-sized tasks with owners, estimates, priority, and acceptance criteria. Use as a starting point for your issue tracker (GitHub/GitLab/Jira).

Sprint 0 — Spike (2 days)
- Task: CA detection spike for GMGN, Axiom, Padre
  - Owner: Frontend Engineer
  - Estimate: 2 days
  - Priority: High
  - Acceptance: document with URL patterns, DOM selectors, and at least 5 example pages per site; success criteria: URL-first detection works for >= 80% of examples.

Sprint 1 — Core Backend (2 weeks)
- Task: Postgres schema & migrations
  - Owner: Backend Engineer
  - Estimate: 1 day
  - Priority: High
  - Acceptance: migrations added, tables: `rooms`, `messages`, `identities`, `reports`.
- Task: Messages API (create, fetch history)
  - Owner: Backend Engineer
  - Estimate: 3 days
  - Priority: High
  - Acceptance: POST `/api/rooms/:id/messages`, GET `/api/rooms/:id/messages?limit=50` return persisted messages.
- Task: Realtime adapter (Supabase/Ably) + abstraction
  - Owner: Backend Engineer
  - Estimate: 3 days
  - Priority: High
  - Acceptance: message publish/subscribe works end-to-end with history reload on reconnect.
- Task: Rate limiting middleware
  - Owner: Backend Engineer
  - Estimate: 2 days
  - Priority: High
  - Acceptance: per-identity and per-IP throttling enforced in tests.
- Task: WalletConnect optional auth flow (stub)
  - Owner: Backend Engineer
  - Estimate: 2 days
  - Priority: Medium
  - Acceptance: wallet signature login issues a session token and marks identity as `verified`.

Sprint 2 — Web App (1 week)
- Task: Shared React chat UI component
  - Owner: Frontend Engineer
  - Estimate: 3 days
  - Priority: High
  - Acceptance: message list, composer, presence indicator, report/mute UI with basic styling.
- Task: `/room/<CA>` and `/embed/<CA>` routes
  - Owner: Frontend Engineer
  - Estimate: 1 day
  - Priority: High
  - Acceptance: routes load chat UI and join flow works for pasted CA.
- Task: E2E happy path tests
  - Owner: QA/Frontend
  - Estimate: 1 day
  - Priority: Medium
  - Acceptance: join/send/receive test passes headlessly.

Sprint 3 — Extension MVP (2 weeks)
- Task: Manifest V3 extension scaffold + content script
  - Owner: Frontend Engineer
  - Estimate: 3 days
  - Priority: High
  - Acceptance: extension loads in dev, content script runs on GMGN pages.
- Task: URL-first CA detector for GMGN + DOM fallback
  - Owner: Frontend Engineer
  - Estimate: 2 days
  - Priority: High
  - Acceptance: detector correctly extracts CA in >=90% of test pages.
- Task: Inject sandboxed iframe to `/embed/<CA>` (collapsed widget UI)
  - Owner: Frontend Engineer
  - Estimate: 3 days
  - Priority: High
  - Acceptance: widget opens/expands without breaking host page layout; iframe isolated.
- Task: Permissions & packaging
  - Owner: Frontend Engineer / Ops
  - Estimate: 2 days
  - Priority: Medium
  - Acceptance: host_permissions scoped to target domains; extension package documented for internal installs.

Sprint 4 — Additional Sites & Moderation (2 weeks)
- Task: Add detectors for Axiom and Padre
  - Owner: Frontend Engineer
  - Estimate: 3 days
  - Priority: High
  - Acceptance: detectors validated against sample pages.
- Task: Moderation controls: report server handler, ban list
  - Owner: Backend Engineer
  - Estimate: 4 days
  - Priority: High
  - Acceptance: reports persist; ban list prevents posting from banned identities.
- Task: Advanced link/blocklist filtering
  - Owner: Backend Engineer
  - Estimate: 3 days
  - Priority: Medium
  - Acceptance: known scam domains blocked; unit tests covering patterns.

Sprint 5 — Identity & UX polish (2 weeks)
- Task: WalletConnect production integration
  - Owner: Fullstack Engineer
  - Estimate: 4 days
  - Priority: High
  - Acceptance: users can connect wallets in production and receive `verified` badge.
- Task: Rate-limit tuning & monitoring setup
  - Owner: Backend Engineer / Ops
  - Estimate: 3 days
  - Priority: Medium
  - Acceptance: rate limits adjusted for minimal false positives; monitoring dashboards in place.
- Task: UX polish and accessibility
  - Owner: Frontend Engineer
  - Estimate: 3 days
  - Priority: Medium
  - Acceptance: basic accessibility checks pass; UI polished for extension and web.

Operational Tasks
- Task: CI pipeline (unit tests, build, e2e) — Owner: DevOps, Estimate: 3 days
- Task: Staging/Production deploy scripts & docs — Owner: DevOps, Estimate: 2 days
- Task: Monitoring & alerts setup — Owner: Ops, Estimate: 2 days

How to use
- Convert each task into issues and assign owners/labels in your tracker.
- Run the Spike first; do not start extension work until detection is validated.
- Keep acceptance criteria tight and use automated tests where possible.

Would you like me to open these as GitHub issues in a new repo or generate a checklist-style GitHub Project board CSV for import?