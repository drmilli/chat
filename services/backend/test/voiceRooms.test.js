const test = require('node:test');
const assert = require('node:assert');
const voiceRooms = require('../src/voice/rooms');

const ROOM = 'room-1';
const peer = (n) => ({ peerId: `peer-${n}`, identityId: `id-${n}`, address: `0x${n}`, displayName: `User ${n}` });

test.beforeEach(() => voiceRooms.reset());

test('participants join and see each other', () => {
  const a = voiceRooms.join(ROOM, peer(1));
  assert.equal(a.peers.length, 0, 'the first participant is alone');

  const b = voiceRooms.join(ROOM, peer(2));
  assert.equal(b.peers.length, 1);
  assert.equal(b.peers[0].peerId, 'peer-1', 'the newcomer is told who to negotiate with');
});

test('everyone joins muted', () => {
  // An open microphone the user did not deliberately open is a privacy failure,
  // not a convenience.
  const { participant } = voiceRooms.join(ROOM, peer(1));
  assert.equal(participant.muted, true);
});

test('the cap counts every participant, not just speakers', () => {
  // In a mesh a silent listener still terminates a connection from every
  // speaker. "Unlimited listeners" is an SFU feature and must not be faked here.
  for (let i = 0; i < voiceRooms.MAX_PARTICIPANTS; i += 1) {
    voiceRooms.join(ROOM, peer(i));
  }
  assert.throws(
    () => voiceRooms.join(ROOM, peer(99)),
    (err) => {
      assert.equal(err.name, 'VoiceRoomFullError');
      assert.equal(err.status, 409);
      return true;
    }
  );
});

test('rejoining with the same peer id refreshes rather than consuming a slot', () => {
  // A page refresh must not cost a slot in a six-slot room.
  voiceRooms.join(ROOM, peer(1));
  voiceRooms.join(ROOM, peer(1));
  assert.equal(voiceRooms.list(ROOM).length, 1);
});

test('leaving frees the slot', () => {
  for (let i = 0; i < voiceRooms.MAX_PARTICIPANTS; i += 1) voiceRooms.join(ROOM, peer(i));
  assert.equal(voiceRooms.leave(ROOM, 'peer-0'), true);
  assert.doesNotThrow(() => voiceRooms.join(ROOM, peer(99)));
});

test('a stale participant is swept so the room cannot deadlock', () => {
  // A browser closed mid-call sends no "leave". Without this, a handful of
  // leaked slots makes the room permanently unjoinable.
  const t0 = 1_000_000;
  voiceRooms.join(ROOM, peer(1), t0);
  voiceRooms.join(ROOM, peer(2), t0);

  const later = t0 + voiceRooms.STALE_AFTER_MS + 1;
  voiceRooms.heartbeat(ROOM, 'peer-2', later);

  const dropped = voiceRooms.sweep(ROOM, later);
  assert.deepEqual(dropped, ['peer-1'], 'only the silent peer is dropped');
  assert.equal(voiceRooms.list(ROOM, later).length, 1);
});

test('the sweep reports who it dropped so tiles can be removed', () => {
  const t0 = 1_000_000;
  voiceRooms.join(ROOM, peer(1), t0);
  const dropped = voiceRooms.sweep(ROOM, t0 + voiceRooms.STALE_AFTER_MS + 1);
  assert.deepEqual(dropped, ['peer-1']);
});

test('mute state is tracked and readable', () => {
  voiceRooms.join(ROOM, peer(1));
  const updated = voiceRooms.setMuted(ROOM, 'peer-1', false);
  assert.equal(updated.muted, false);
  assert.equal(voiceRooms.list(ROOM)[0].muted, false);
});

test('muting an absent peer reports absence rather than inventing one', () => {
  assert.equal(voiceRooms.setMuted(ROOM, 'nobody', true), null);
  assert.equal(voiceRooms.heartbeat(ROOM, 'nobody'), false);
});

test('rooms are isolated from each other', () => {
  voiceRooms.join('room-a', peer(1));
  voiceRooms.join('room-b', peer(2));
  assert.equal(voiceRooms.list('room-a').length, 1);
  assert.equal(voiceRooms.has('room-a', 'peer-2'), false);
});

test('an emptied room is dropped rather than left as a husk', () => {
  voiceRooms.join(ROOM, peer(1));
  voiceRooms.leave(ROOM, 'peer-1');
  assert.equal(voiceRooms.stats().voiceRooms, 0);
});

test('the public view never leaks internal bookkeeping', () => {
  voiceRooms.join(ROOM, { ...peer(1), sessionToken: 'secret-token' });
  const [entry] = voiceRooms.list(ROOM);
  assert.equal(entry.sessionToken, undefined, 'no session material reaches other participants');
  assert.equal(entry.lastSeenAt, undefined);
  assert.deepEqual(
    Object.keys(entry).sort(),
    ['address', 'displayName', 'forcedMute', 'identityId', 'joinedAt', 'muted', 'peerId']
  );
});

// ---------- moderation ----------

test('a forced mute cannot be lifted by the participant', () => {
  // The whole point: a moderator's mute is not the muted person's to undo.
  voiceRooms.join(ROOM, peer(1));
  voiceRooms.setForcedMute(ROOM, 'peer-1', true);

  const attempted = voiceRooms.setMuted(ROOM, 'peer-1', false);
  assert.equal(attempted.muted, true, 'the self-unmute is refused');
  assert.equal(attempted.forcedMute, true);
});

test('lifting a forced mute leaves them muted rather than reopening the mic', () => {
  // Their microphone must never reopen without a deliberate press.
  voiceRooms.join(ROOM, peer(1));
  voiceRooms.setForcedMute(ROOM, 'peer-1', true);
  const released = voiceRooms.setForcedMute(ROOM, 'peer-1', false);

  assert.equal(released.forcedMute, false);
  assert.equal(released.muted, true, 'still muted until they choose otherwise');
  assert.equal(voiceRooms.setMuted(ROOM, 'peer-1', false).muted, false, 'now they can');
});

test('a forced mute is distinguishable from a self-mute', () => {
  // The UI has to tell these apart, or a moderator action reads as a choice.
  voiceRooms.join(ROOM, peer(1));
  voiceRooms.setMuted(ROOM, 'peer-1', true);
  assert.equal(voiceRooms.list(ROOM)[0].forcedMute, false);

  voiceRooms.setForcedMute(ROOM, 'peer-1', true);
  assert.equal(voiceRooms.list(ROOM)[0].forcedMute, true);
});

test('a kick blocks the identity, so refreshing does not undo it', () => {
  // Peer ids change on every reconnect. Blocking one would make a kick last
  // exactly as long as it takes to press F5.
  voiceRooms.join(ROOM, peer(1));
  voiceRooms.block(ROOM, 'id-1');
  voiceRooms.leave(ROOM, 'peer-1');

  assert.throws(
    () => voiceRooms.join(ROOM, { ...peer(1), peerId: 'a-brand-new-peer-id' }),
    (err) => {
      assert.equal(err.name, 'VoiceBlockedError');
      assert.equal(err.status, 403);
      return true;
    }
  );
});

test('a block expires on its own', () => {
  const t0 = 1_000_000;
  voiceRooms.block(ROOM, 'id-1', t0, 60_000);
  assert.ok(voiceRooms.isBlocked(ROOM, 'id-1', t0 + 59_000));
  assert.equal(voiceRooms.isBlocked(ROOM, 'id-1', t0 + 61_000), null);
  assert.doesNotThrow(() => voiceRooms.join(ROOM, peer(1), t0 + 61_000));
});

test('a moderator can lift a block early', () => {
  voiceRooms.block(ROOM, 'id-1');
  assert.equal(voiceRooms.unblock(ROOM, 'id-1'), true);
  assert.equal(voiceRooms.isBlocked(ROOM, 'id-1'), null);
  assert.doesNotThrow(() => voiceRooms.join(ROOM, peer(1)));
});

test('a block is scoped to one room', () => {
  voiceRooms.block('room-a', 'id-1');
  assert.doesNotThrow(() => voiceRooms.join('room-b', peer(1)));
});

test('blocking frees the slot for someone else', () => {
  for (let i = 0; i < voiceRooms.MAX_PARTICIPANTS; i += 1) voiceRooms.join(ROOM, peer(i));
  voiceRooms.block(ROOM, 'id-0');
  voiceRooms.leave(ROOM, 'peer-0');
  assert.doesNotThrow(() => voiceRooms.join(ROOM, peer(99)));
});

test('moderating an absent peer reports absence', () => {
  assert.equal(voiceRooms.setForcedMute(ROOM, 'nobody', true), null);
  assert.equal(voiceRooms.find(ROOM, 'nobody'), null);
});

test('find returns the public view, not internal bookkeeping', () => {
  voiceRooms.join(ROOM, { ...peer(1), sessionToken: 'secret' });
  const found = voiceRooms.find(ROOM, 'peer-1');
  assert.equal(found.identityId, 'id-1');
  assert.equal(found.sessionToken, undefined);
  assert.equal(found.lastSeenAt, undefined);
});
