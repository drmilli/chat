const crypto = require('crypto');
const express = require('express');
const { query } = require('../db');
const { issue } = require('../auth/sessions');
const { buildSignInMessage, verifySignature } = require('../auth/signatures');

const router = express.Router();

const NONCE_TTL_MS = 5 * 60 * 1000;
const SIGN_IN_DOMAIN = process.env.SIGN_IN_DOMAIN || 'Token Chat';

/**
 * Issued nonces, held in memory.
 *
 * SCALING NOTE: same constraint as the SSE hub — with more than one backend
 * instance a nonce issued by one is unknown to the others. Move to Redis (or a
 * short-lived table) before scaling out.
 */
const nonces = new Map();

function pruneNonces() {
  const now = Date.now();
  for (const [key, entry] of nonces) {
    if (entry.expiresAt < now) nonces.delete(key);
  }
}

/** Anonymous session. The server picks the id so a client cannot claim someone else's. */
router.post('/guest', async (req, res, next) => {
  try {
    const identityId = `guest-${crypto.randomBytes(6).toString('hex')}`;
    await query(
      'INSERT INTO identities (id, verified, created_at) VALUES ($1, FALSE, NOW()) ON CONFLICT (id) DO NOTHING',
      [identityId]
    );
    res.status(201).json({
      token: issue({ sub: identityId, kind: 'guest' }),
      identity: { id: identityId, kind: 'guest', verified: false },
    });
  } catch (err) {
    next(err);
  }
});

/** Step 1 of wallet sign-in: hand out a single-use nonce and the exact message to sign. */
router.post('/nonce', (req, res) => {
  const { address, chain } = req.body || {};
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'address is required' });
  }

  pruneNonces();
  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const key = `${String(chain || 'evm')}:${address.toLowerCase()}`;
  nonces.set(key, { nonce, issuedAt, expiresAt: Date.now() + NONCE_TTL_MS });

  res.json({
    nonce,
    issuedAt,
    message: buildSignInMessage({ address, nonce, domain: SIGN_IN_DOMAIN, issuedAt }),
  });
});

/** Step 2: check the signature, then issue a wallet session. */
router.post('/verify', async (req, res, next) => {
  const { address, signature, chain } = req.body || {};
  if (!address || !signature) {
    return res.status(400).json({ error: 'address and signature are required' });
  }

  const key = `${String(chain || 'evm')}:${String(address).toLowerCase()}`;
  const entry = nonces.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Nonce expired or missing — request a new one.' });
  }
  // Single use: burn it now so a captured signature cannot be replayed.
  nonces.delete(key);

  const message = buildSignInMessage({
    address,
    nonce: entry.nonce,
    domain: SIGN_IN_DOMAIN,
    issuedAt: entry.issuedAt,
  });

  if (!verifySignature({ chain, message, signature, address })) {
    return res.status(401).json({ error: 'Signature does not match that address.' });
  }

  // EVM addresses are case-insensitive; base58 is not (same rule as room ids).
  const identityId = /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address;

  try {
    await query(
      `INSERT INTO identities (id, wallet_address, verified, created_at)
       VALUES ($1, $2, TRUE, NOW())
       ON CONFLICT (id) DO UPDATE SET wallet_address = EXCLUDED.wallet_address, verified = TRUE`,
      [identityId, address]
    );
    res.json({
      token: issue({ sub: identityId, kind: 'wallet', address: identityId, chain: chain || 'evm' }),
      identity: { id: identityId, kind: 'wallet', verified: true, walletAddress: address },
    });
  } catch (err) {
    next(err);
  }
});

/** Who am I? Lets the client confirm a stored token is still good. */
router.get('/me', async (req, res, next) => {
  if (!req.session) return res.status(401).json({ error: 'No session' });
  try {
    const result = await query('SELECT id, display_name, wallet_address, verified FROM identities WHERE id = $1', [
      req.session.sub,
    ]);
    const row = result.rows[0];
    res.json({
      id: req.session.sub,
      kind: req.session.kind,
      verified: Boolean(row?.verified),
      displayName: row?.display_name ?? null,
      walletAddress: row?.wallet_address ?? null,
      expiresAt: req.session.exp,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
