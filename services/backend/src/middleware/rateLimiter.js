const ipCache = new Map();
const identityCache = new Map();
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS || '120', 10);
const IDENTITY_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_IDENTITY_REQUESTS || '60', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10);

function getClientKey(req) {
  return req.ip || req.headers['x-forwarded-for'] || 'unknown';
}

function getIdentityKey(req) {
  return (req.body && req.body.identityId) || req.headers['x-identity-id'] || null;
}

function applyRateLimit(cache, key, limit) {
  const now = Date.now();
  const entry = cache.get(key) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  cache.set(key, entry);
  return entry.count > limit;
}

function rateLimiter(req, res, next) {
  const clientKey = getClientKey(req);
  if (applyRateLimit(ipCache, clientKey, MAX_REQUESTS)) {
    return res.status(429).json({ error: 'Too many requests from this IP' });
  }

  const identityKey = getIdentityKey(req);
  if (identityKey && applyRateLimit(identityCache, identityKey, IDENTITY_MAX_REQUESTS)) {
    return res.status(429).json({ error: 'Too many requests from this identity' });
  }

  next();
}

module.exports = { rateLimiter };
