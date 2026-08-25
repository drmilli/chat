const express = require('express');
const { query } = require('../db');
const { requireSession } = require('../auth/sessions');
const router = express.Router();

router.post('/', requireSession, async (req, res, next) => {
  const identityId = req.session.sub;
  const { roomId, messageId, reason } = req.body;
  if (!roomId || !reason) {
    return res.status(400).json({ error: 'roomId and reason are required' });
  }

  try {
    const result = await query(
      'INSERT INTO reports (identity_id, room_id, message_id, reason, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, identity_id, room_id, message_id, reason, created_at',
      [identityId || null, roomId, messageId || null, reason]
    );
    res.status(201).json({ report: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
