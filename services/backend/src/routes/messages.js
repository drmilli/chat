const crypto = require('crypto');
const express = require('express');
const { query } = require('../db');
const hub = require('../realtime/hub');
const voiceRouter = require('./voice');
const { requireSession } = require('../auth/sessions');
const {
  contentMatchesBlockedPatterns,
  fetchActiveBlocklistPatterns,
  isBanned,
} = require('../utils/moderation');
const router = express.Router();

// Aggregate stats for the extension popup / dashboards.
router.get('/stats', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         (SELECT COUNT(*) FROM rooms) AS rooms,
         (SELECT COUNT(*) FROM messages) AS messages,
         (SELECT COUNT(*) FROM identities) AS identities,
         (SELECT COUNT(DISTINCT room_id) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours') AS active_rooms_24h,
         (SELECT COUNT(DISTINCT identity_id) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours') AS active_users_24h`
    );
    const row = result.rows[0] || {};
    res.json({
      rooms: Number(row.rooms || 0),
      messages: Number(row.messages || 0),
      identities: Number(row.identities || 0),
      activeRooms24h: Number(row.active_rooms_24h || 0),
      activeUsers24h: Number(row.active_users_24h || 0),
    });
  } catch (err) {
    next(err);
  }
});

// Recently active rooms, newest activity first.
router.get('/', async (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  try {
    const result = await query(
      `SELECT r.id,
              r.created_at,
              COUNT(m.id) AS message_count,
              COUNT(DISTINCT m.identity_id) AS participant_count,
              MAX(m.created_at) AS last_message_at
       FROM rooms r
       LEFT JOIN messages m ON m.room_id = r.id
       GROUP BY r.id
       ORDER BY COALESCE(MAX(m.created_at), r.created_at) DESC
       LIMIT $1`,
      [limit]
    );
    res.json({
      rooms: result.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        messageCount: Number(row.message_count || 0),
        participantCount: Number(row.participant_count || 0),
        lastMessageAt: row.last_message_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Lightweight detail for a single room — used by the popup dropdown before joining.
router.get('/:id/summary', async (req, res, next) => {
  const roomId = req.params.id;
  try {
    const result = await query(
      `SELECT
         (SELECT created_at FROM rooms WHERE id = $1) AS created_at,
         (SELECT COUNT(*) FROM messages WHERE room_id = $1) AS message_count,
         (SELECT COUNT(DISTINCT identity_id) FROM messages WHERE room_id = $1) AS participant_count,
         (SELECT MAX(created_at) FROM messages WHERE room_id = $1) AS last_message_at`,
      [roomId]
    );
    const row = result.rows[0] || {};
    res.json({
      id: roomId,
      exists: Boolean(row.created_at),
      createdAt: row.created_at || null,
      messageCount: Number(row.message_count || 0),
      participantCount: Number(row.participant_count || 0),
      lastMessageAt: row.last_message_at || null,
    });
  } catch (err) {
    next(err);
  }
});

// Voice note limits. Opus in WebM runs ~10-14 kB/s, so 2 MB covers well over
// the two-minute cap and still keeps rows small.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_DURATION_MS = 2 * 60 * 1000;
const ALLOWED_AUDIO_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];

function baseMime(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

// Live message stream for a room (Server-Sent Events).
// Chosen over WebSockets because delivery is one-way: clients still POST
// messages over plain HTTP, and EventSource reconnects on its own.
router.get('/:id/stream', (req, res) => {
  const roomId = req.params.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // no-transform stops proxies from buffering; X-Accel-Buffering does the
    // same for nginx, which otherwise holds the stream until it fills a buffer.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  };

  // The peer id is issued here, not accepted from the client: it is the
  // identity WebRTC signalling is addressed to, and a client that could pick
  // its own would be able to claim another participant's voice slot.
  const peerId = voiceRouter.newPeerId();

  const unsubscribe = hub.subscribe(roomId, send, { peerId });
  if (!unsubscribe) {
    send({ type: 'error', data: { error: 'Too many live connections, retry shortly' } });
    return res.end();
  }

  send({ type: 'ready', data: { roomId, peerId } });

  // Keeps proxies from culling an idle connection AND lets the client tell a
  // live stream from a silently dead one. A bare comment line would keep the
  // socket warm but stays invisible to EventSource, so this is a real event.
  const heartbeat = setInterval(() => {
    send({ type: 'ping', data: { at: Date.now() } });
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    // Releasing the voice slot here is what keeps a six-slot room usable: a
    // browser closed mid-call sends no "leave", and a handful of leaked slots
    // would make the room permanently unjoinable. The staleness sweep in
    // voice/rooms.js is only the backstop for when this never fires.
    voiceRouter.releaseOnDisconnect(roomId, peerId);
  });
});

router.get('/:id/messages', async (req, res, next) => {
  const roomId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  try {
    // Deliberately not selecting `audio` — clips are fetched per message by the
    // player, so the list stays small no matter how much voice traffic a room has.
    const result = await query(
      `SELECT m.id, m.room_id, m.identity_id, m.content, m.created_at, m.kind, m.audio_mime, m.duration_ms,
              (m.audio IS NOT NULL) AS has_audio,
              m.audio_token,
              author.display_name AS display_name,
              author.verified     AS author_verified,
              m.reply_to_id,
              parent.identity_id AS reply_to_identity,
              parent.kind        AS reply_to_kind,
              LEFT(parent.content, 120) AS reply_to_preview,
              parent_author.display_name AS reply_to_display_name
       FROM messages m
       LEFT JOIN identities author ON author.id = m.identity_id
       LEFT JOIN messages parent ON parent.id = m.reply_to_id
       LEFT JOIN identities parent_author ON parent_author.id = parent.identity_id
       WHERE m.room_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [roomId, limit]
    );
    res.json({
      roomId,
      messages: result.rows.map((row) => ({
        ...row,
        audioUrl: row.has_audio ? `/api/messages/${row.id}/audio?t=${row.audio_token}` : null,
        replyToId: row.reply_to_id,
        replyToIdentity: row.reply_to_identity,
        replyToKind: row.reply_to_kind,
        replyToPreview: row.reply_to_preview,
        displayName: row.display_name,
        verified: Boolean(row.author_verified),
        replyToDisplayName: row.reply_to_display_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/messages', requireSession, async (req, res, next) => {
  const roomId = req.params.id;
  const { content, kind, audioBase64, audioMime, durationMs, replyToId } = req.body;
  // Authorship is taken from the signed session. Accepting req.body.identityId
  // let anyone post as any wallet address.
  const identityId = req.session.sub;
  const walletAddress = req.session.address || null;
  const isVoice = kind === 'voice';

  if (!isVoice && !content) {
    return res.status(400).json({ error: 'content is required' });
  }

  let audio = null;
  if (isVoice) {
    if (!audioBase64) {
      return res.status(400).json({ error: 'audioBase64 is required for a voice message' });
    }
    if (!ALLOWED_AUDIO_MIME.includes(baseMime(audioMime))) {
      return res.status(415).json({ error: `Unsupported audio type: ${audioMime}` });
    }

    try {
      audio = Buffer.from(audioBase64, 'base64');
    } catch (err) {
      return res.status(400).json({ error: 'audioBase64 is not valid base64' });
    }
    if (audio.length === 0) {
      return res.status(400).json({ error: 'Audio payload is empty' });
    }
    if (audio.length > MAX_AUDIO_BYTES) {
      return res.status(413).json({ error: `Voice message exceeds ${Math.round(MAX_AUDIO_BYTES / 1024)}KB` });
    }
    if (durationMs && Number(durationMs) > MAX_DURATION_MS) {
      return res.status(413).json({ error: `Voice message is longer than ${MAX_DURATION_MS / 1000}s` });
    }
  }

  try {
    if (await isBanned(query, identityId, roomId)) {
      return res.status(403).json({ error: 'You are banned from this room' });
    }

    // Only text can be pattern-matched; audio is checked by human report instead.
    if (!isVoice) {
      const blocklistPatterns = await fetchActiveBlocklistPatterns(query);
      if (contentMatchesBlockedPatterns(content, blocklistPatterns)) {
        return res.status(400).json({ error: 'Message content is blocked by moderation rules' });
      }
    }

    await query(
      'INSERT INTO rooms (id, created_at) VALUES ($1, NOW()) ON CONFLICT (id) DO NOTHING',
      [roomId]
    );
    await query(
      'INSERT INTO identities (id, wallet_address, verified, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO NOTHING',
      [identityId, walletAddress || null, false]
    );
    const authorResult = await query('SELECT display_name, verified FROM identities WHERE id = $1', [identityId]);
    const authorName = authorResult.rows[0]?.display_name ?? null;
    const authorVerified = Boolean(authorResult.rows[0]?.verified);
    // A reply must point at a real message in this same room, otherwise the
    // quote would render as an empty box (or leak a message from elsewhere).
    let parent = null;
    if (replyToId != null) {
      const parentId = Number(replyToId);
      if (!Number.isInteger(parentId)) {
        return res.status(400).json({ error: 'replyToId must be a message id' });
      }
      const parentResult = await query(
        `SELECT m.id, m.identity_id, m.kind, LEFT(m.content, 120) AS preview, i.display_name
         FROM messages m LEFT JOIN identities i ON i.id = m.identity_id
         WHERE m.id = $1 AND m.room_id = $2`,
        [parentId, roomId]
      );
      if (parentResult.rowCount === 0) {
        return res.status(400).json({ error: 'replyToId does not belong to this room' });
      }
      parent = parentResult.rows[0];
    }

    const result = await query(
      `INSERT INTO messages (room_id, identity_id, content, kind, audio, audio_mime, duration_ms, reply_to_id, audio_token, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING id, room_id, identity_id, content, created_at, kind, audio_mime, duration_ms, reply_to_id, audio_token`,
      [
        roomId,
        identityId,
        isVoice ? '[voice message]' : content,
        isVoice ? 'voice' : 'text',
        audio,
        isVoice ? baseMime(audioMime) : null,
        isVoice && durationMs ? Math.round(Number(durationMs)) : null,
        parent ? parent.id : null,
        isVoice ? crypto.randomBytes(16).toString('hex') : null,
      ]
    );
    const message = {
      ...result.rows[0],
      audioUrl: isVoice ? `/api/messages/${result.rows[0].id}/audio?t=${result.rows[0].audio_token}` : null,
      // Returned inline so the sender's own message shows its quote immediately,
      // without waiting for a refetch.
      replyToId: parent ? parent.id : null,
      replyToIdentity: parent ? parent.identity_id : null,
      replyToKind: parent ? parent.kind : null,
      replyToPreview: parent ? parent.preview : null,
      replyToDisplayName: parent ? parent.display_name : null,
      displayName: authorName,
      verified: authorVerified,
    };

    // Deliver to everyone currently watching this room.
    hub.publish(roomId, { type: 'message.created', data: { message } });

    // Optional external transport (unconfigured by default).
    const realtime = req.app.locals.realtime;
    if (realtime && typeof realtime.publish === 'function') {
      realtime.publish(`room:${roomId}`, { type: 'message.created', message }).catch(() => {
        /* the SSE hub above is the delivery path that matters */
      });
    }

    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
