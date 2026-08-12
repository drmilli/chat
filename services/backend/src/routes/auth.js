const express = require('express');
const { query } = require('../db');
const router = express.Router();

router.post('/wallet-connect', async (req, res, next) => {
  const { walletAddress, signature } = req.body;
  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  const identityId = walletAddress.toLowerCase();
  const verified = Boolean(signature);

  try {
    await query(
      'INSERT INTO identities (id, wallet_address, verified, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO UPDATE SET wallet_address = EXCLUDED.wallet_address, verified = EXCLUDED.verified',
      [identityId, walletAddress, verified]
    );
    res.status(201).json({
      identity: { id: identityId, walletAddress, verified },
      sessionToken: `session_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
