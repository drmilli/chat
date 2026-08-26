/**
 * WebRTC signalling for live voice rooms.
 *
 * The server never touches audio. It relays three kinds of small JSON blob —
 * offer, answer, ICE candidate — between browsers that then connect directly.
 * Media goes peer-to-peer (or via TURN when NAT forces a relay), never through
 * here.
 *
 * Transport: signals arrive as POSTs and leave over the existing SSE stream,
 * addressed to one peer via hub.publishToPeer. No WebSocket server needed —
 * signalling is low-volume and bursty, and EventSource already reconnects on
 * its own.
 *
 * WHO MAY JOIN: verified wallets only. Not for revenue — for moderation. A mute
 * or a ban has to attach to something more durable than a browser tab, and live
 * audio cannot be scanned by the blocklist that guards text. Guests can see who
 * is talking and are invited to connect; they cannot open a microphone.
 */

const express = require('express');
const crypto = require('crypto');
const hub = require('../realtime/hub');
const voiceRooms = require('../voice/rooms');
const { iceServers } = require('../voice/ice');
const { requireAdmin, isAdminSession } = require('../auth/sessions');
const { isBanned } = require('../utils/moderation');
const { query } = require('../db');

const router = express.Router();

/** Signal payloads are small; anything larger is not a legitimate SDP or candidate. */
const MAX_SIGNAL_BYTES = Number(process.env.VOICE_MAX_SIGNAL_BYTES || 16_384);

const SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate', 'bye']);

/**
 * Voice requires a verified wallet session (see the header). Guests get a 403
 * that names the reason, so the UI can render "connect a wallet to join"
 * instead of a generic failure.
 */
function requireVerifiedWallet(req, res, next) {
  const session = req.session;
  if (!session) {
    return res.status(401).json({ error: 'Sign in before joining voice chat.' });
  }
  if (session.kind !== 'wallet' || !session.address) {
    return res.status(403).json({
      error: 'Connect and verify a wallet to join voice chat.',
      reason: 'wallet_required',
    });
  }
  next();
}

/** The peer id is the client's SSE stream identity, not something it may invent. */
function requireLivePeer(req, res, next) {
  const { roomId } = req.params;
  const peerId = req.body?.peerId;

  if (!peerId || typeof peerId !== 'string') {
    return res.status(400).json({ error: 'peerId is required.' });
  }
  // Signalling to a peer with no live stream can never complete, and letting a
  // caller act as an arbitrary peer id would let it hijack another's slot.
  if (!hub.hasPeer(roomId, peerId)) {
    return res.status(409).json({
      error: 'No live connection for this peer. Reconnect and try again.',
      reason: 'stream_closed',
    });
  }
  req.peerId = peerId;
  next();
}

router.use('/:roomId/voice', (req, res, next) => {
  req.params.roomId = req.params.roomId;
  next();
});

/**
 * Joins the mesh. Returns the peers already present so the newcomer can start
 * negotiating, plus ICE servers.
 */
router.post('/:roomId/voice/join', requireVerifiedWallet, requireLivePeer, async (req, res, next) => {
  const { roomId } = req.params;
  const peerId = req.peerId;

  try {
    // A room ban covers voice too. Without this, someone banned from posting
    // could still hold the floor out loud, which is the louder abuse.
    if (await isBanned(query, req.session.identityId, roomId)) {
      return res.status(403).json({ error: 'You are banned from this room.', reason: 'banned' });
    }

    const { participant, peers } = voiceRooms.join(roomId, {
      peerId,
      identityId: req.session.identityId,
      address: req.session.address,
      displayName: req.body?.displayName || null,
    });

    // Tell the room. Existing peers do NOT offer on hearing this — the
    // initiator rule below decides who does, so a pair never both offer.
    hub.publish(roomId, { type: 'voice-peer-joined', data: { participant } });

    res.status(201).json({
      participant,
      peers,
      // Deterministic, symmetric, and computable by both sides without a round
      // trip: for any pair the larger peer id creates the offer. Join order
      // cannot be used because two peers can join at the same moment and each
      // would see the other as "already there", so both would offer and the
      // negotiation would collide (SDP glare).
      initiatorRule: 'higher-peer-id-offers',
      ...iceServers(peerId),
      maxParticipants: voiceRooms.MAX_PARTICIPANTS,
      // Decides whether moderation controls are drawn. The authority is
      // requireAdmin on /moderate — this never grants anything by itself.
      canModerate: isAdminSession(req.session),
    });
  } catch (err) {
    if (err instanceof voiceRooms.VoiceBlockedError) {
      return res.status(403).json({ error: err.message, reason: 'voice_blocked', until: err.until });
    }
    if (err instanceof voiceRooms.VoiceRoomFullError) {
      return res.status(409).json({
        error: err.message,
        reason: 'room_full',
        maxParticipants: voiceRooms.MAX_PARTICIPANTS,
      });
    }
    next(err);
  }
});

/** Relays one signalling blob to exactly one peer. */
router.post('/:roomId/voice/signal', requireVerifiedWallet, requireLivePeer, (req, res) => {
  const { roomId } = req.params;
  const from = req.peerId;
  const { to, signal } = req.body || {};

  if (!to || typeof to !== 'string') {
    return res.status(400).json({ error: 'A signal must name its recipient.' });
  }
  if (!signal || !SIGNAL_TYPES.has(signal.type)) {
    return res.status(400).json({ error: `signal.type must be one of ${[...SIGNAL_TYPES].join(', ')}.` });
  }
  // Only participants may signal, or an observer could inject offers into a
  // call it never joined.
  if (!voiceRooms.has(roomId, from)) {
    return res.status(403).json({ error: 'Join the voice room before signalling.', reason: 'not_joined' });
  }
  if (!voiceRooms.has(roomId, to)) {
    return res.status(404).json({ error: 'That peer is not in this voice room.', reason: 'peer_gone' });
  }

  const size = Buffer.byteLength(JSON.stringify(signal));
  if (size > MAX_SIGNAL_BYTES) {
    return res.status(413).json({ error: `Signal too large (${size} bytes).` });
  }

  voiceRooms.heartbeat(roomId, from);

  const delivered = hub.publishToPeer(roomId, to, {
    type: 'voice-signal',
    data: { from, signal },
  });

  // A signal that was not delivered means the peer vanished between our
  // presence check and now. Say so rather than returning 200 and letting the
  // caller wait out an ICE timeout that will never resolve.
  if (!delivered) {
    return res.status(404).json({ error: 'That peer just disconnected.', reason: 'peer_gone' });
  }

  res.status(202).json({ delivered: true });
});

/** Mute state is presence, not media — the track is muted client-side too. */
router.post('/:roomId/voice/mute', requireVerifiedWallet, requireLivePeer, (req, res) => {
  const { roomId } = req.params;
  const participant = voiceRooms.setMuted(roomId, req.peerId, req.body?.muted);
  if (!participant) return res.status(404).json({ error: 'You are not in this voice room.' });

  hub.publish(roomId, { type: 'voice-peer-updated', data: { participant } });
  res.json({ participant });
});

/** Keeps the slot alive; the sweep reclaims slots that stop reporting. */
router.post('/:roomId/voice/heartbeat', requireVerifiedWallet, requireLivePeer, (req, res) => {
  const { roomId } = req.params;
  const alive = voiceRooms.heartbeat(roomId, req.peerId);
  if (!alive) return res.status(404).json({ error: 'You are not in this voice room.', reason: 'not_joined' });

  announceSwept(roomId);
  res.json({ ok: true, participants: voiceRooms.list(roomId) });
});

/**
 * Moderator actions against one participant.
 *
 * WHAT THIS CAN AND CANNOT DO. Audio is peer-to-peer, so the server cannot stop
 * anyone transmitting — a modified client told to mute can keep sending. What
 * it can do is tell every OTHER client to stop listening, which is enforced by
 * the receivers and needs no cooperation from the offender.
 *
 * `mute`   — every client silences that peer locally; the target's own client
 *            also disables its track and cannot lift the mute itself.
 * `kick`   — every client drops its connection and refuses to renegotiate, and
 *            the identity is blocked from rejoining for a cooling-off period.
 */
router.post('/:roomId/voice/moderate', requireAdmin, (req, res) => {
  const { roomId } = req.params;
  const { peerId, action } = req.body || {};

  if (!peerId || typeof peerId !== 'string') {
    return res.status(400).json({ error: 'peerId is required.' });
  }

  const target = voiceRooms.find(roomId, peerId);
  if (!target) return res.status(404).json({ error: 'That peer is not in this voice room.' });

  if (action === 'mute' || action === 'unmute') {
    const participant = voiceRooms.setForcedMute(roomId, peerId, action === 'mute');
    hub.publish(roomId, { type: 'voice-peer-updated', data: { participant, moderated: true } });
    return res.json({ participant });
  }

  if (action === 'kick') {
    // Blocked by identity, not peer id: a peer id changes on every reconnect,
    // so a peer-keyed block would be undone by pressing refresh.
    const until = voiceRooms.block(roomId, target.identityId);
    voiceRooms.leave(roomId, peerId);
    hub.publish(roomId, {
      type: 'voice-peer-kicked',
      data: { peerId, identityId: target.identityId, until },
    });
    return res.json({ peerId, until });
  }

  res.status(400).json({ error: 'action must be one of mute, unmute, kick.' });
});

/** Lifts a kick before its cooling-off period expires. */
router.post('/:roomId/voice/unblock', requireAdmin, (req, res) => {
  const { identityId } = req.body || {};
  if (!identityId) return res.status(400).json({ error: 'identityId is required.' });
  res.json({ unblocked: voiceRooms.unblock(req.params.roomId, identityId) });
});

router.post('/:roomId/voice/leave', requireVerifiedWallet, (req, res) => {
  const { roomId } = req.params;
  const peerId = req.body?.peerId;
  if (!peerId) return res.status(400).json({ error: 'peerId is required.' });

  if (voiceRooms.leave(roomId, peerId)) {
    hub.publish(roomId, { type: 'voice-peer-left', data: { peerId } });
  }
  res.json({ ok: true });
});

/** Public: guests may see who is talking, which is what invites them to connect. */
router.get('/:roomId/voice/participants', (req, res) => {
  const { roomId } = req.params;
  announceSwept(roomId);
  res.json({
    participants: voiceRooms.list(roomId),
    maxParticipants: voiceRooms.MAX_PARTICIPANTS,
  });
});

/** Announces anything the sweep reclaimed, so tiles do not linger for a dead peer. */
function announceSwept(roomId) {
  for (const peerId of voiceRooms.sweep(roomId)) {
    hub.publish(roomId, { type: 'voice-peer-left', data: { peerId, reason: 'timeout' } });
  }
}

/** Called when an SSE stream closes — the primary way a slot is released. */
function releaseOnDisconnect(roomId, peerId) {
  if (!peerId) return;
  if (voiceRooms.leave(roomId, peerId)) {
    hub.publish(roomId, { type: 'voice-peer-left', data: { peerId, reason: 'disconnected' } });
  }
}

/** Peer ids are server-issued so a client cannot claim someone else's slot. */
function newPeerId() {
  return crypto.randomBytes(9).toString('base64url');
}

module.exports = router;
module.exports.releaseOnDisconnect = releaseOnDisconnect;
module.exports.newPeerId = newPeerId;
