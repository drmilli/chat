const express = require('express');
const { query } = require('../db');
const { contentMatchesBlockedPatterns, fetchActiveBlocklistPatterns } = require('../utils/moderation');
const router = express.Router();

const MAX_NAME_LENGTH = 32;

// The identity id everyone shares before connecting a wallet. Naming it would
// rename every anonymous user at once, so it is not claimable.
const SHARED_ANONYMOUS = 'anonymous';

function cleanName(value) {
  // Strip control characters and collapse whitespace so a name cannot break the
  // layout or impersonate through padding.
  return String(value)
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query('SELECT id, display_name, wallet_address, verified FROM identities WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rowCount === 0) {
      return res.json({ id: req.params.id, displayName: null, walletAddress: null, verified: false });
    }
    const row = result.rows[0];
    res.json({
      id: row.id,
      displayName: row.display_name,
      walletAddress: row.wallet_address,
      verified: row.verified,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  const identityId = req.params.id;
  const { displayName, walletAddress } = req.body;

  if (identityId === SHARED_ANONYMOUS) {
    return res.status(400).json({ error: 'Cannot name the shared anonymous identity' });
  }

  let name = null;
  if (displayName != null && String(displayName).trim() !== '') {
    name = cleanName(displayName);
    if (name.length === 0) {
      return res.status(400).json({ error: 'Display name cannot be blank' });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `Display name must be ${MAX_NAME_LENGTH} characters or fewer` });
    }

    // A chat name is prime real estate for impersonation ("Support", a fake
    // domain), so it goes through the same blocklist as message content.
    const patterns = await fetchActiveBlocklistPatterns(query).catch(() => []);
    if (contentMatchesBlockedPatterns(name, patterns)) {
      return res.status(400).json({ error: 'That display name is blocked by moderation rules' });
    }
  }

  try {
    const result = await query(
      `INSERT INTO identities (id, wallet_address, display_name, verified, created_at)
       VALUES ($1, $2, $3, FALSE, NOW())
       ON CONFLICT (id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             wallet_address = COALESCE(EXCLUDED.wallet_address, identities.wallet_address)
       RETURNING id, display_name, wallet_address, verified`,
      [identityId, walletAddress || null, name]
    );
    const row = result.rows[0];
    res.json({ id: row.id, displayName: row.display_name, walletAddress: row.wallet_address, verified: row.verified });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
