const express = require('express');
const { query } = require('../db');
const router = express.Router();

// Merged feed of room creations and messages, newest first — powers the
// activity log on the landing page.
router.get('/', async (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  try {
    const result = await query(
      `SELECT kind, room_id, identity_id, content, created_at
       FROM (
         SELECT 'message' AS kind, m.room_id, m.identity_id, m.content, m.created_at
         FROM messages m
         UNION ALL
         SELECT 'room_created' AS kind, r.id AS room_id, NULL AS identity_id, NULL AS content, r.created_at
         FROM rooms r
       ) events
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json({
      events: result.rows.map((row) => ({
        kind: row.kind,
        roomId: row.room_id,
        identityId: row.identity_id,
        // Trimmed: this feed is public, it only needs to show a snippet.
        preview: row.content ? String(row.content).slice(0, 90) : null,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
