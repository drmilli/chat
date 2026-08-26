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
const voiceRouter = require('./routes/voice');
const { rateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const { attachSession, requireAdmin } = require('./auth/sessions');
const { createRealtimeClient } = require('./realtime/adapter');
const hub = require('./realtime/hub');
const voiceRooms = require('./voice/rooms');
const { warnIfIncomplete } = require('./voice/ice');

const app = express();

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
// Keep this in step with the verbs the routes actually expose. PUT was missing
// here while /api/identities/:id used it, so renaming failed the preflight and
// surfaced in the UI as an unexplained "network error".
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
  // Avoid a preflight before every single write.
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Populates req.session from the Authorization header (never rejects).
app.use(attachSession);
app.use(rateLimiter);

app.get('/api/health', async (req, res) => {
  try {
    const result = await query('SELECT 1 AS ok');
    res.json({
      status: 'ok',
      db: result.rows[0].ok === 1,
      realtime: hub.stats(),
      voice: voiceRooms.stats(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/api/rooms', messagesRouter);
// WebRTC signalling for live voice. Mounted on the same base as rooms so the
// room id means the same thing in both.
app.use('/api/rooms', voiceRouter);
app.use('/api/activity', activityRouter);
app.use('/api/identities', identitiesRouter);
app.use('/api/messages', audioRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/bans', requireAdmin, bansRouter);
app.use('/api/admin', requireAdmin, adminRouter);
app.use('/api/auth', authRouter);

app.use(errorHandler);

// Surfaces a missing TURN relay at boot rather than as a user who "cannot hear
// anyone" for reasons that look like a client bug.
warnIfIncomplete();

realtime.connect().catch((err) => {
  console.warn('Realtime adapter failed to connect:', err.message || err);
});

module.exports = app;
