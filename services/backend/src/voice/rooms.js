/**
 * Voice-room presence for WebRTC mesh sessions.
 *
 * ============================ RUN ONE INSTANCE ============================
 * Presence lives in this process's memory, exactly like realtime/hub.js. For
 * voice the consequence is worse than for chat: signalling is routed through
 * the hub, so two peers on different instances never exchange an offer at all
 * and simply never hear each other. See the hub's header before scaling out.
 * ==========================================================================
 *
 * WHY THE CAP IS SIX, AND WHY IT COUNTS LISTENERS
 *
 * This is a full mesh: every participant holds a peer connection to every
 * other one. N participants means N(N-1)/2 connections, and each client
 * uploads its microphone N-1 times. At 6 that is 5 uploads per person, which a
 * normal connection carries. At 20 it is 19, which it does not.
 *
 * The cap therefore counts EVERY participant, not just the ones talking. A
 * silent listener still terminates a connection from every speaker and still
 * consumes their upload. "Speakers capped, unlimited listeners" is an SFU
 * feature, and claiming it here would produce a room that degrades for
 * everyone the moment it gets popular.
 *
 * HOW MODERATION IS ENFORCED, AND WHAT IT CANNOT DO
 *
 * Audio flows browser-to-browser and never passes through this server, so the
 * server CANNOT stop someone transmitting. A modified client told to mute can
 * simply keep sending.
 *
 * Enforcement therefore lives with the LISTENERS, not the offender. A forced
 * mute is broadcast to the room and every receiving client silences that peer's
 * audio locally; a kick makes every client tear down its connection to them and
 * refuse to renegotiate. The offender's own cooperation is never required —
 * they can shout into a socket nobody is playing.
 *
 * The block list below is keyed by identity, not peer id: a peer id changes on
 * every reconnect, so blocking one would be undone by pressing refresh.
 */

const MAX_PARTICIPANTS = Number(process.env.VOICE_MAX_PARTICIPANTS || 6);

/** How long a slot survives without a heartbeat before it is swept. */
const STALE_AFTER_MS = Number(process.env.VOICE_STALE_AFTER_MS || 45_000);

/** How long a kick keeps someone out before they may rejoin. */
const BLOCK_TTL_MS = Number(process.env.VOICE_BLOCK_TTL_MS || 15 * 60 * 1000);

/** roomId -> Map<peerId, participant> */
const rooms = new Map();

/** roomId -> Map<identityId, expiresAt> — keyed by identity so refresh cannot undo it. */
const blocks = new Map();

class VoiceBlockedError extends Error {
  constructor(until) {
    super('You have been removed from voice chat in this room.');
    this.name = 'VoiceBlockedError';
    this.status = 403;
    this.expose = true;
    this.until = until;
  }
}

class VoiceRoomFullError extends Error {
  constructor(limit) {
    super(`This voice room is full (${limit} of ${limit}).`);
    this.name = 'VoiceRoomFullError';
    this.status = 409;
    this.expose = true;
  }
}

function participantsOf(roomId) {
  let participants = rooms.get(roomId);
  if (!participants) {
    participants = new Map();
    rooms.set(roomId, participants);
  }
  return participants;
}

function publicView(participant) {
  // Never expose the session token or anything not needed to render a tile.
  return {
    peerId: participant.peerId,
    identityId: participant.identityId,
    displayName: participant.displayName,
    address: participant.address,
    muted: participant.muted,
    // Distinct from `muted`: a self-mute is the user's choice and they may undo
    // it, a forced mute is a moderator's and they may not.
    forcedMute: participant.forcedMute,
    joinedAt: participant.joinedAt,
  };
}

/** Removes expired entries and reports whether this identity is currently out. */
function isBlocked(roomId, identityId, now = Date.now()) {
  const roomBlocks = blocks.get(roomId);
  if (!roomBlocks) return null;

  const until = roomBlocks.get(identityId);
  if (!until) return null;
  if (until <= now) {
    roomBlocks.delete(identityId);
    if (roomBlocks.size === 0) blocks.delete(roomId);
    return null;
  }
  return until;
}

function block(roomId, identityId, now = Date.now(), ttlMs = BLOCK_TTL_MS) {
  let roomBlocks = blocks.get(roomId);
  if (!roomBlocks) {
    roomBlocks = new Map();
    blocks.set(roomId, roomBlocks);
  }
  const until = now + ttlMs;
  roomBlocks.set(identityId, until);
  return until;
}

function unblock(roomId, identityId) {
  const roomBlocks = blocks.get(roomId);
  if (!roomBlocks) return false;
  const removed = roomBlocks.delete(identityId);
  if (roomBlocks.size === 0) blocks.delete(roomId);
  return removed;
}

/** Sets a moderator-imposed mute the participant cannot lift themselves. */
function setForcedMute(roomId, peerId, forced, now = Date.now()) {
  const entry = rooms.get(roomId)?.get(peerId);
  if (!entry) return null;
  entry.forcedMute = Boolean(forced);
  // A forced mute also mutes; lifting it leaves them muted, so the microphone
  // never reopens without a deliberate press.
  if (forced) entry.muted = true;
  entry.lastSeenAt = now;
  return publicView(entry);
}

function find(roomId, peerId) {
  const entry = rooms.get(roomId)?.get(peerId);
  return entry ? publicView(entry) : null;
}

/**
 * Adds a participant, or refreshes an existing slot when the same peer rejoins
 * (a page refresh reuses the peer id rather than leaking the old slot).
 *
 * @throws {VoiceRoomFullError}
 */
function join(roomId, participant, now = Date.now()) {
  const blockedUntil = isBlocked(roomId, participant.identityId, now);
  if (blockedUntil) throw new VoiceBlockedError(blockedUntil);

  sweep(roomId, now);
  const participants = participantsOf(roomId);

  const existing = participants.get(participant.peerId);
  if (existing) {
    existing.lastSeenAt = now;
    return { participant: publicView(existing), peers: listOthers(roomId, participant.peerId, now) };
  }

  if (participants.size >= MAX_PARTICIPANTS) {
    throw new VoiceRoomFullError(MAX_PARTICIPANTS);
  }

  const entry = {
    ...participant,
    muted: participant.muted ?? true, // join muted; unmuting is a deliberate act
    forcedMute: false,
    joinedAt: now,
    lastSeenAt: now,
  };
  participants.set(participant.peerId, entry);

  // `now` is threaded through deliberately: listOthers -> list -> sweep, and a
  // default Date.now() anywhere in that chain would sweep the participant that
  // just joined whenever the caller supplies its own clock.
  return { participant: publicView(entry), peers: listOthers(roomId, participant.peerId, now) };
}

function leave(roomId, peerId) {
  const participants = rooms.get(roomId);
  if (!participants) return false;
  const removed = participants.delete(peerId);
  if (participants.size === 0) rooms.delete(roomId);
  return removed;
}

function setMuted(roomId, peerId, muted, now = Date.now()) {
  const entry = rooms.get(roomId)?.get(peerId);
  if (!entry) return null;
  // A moderator's mute outranks the participant's own control of it.
  if (entry.forcedMute && !muted) return publicView(entry);
  entry.muted = Boolean(muted);
  entry.lastSeenAt = now;
  return publicView(entry);
}

function heartbeat(roomId, peerId, now = Date.now()) {
  const entry = rooms.get(roomId)?.get(peerId);
  if (!entry) return false;
  entry.lastSeenAt = now;
  return true;
}

function list(roomId, now = Date.now()) {
  sweep(roomId, now);
  // Deliberately NOT participantsOf(): that creates the room if missing, so
  // merely *reading* an unknown room allocated a permanent empty Map. The
  // participants endpoint is public and unauthenticated, so anyone could grow
  // this map without bound by enumerating room ids. Reads must not allocate.
  const participants = rooms.get(roomId);
  return participants ? [...participants.values()].map(publicView) : [];
}

function listOthers(roomId, peerId, now = Date.now()) {
  return list(roomId, now).filter((entry) => entry.peerId !== peerId);
}

function has(roomId, peerId) {
  return Boolean(rooms.get(roomId)?.has(peerId));
}

/**
 * Drops slots whose owner stopped heartbeating.
 *
 * A browser that is closed mid-call sends no "leave", and with only six slots
 * a handful of leaks makes the room permanently unjoinable. The SSE stream
 * closing is the primary signal (routes/messages.js releases the slot there);
 * this is the backstop for when that never fires.
 *
 * @returns {string[]} peer ids that were removed, so the caller can announce them
 */
function sweep(roomId, now = Date.now()) {
  const participants = rooms.get(roomId);
  if (!participants) return [];

  const dropped = [];
  for (const [peerId, entry] of participants) {
    if (now - entry.lastSeenAt > STALE_AFTER_MS) {
      participants.delete(peerId);
      dropped.push(peerId);
    }
  }
  if (participants.size === 0) rooms.delete(roomId);
  return dropped;
}

function stats() {
  let participants = 0;
  for (const room of rooms.values()) participants += room.size;
  return { voiceRooms: rooms.size, participants, maxPerRoom: MAX_PARTICIPANTS };
}

/** Test seam. */
function reset() {
  rooms.clear();
  blocks.clear();
}

module.exports = {
  join, leave, setMuted, setForcedMute, heartbeat, list, listOthers, has, find,
  block, unblock, isBlocked, sweep, stats, reset,
  VoiceRoomFullError, VoiceBlockedError,
  MAX_PARTICIPANTS, STALE_AFTER_MS, BLOCK_TTL_MS,
};
