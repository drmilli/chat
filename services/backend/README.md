services/backend — API and Realtime

Env: copy `.env.example` to `.env` and fill DB and realtime provider credentials.

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
npm run dev
```

Implemented endpoints:
- GET `/api/health`
- GET `/api/rooms/:id/messages?limit=50`
- POST `/api/rooms/:id/messages`
- POST `/api/reports`
- POST `/api/auth/wallet-connect`

Sprint 1 backend scope:
- Postgres schema & migrations for `rooms`, `messages`, `identities`, `reports`
- Messages API with persisted history
- Realtime adapter abstraction and publish stub
- Rate limiting middleware with IP + identity throttling
- WalletConnect optional auth flow stub
