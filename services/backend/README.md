services/backend — API and Realtime

Env: copy `.env.example` to `.env` and fill in the values. Never put real
credentials in `.env.example` — it is not gitignored.

Install dependencies:

```bash
cd services/backend
npm install
```

Run migrations:

```bash
npm run migrate
```

Start development server:

```bash
npm run dev      # runs src/
npm start        # runs dist/ — run `npm run build` first
```

Endpoints:
- GET `/api/health` — also reports live-stream subscriber counts
- GET `/api/rooms` · GET `/api/rooms/stats` · GET `/api/rooms/:id/summary`
- GET `/api/rooms/:id/messages?limit=50`
- POST `/api/rooms/:id/messages` — text, voice, and replies
- **GET `/api/rooms/:id/stream`** — Server-Sent Events for live messages
- GET `/api/messages/:id/audio` — voice clip bytes
- GET/PUT `/api/identities/:id` — display names
- GET `/api/activity`
- POST `/api/reports` · `/api/bans` · `/api/admin/blocklist`
- POST `/api/auth/wallet-connect` (stub — issues an unverified token)

Realtime:
- Messages are delivered over SSE. Clients still POST normally; the stream is
  one-way, so no WebSocket upgrade is needed and `EventSource` handles retries.
- The server emits a `ping` event every 25s. It is a real event, not a comment,
  so the client can tell a live stream from one a proxy is holding open after
  the upstream died.
- **Single instance only.** Subscribers live in this process's memory
  (`src/realtime/hub.js`), so with more than one replica a message reaches only
  the clients connected to the same instance. Scaling out needs a shared bus
  (Redis pub/sub, or Postgres LISTEN/NOTIFY over a NON-pooled connection — the
  Neon `-pooler` host does not support it).
- `SSE_MAX_CLIENTS` (default 2000) caps concurrent streams per process.

Known gaps before production:
- `/api/admin/*` and `/api/bans` have **no authentication**.
- `identityId` is taken from the request body and never verified, so anyone can
  post as any wallet address. Needs sign-in-with-wallet.
- `CORS_ORIGIN` defaults to `*`.
- Rate limiting is in-memory and per-process; it resets on deploy and does not
  work across replicas.
- Voice clips are stored as `bytea` in Postgres and served without auth.
