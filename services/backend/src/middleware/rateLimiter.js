/**
 * Per-IP and per-identity throttling.
 *
 * Tiers (T-205): a wallet that has proved ownership is a far weaker spam signal
 * than an anonymous guest, so it gets a higher allowance. IP is one signal, not
 * the primary control — a whole office can share one.
 *
 * SCALING NOTE: counters live in this process's memory (see realtime/hub.js).
 */
const ipCache = new Map();
const identityCache = new Map();

const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS || '120', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10);

const TIERS = {
  guest: parseInt(process.env.RATE_LIMIT_GUEST_REQUESTS || '30', 10),
  wallet: parseInt(process.env.RATE_LIMIT_WALLET_REQUESTS || '120', 10),
  // Anything without a session at all (reads) falls back to the IP limit only.
  anonymous: parseInt(process.env.RATE_LIMIT_IDENTITY_REQUESTS || '60', 10),
};

function getClientKey(req) {
  return req.ip || req.headers['x-forwarded-for'] || 'unknown';
}

/** The tier a request is entitled to, derived from its verified session. */
function tierFor(req) {
  if (req.session?.kind === 'wallet') return 'wallet';
  if (req.session?.kind === 'guest') return 'guest';
  return 'anonymous';
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

/** Stops the maps growing without bound on a long-lived process. */
function prune(cache) {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.start > WINDOW_MS * 2) cache.delete(key);
  }
}

let lastPrune = Date.now();

function rateLimiter(req, res, next) {
  if (Date.now() - lastPrune > WINDOW_MS) {
    prune(ipCache);
    prune(identityCache);
    lastPrune = Date.now();
  }

  if (applyRateLimit(ipCache, getClientKey(req), MAX_REQUESTS)) {
    res.setHeader('Retry-After', Math.ceil(WINDOW_MS / 1000));
    return res.status(429).json({ error: 'Too many requests from this IP' });
  }

  // Identity limits only apply to a session; reads by anonymous visitors are
  // governed by the IP limit above.
  const identityId = req.session?.sub;
  if (identityId) {
    const tier = tierFor(req);
    if (applyRateLimit(identityCache, identityId, TIERS[tier])) {
      res.setHeader('Retry-After', Math.ceil(WINDOW_MS / 1000));
      return res.status(429).json({
        error:
          tier === 'guest'
            ? 'Slow down. Connect a wallet to raise your limit.'
            : 'Too many requests — slow down.',
        tier,
      });
    }
  }

  next();
}

module.exports = { rateLimiter, tierFor, TIERS };
