const express = require('express');
const { query } = require('../db');
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await query('SELECT id, pattern, active, created_at FROM blocklist_patterns ORDER BY created_at DESC');
    res.json({ patterns: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  const { pattern, active } = req.body;
  if (!pattern) {
    return res.status(400).json({ error: 'pattern is required' });
  }

  try {
    const result = await query(
      'INSERT INTO blocklist_patterns (pattern, active, created_at) VALUES ($1, $2, NOW()) RETURNING id, pattern, active, created_at',
      [pattern, active !== false]
    );
    res.status(201).json({ pattern: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Pattern already exists' });
    }
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  const patternId = req.params.id;
  const { pattern, active } = req.body;
  const fields = [];
  const values = [];

  if (pattern !== undefined) {
    fields.push('pattern = $' + (values.length + 1));
    values.push(pattern);
  }
  if (active !== undefined) {
    fields.push('active = $' + (values.length + 1));
    values.push(active);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  values.push(patternId);

  try {
    const result = await query(
      `UPDATE blocklist_patterns SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING id, pattern, active, created_at`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Blocklist pattern not found' });
    }
    res.json({ pattern: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  const patternId = req.params.id;
  try {
    const result = await query('DELETE FROM blocklist_patterns WHERE id = $1 RETURNING id', [patternId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Blocklist pattern not found' });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
