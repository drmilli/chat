const express = require('express');
const { query } = require('../db');
const router = express.Router();

router.post('/', async (req, res, next) => {
  const { identityId, roomId, reason, expiresAt } = req.body;
  if (!reason) {
    return res.status(400).json({ error: 'reason is required' });
  }

  try {
    const result = await query(
      'INSERT INTO bans (identity_id, room_id, reason, expires_at, active, created_at) VALUES ($1, $2, $3, $4, true, NOW()) RETURNING id, identity_id, room_id, reason, expires_at, active, created_at',
      [identityId || null, roomId || null, reason, expiresAt || null]
    );
    res.status(201).json({ ban: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await query('SELECT id, identity_id, room_id, reason, expires_at, active, created_at FROM bans ORDER BY created_at DESC LIMIT 100');
    res.json({ bans: result.rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  const banId = req.params.id;
  const { active, expiresAt, reason } = req.body;
  const updates = [];
  const values = [];

  if (active !== undefined) {
    updates.push('active = $' + (values.length + 1));
    values.push(active);
  }
  if (expiresAt !== undefined) {
    updates.push('expires_at = $' + (values.length + 1));
    values.push(expiresAt);
  }
  if (reason !== undefined) {
    updates.push('reason = $' + (values.length + 1));
    values.push(reason);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields provided to update' });
  }

  values.push(banId);

  try {
    const result = await query(
      `UPDATE bans SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING id, identity_id, room_id, reason, expires_at, active, created_at`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ban not found' });
    }
    res.json({ ban: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  const banId = req.params.id;
  try {
    const result = await query('DELETE FROM bans WHERE id = $1 RETURNING id', [banId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ban not found' });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
