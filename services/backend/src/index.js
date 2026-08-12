require('dotenv').config();
const express = require('express');
const { query } = require('./db');
const messagesRouter = require('./routes/messages');
const reportsRouter = require('./routes/reports');
const bansRouter = require('./routes/bans');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const activityRouter = require('./routes/activity');
const identitiesRouter = require('./routes/identities');
const audioRouter = require('./routes/audio');
const { rateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const { createRealtimeClient } = require('./realtime/adapter');
const hub = require('./realtime/hub');

const app = express();
const port = process.env.PORT || 3000;

// Do not advertise the framework.
app.disable('x-powered-by');

// Behind a proxy/CDN every request otherwise arrives with the proxy's IP, so
// the whole internet shares one rate-limit bucket. Opt in explicitly: enabling
// this without a proxy in front would let clients spoof X-Forwarded-For.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(hops) ? hops : process.env.TRUST_PROXY);
}
const realtime = createRealtimeClient();
app.locals.realtime = realtime;

// Voice notes arrive as base64 in JSON; the default 100kb limit is far too small.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '8mb' }));

// The extension popup runs on a chrome-extension:// origin, so it needs CORS
// headers to reach this API directly (the web app goes through the Vite proxy).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(rateLimiter);

app.get('/api/health', async (req, res) => {
  try {
    const result = await query('SELECT 1 AS ok');
    res.json({ status: 'ok', db: result.rows[0].ok === 1, realtime: hub.stats() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/api/rooms', messagesRouter);
app.use('/api/activity', activityRouter);
app.use('/api/identities', identitiesRouter);
app.use('/api/messages', audioRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/bans', bansRouter);
app.use('/api/admin', adminRouter);
app.use('/api/auth', authRouter);

app.use(errorHandler);

realtime.connect().catch((err) => {
  console.warn('Realtime adapter failed to connect:', err.message || err);
});

// A rejected promise somewhere in a handler should not take the API down with
// it. Run under a supervisor in production so genuine crashes still restart.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (service continues):', reason);
});

app.listen(port, () => {
  console.log(`Backend service listening on http://localhost:${port}`);
});
