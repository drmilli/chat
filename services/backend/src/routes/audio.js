const express = require('express');
const { query } = require('../db');
const router = express.Router();

// Serves the audio bytes for one voice message. Kept off the message list
// endpoint so a room full of voice notes still returns a small JSON payload.
router.get('/:messageId/audio', async (req, res, next) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (!Number.isInteger(messageId)) {
    return res.status(400).json({ error: 'Invalid message id' });
  }

  try {
    const result = await query('SELECT audio, audio_mime FROM messages WHERE id = $1', [messageId]);
    const row = result.rows[0];
    if (!row || !row.audio) {
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
