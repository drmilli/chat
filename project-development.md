Project Development Plan — Token Chat (Robinhood Chain)

Purpose
A practical development plan with phases, tasks, owners, and timelines to implement the token-scoped chat described in `brief.md` and `prd.md`. Designed for a small engineering team to ship an MVP quickly while leaving clear upgrade paths.

Assumptions
- Chain: Robinhood Chain (initial single-chain launch).
- Realtime: start with a managed provider (Supabase Realtime or Ably).
- UI: shared React chat component used inside the web app and extension iframe.
- Team: 2 engineers (frontend/backend), 1 product owner, 1 QA/operations.

Phases & Timeline (approx.)
- Spike (2 days)
  - Verify CA detection approach on GMGN, Axiom, Padre (URL vs DOM).
  - Deliverable: detection report with example selectors and URL patterns.
- Phase 1 — Core Backend (2–3 weeks)
  - Room model, messages API, persistence (Postgres), rate-limiting primitives.
  - Realtime integration with chosen managed provider + abstraction layer.
  - Identity minimal: ephemeral sessions + WalletConnect optional flow.
  - Deliverable: deployed API with docs and Postgres schema.
- Phase 2 — Web App (1–2 weeks)
  - Implement `/room/<CA>` and `/embed/<CA>` routes, chat UI, join flow, paste-CA fallback.
  - Client-side moderation controls (report/mute) and presence indicator.
  - Deliverable: deployed web app, basic e2e happy-path test.
- Phase 3 — Extension MVP (2–3 weeks)
  - Build Manifest V3 extension for GMGN only: content script for detection, inject sandboxed iframe to `/embed/<CA>`.
  - Host permissions limited to GMGN domain.
  - Deliverable: extension package and internal install guide for testing.
- Phase 4 — Additional Sites & Polishing (2 weeks)
  - Add Axiom & Padre detectors, UX polish, rate-limit tuning, finalize moderation rules.
  - Deliverable: extension public-ready, cross-site QA report.
- Phase 5 — Identity & Moderation Enhancements (2 weeks)
  - WalletConnect expanded, verified badge, graduated rate-limit tiers, advanced scam-link filtering, ban lists.
  - Deliverable: moderation dashboard (basic) and updated procedures.

Detailed Task List (by role)
- Backend Engineer
  - Schema: create `rooms`, `messages`, `identities`, `reports` tables.
  - API: REST/WebSocket endpoints for join, send, fetch history, report, admin ban.
  - Realtime: implement provider adapter + reconnection handling.
  - Rate limits: per-identity and per-IP throttling middleware.
  - Tests: unit tests for APIs and integration test for message persistence.
- Frontend Engineer
  - Shared React chat UI: message list, composer, presence, join flow, report/mute UI.
  - Web app pages: `/room/<CA>`, `/embed/<CA>`, paste-CA fallback page.
  - Extension content scripts: URL-first detector, DOM fallback, iframe injection, CSS isolation.
  - E2E tests: join → send → receive roundtrip; report flow.
- QA / Ops
  - Run detection spike across sample pages and record failures.
  - Smoke tests for deployed API and web app after each phase.
  - Monitor realtime connection stats and error rates.
- Product
  - Define numeric success metrics (DAU, join-to-message time, spam thresholds).
  - Decide single-chain vs multi-chain roadmap milestones.

Deliverables & Acceptance Criteria
- Spike: detection report with sample pages and reliable selectors.
- Backend v1: APIs and realtime running; messages persist and reload on reconnect.
- Web App v1: can join and send messages without extension; embed route works in iframe.
- Extension v1: on GMGN, widget detects CA and opens the correct room reliably in 90% of test cases.
- Moderation v1: reports create server logs; simple blocklist and per-identity rate-limits enforced.

CI / Deployment
- Repo layout: `packages/ui`, `apps/web`, `apps/extension`, `services/backend`.
- CI: run unit tests, build UI, run basic e2e (headless) before deploy to staging.
- Staging: auto-deploy on merge to `main` branch; production deploy gated by manual promotion.

QA & Testing Strategy
- Unit tests for backend business logic and frontend components.
- Integration tests for message persistence and history retrieval.
- E2E flows (Cypress or Playwright): join/send/receive, reconnect recovery, report flow.
- Load testing for realtime provider assumptions (simulate connections/messages per second).

Monitoring & Alerts
- Track: realtime connections, message rate, error rates, moderation report volume.
- Alerts: high error rates, sustained high message throughput (cost risk), sudden spike in reports.

Post-launch Ops
- Maintain a configurable blocklist for scam domains and phrases.
- Weekly review of high-volume rooms and repeat offenders; escalate to human moderation if necessary.
- Evaluate realtime vendor costs monthly; consider self-hosted websocket if cost becomes high.

Risks & Mitigations
- Detection fragility: mitigate with URL-first approach and paste-CA fallback.
- Spam/phishing: mitigate with WalletConnect opt-in, rate-limits, blocklist, and reports.
- Vendor lock-in: mitigate by implementing a clear realtime adapter abstraction.

Next Immediate Steps (first 5 workdays)
1. Run detection spike and publish results (owner: frontend engineer, 2 days).
2. Initialize repo structure and Postgres schema (owner: backend engineer, day 3).
3. Implement minimal messages API + Supabase adapter stub (owner: backend engineer, days 4–5).
4. Implement bare-minimum chat UI (message list + composer) and `/embed/<CA>` route (owner: frontend engineer, days 4–5).

Please tell me if you want this saved under a different filename or want me to open a PR including `prd.md`, `brief.md`, and `project-development.md`.