const express = require('express');
const { query } = require('../db');
const router = express.Router();

// Merged feed of room creations and messages, newest first — powers the
// activity log on the landing page.
//
// PRIVACY: this endpoint is public and unauthenticated, so it deliberately does
// NOT return message text. It used to, which meant every message anyone posted
// was republished verbatim on the marketing page. Only the fact that a message
// happened is exposed. Set ACTIVITY_SHOW_PREVIEWS=true to opt back in.
const SHOW_PREVIEWS = process.env.ACTIVITY_SHOW_PREVIEWS === 'true';
router.get('/', async (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  try {
    const result = await query(
      `SELECT kind, room_id, identity_id, content, message_kind, created_at
       FROM (
         SELECT 'message' AS kind, m.room_id, m.identity_id, m.content, m.kind AS message_kind, m.created_at
         FROM messages m
         UNION ALL
         SELECT 'room_created' AS kind, r.id AS room_id, NULL AS identity_id, NULL AS content, NULL AS message_kind, r.created_at
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
        // Never the message body unless explicitly opted in.
        preview: SHOW_PREVIEWS && row.content ? String(row.content).slice(0, 90) : null,
        messageKind: row.message_kind || null,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
