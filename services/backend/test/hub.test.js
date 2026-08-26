const test = require('node:test');
const assert = require('node:assert');
const hub = require('../src/realtime/hub');

function collector() {
  const events = [];
  const fn = (event) => events.push(event);
  fn.events = events;
  return fn;
}

test('broadcasts reach every subscriber in the room', () => {
  const a = collector();
  const b = collector();
  const offA = hub.subscribe('r1', a);
  const offB = hub.subscribe('r1', b);

  assert.equal(hub.publish('r1', { type: 'message' }), 2);
  assert.equal(a.events.length, 1);
  assert.equal(b.events.length, 1);
  offA(); offB();
});

test('a broadcast does not leak into another room', () => {
  const a = collector();
  const off = hub.subscribe('r1', a);
  hub.publish('r2', { type: 'message' });
  assert.equal(a.events.length, 0);
  off();
});

test('an addressed signal reaches only its recipient', () => {
  // Broadcasting SDP would publish every participant's connection details to
  // every listener in a public room, and burn the bandwidth doing it.
  const alice = collector();
  const bob = collector();
  const lurker = collector();
  const offA = hub.subscribe('r1', alice, { peerId: 'alice' });
  const offB = hub.subscribe('r1', bob, { peerId: 'bob' });
  const offL = hub.subscribe('r1', lurker);

  assert.equal(hub.publishToPeer('r1', 'bob', { type: 'voice-signal' }), true);
  assert.equal(bob.events.length, 1);
  assert.equal(alice.events.length, 0);
  assert.equal(lurker.events.length, 0, 'a listener must not receive signalling traffic');
  offA(); offB(); offL();
});

test('signalling to an absent peer reports failure rather than silently dropping', () => {
  // The caller must learn immediately; otherwise it waits out an ICE timeout
  // for a negotiation that can never complete.
  const off = hub.subscribe('r1', collector(), { peerId: 'alice' });
  assert.equal(hub.publishToPeer('r1', 'ghost', { type: 'voice-signal' }), false);
  assert.equal(hub.publishToPeer('r-none', 'alice', { type: 'voice-signal' }), false);
  off();
});

test('a peer stops being addressable once it unsubscribes', () => {
  const alice = collector();
  const off = hub.subscribe('r1', alice, { peerId: 'alice' });
  assert.equal(hub.hasPeer('r1', 'alice'), true);
  off();
  assert.equal(hub.hasPeer('r1', 'alice'), false);
  assert.equal(hub.publishToPeer('r1', 'alice', { type: 'x' }), false);
});

test('a peer subscriber still receives room broadcasts', () => {
  const alice = collector();
  const off = hub.subscribe('r1', alice, { peerId: 'alice' });
  hub.publish('r1', { type: 'message' });
  assert.equal(alice.events.length, 1);
  off();
});

test('one broken socket does not stop delivery to everyone else', () => {
  const broken = () => { throw new Error('socket closed'); };
  const good = collector();
  const off1 = hub.subscribe('r1', broken);
  const off2 = hub.subscribe('r1', good);

  assert.equal(hub.publish('r1', { type: 'message' }), 1, 'the healthy subscriber still counts');
  assert.equal(good.events.length, 1);
  off1(); off2();
});

test('a broken peer socket reports failure to the sender', () => {
  const off = hub.subscribe('r1', () => { throw new Error('socket closed'); }, { peerId: 'alice' });
  assert.equal(hub.publishToPeer('r1', 'alice', { type: 'voice-signal' }), false);
  off();
});

test('unsubscribing twice does not corrupt the client count', () => {
  const before = hub.stats().clients;
  const off = hub.subscribe('r1', collector());
  off();
  off();
  assert.equal(hub.stats().clients, before);
});

test('an emptied room is dropped rather than left as a husk', () => {
  const before = hub.stats().rooms;
  const off = hub.subscribe('ephemeral', collector(), { peerId: 'p1' });
  off();
  assert.equal(hub.stats().rooms, before);
});
