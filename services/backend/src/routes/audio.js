const crypto = require('crypto');
const express = require('express');
const { query } = require('../db');
const router = express.Router();

/**
 * Serves the audio bytes for one voice message. Kept off the message list
 * endpoint so a room full of voice notes still returns a small JSON payload.
 *
 * Requires the per-message token (`?t=`). Without it the id space was walkable:
 * /api/messages/6/audio returned somebody's voice note to anyone who guessed.
 * The token travels in the URL because <audio src> cannot send headers.
 */
router.get('/:messageId/audio', async (req, res, next) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (!Number.isInteger(messageId)) {
    return res.status(400).json({ error: 'Invalid message id' });
  }

  try {
    const result = await query('SELECT audio, audio_mime, audio_token FROM messages WHERE id = $1', [messageId]);
    const row = result.rows[0];
    if (!row || !row.audio) {
      return res.status(404).json({ error: 'No audio for this message' });
    }

    const supplied = String(req.query.t || '');
    const expected = String(row.audio_token || '');
    const ok =
      expected.length > 0 &&
      supplied.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!ok) {
      // 404, not 403: a wrong token should not confirm the clip exists.
      return res.status(404).json({ error: 'No audio for this message' });
    }

    res.setHeader('Content-Type', row.audio_mime || 'audio/webm');
    res.setHeader('Content-Length', row.audio.length);
    res.setHeader('Accept-Ranges', 'none');
    // Message audio is immutable once posted.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(row.audio);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
