Token Chat (Robinhood Chain) — Monorepo

Structure
- apps/web: web application (room pages + embed route)
- apps/extension: browser extension scaffold and detectors
- packages/ui: shared React chat components
- services/backend: API, realtime adapter, Postgres schema
- docs: product docs, PRD, tasks (brief.md, prd.md, project-development.md, tasks.md)

Getting started
1. Run the detection spike (see `docs/project-development.md`).
2. Backend: set up Postgres and env from `services/backend/.env.example`.
3. Web: run the dev server in `apps/web` after installing dependencies.

