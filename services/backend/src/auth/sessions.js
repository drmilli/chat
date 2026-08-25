const crypto = require('crypto');

/**
 * Stateless sessions, signed with HMAC-SHA256.
 *
 * Before this existed, `identityId` was read straight from the request body, so
 * anyone could post as anyone — including somebody else's wallet address. Every
 * write now derives its author from a token the server itself issued.
 *
 * Tokens are deliberately not JWTs: no algorithm negotiation, no library, and
 * nothing to confuse. Format is `base64url(payload).base64url(hmac)`.
 */

const DEFAULT_TTL_MS = Number(process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000); // 30 days

function loadSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;

  if (process.env.NODE_ENV === 'production') {
    // Failing closed beats silently issuing tokens that die on the next deploy
    // (or, worse, that a second instance cannot verify).
    throw new Error(
      'SESSION_SECRET must be set to at least 32 characters in production. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  console.warn(
    'SESSION_SECRET is unset or too short — using an ephemeral development secret. ' +
      'All sessions are invalidated on restart.'
  );
  return crypto.randomBytes(32).toString('hex');
}

const SECRET = loadSecret();

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadB64) {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

/** @param {{ sub: string, kind: 'guest'|'wallet', address?: string, chain?: string }} claims */
function issue(claims, ttlMs = DEFAULT_TTL_MS) {
  const payload = { ...claims, iat: Date.now(), exp: Date.now() + ttlMs };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** @returns {null | { sub: string, kind: string, address?: string, chain?: string, exp: number }} */
function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  const expected = sign(payloadB64);
  // Constant-time compare so a signature cannot be discovered byte by byte.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
  if (!payload?.sub || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Attaches req.session when a valid token is present. Never rejects. */
function attachSession(req, res, next) {
  req.session = verify(readToken(req));
  next();
}

/** Rejects the request unless a valid session is present. */
function requireSession(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ error: 'Sign in required. POST /api/auth/guest for an anonymous session.' });
  }
  next();
}

/**
 * Admin access is an allowlist of wallet addresses, reusing the wallet sessions
 * from /api/auth/verify — no second credential to leak, and no admin token that
 * would end up embedded in the client bundle.
 *
 * Fails closed: with ADMIN_WALLETS unset nobody is an admin.
 */
function adminAllowlist() {
  return String(process.env.ADMIN_WALLETS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function requireAdmin(req, res, next) {
  const allowlist = adminAllowlist();
  if (allowlist.length === 0) {
    console.warn('ADMIN_WALLETS is not set — every admin request is denied.');
    return res.status(503).json({ error: 'Moderation is not configured on this server.' });
  }
  if (!req.session || req.session.kind !== 'wallet' || !req.session.address) {
    return res.status(401).json({ error: 'Connect and verify an admin wallet to use moderation.' });
  }
  if (!allowlist.includes(String(req.session.address).toLowerCase())) {
    return res.status(403).json({ error: 'This wallet is not a moderator.' });
  }
  next();
}

module.exports = { issue, verify, attachSession, requireSession, requireAdmin, adminAllowlist };
