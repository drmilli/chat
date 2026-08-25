/**
 * Integration tests: real HTTP against a real Postgres.
 *
 * Skipped automatically when DATABASE_URL is absent, so CI can run the unit
 * suite on every PR without a database secret.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

require('dotenv').config();

const hasDb = Boolean(process.env.DATABASE_URL);
const options = { skip: hasDb ? false : 'DATABASE_URL not set' };

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'i'.repeat(48);
process.env.ADMIN_WALLETS = process.env.ADMIN_WALLETS || '0x00000000000000000000000000000000000admin';
process.env.PORT = process.env.TEST_PORT || '3999';

let server;
let base;
const ROOM = `itest-${crypto.randomBytes(4).toString('hex')}`;

test.before(async () => {
  if (!hasDb) return;
  const app = require('../../src/app');
  server = app.listen(Number(process.env.PORT));
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (!server) return;
  const { pool } = require('../../src/db');
  // Leave no test rooms behind in a shared database.
  await pool.query('DELETE FROM messages WHERE room_id = $1', [ROOM]).catch(() => {});
  await pool.query('DELETE FROM rooms WHERE id = $1', [ROOM]).catch(() => {});
  await pool.end().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
});

const post = (path, body, token) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });

test('health reports database connectivity', options, async () => {
  const body = await (await fetch(`${base}/api/health`)).json();
  assert.equal(body.status, 'ok');
  assert.equal(body.db, true);
});

test('posting requires a session', options, async () => {
  const res = await post(`/api/rooms/${ROOM}/messages`, { identityId: 'someone-else', content: 'hi' });
  assert.equal(res.status, 401);
});

test('a message is attributed to the session, not the request body', options, async () => {
  const guest = await (await post('/api/auth/guest')).json();
  const res = await post(`/api/rooms/${ROOM}/messages`, { identityId: 'not-me', content: 'integration hello' }, guest.token);
  assert.equal(res.status, 201);
  const { message } = await res.json();
  assert.equal(message.identity_id, guest.identity.id);
});

test('history persists and reloads in order', options, async () => {
  const guest = await (await post('/api/auth/guest')).json();
  await post(`/api/rooms/${ROOM}/messages`, { content: 'first' }, guest.token);
  await post(`/api/rooms/${ROOM}/messages`, { content: 'second' }, guest.token);

  const body = await (await fetch(`${base}/api/rooms/${ROOM}/messages?limit=50`)).json();
  const texts = body.messages.map((m) => m.content);
  assert.ok(texts.includes('first') && texts.includes('second'));
  // Endpoint returns newest first.
  const times = body.messages.map((m) => new Date(m.created_at).getTime());
  assert.deepEqual([...times].sort((a, b) => b - a), times, 'messages must come back newest-first');
});

test('replies keep the quoted author and snippet', options, async () => {
  const guest = await (await post('/api/auth/guest')).json();
  const parent = await (await post(`/api/rooms/${ROOM}/messages`, { content: 'the original' }, guest.token)).json();
  const reply = await (
    await post(`/api/rooms/${ROOM}/messages`, { content: 'the reply', replyToId: parent.message.id }, guest.token)
  ).json();

  assert.equal(reply.message.replyToId, parent.message.id);
  assert.equal(reply.message.replyToPreview, 'the original');

  const list = await (await fetch(`${base}/api/rooms/${ROOM}/messages?limit=10`)).json();
  const persisted = list.messages.find((m) => m.id === reply.message.id);
  assert.equal(persisted.replyToPreview, 'the original', 'the quote must survive a refetch');
});

test('a reply cannot point at another room', options, async () => {
  const guest = await (await post('/api/auth/guest')).json();
  const res = await post(`/api/rooms/${ROOM}/messages`, { content: 'x', replyToId: 1 }, guest.token);
  assert.equal(res.status, 400);
});

test('moderation endpoints reject non-admins', options, async () => {
  const guest = await (await post('/api/auth/guest')).json();
  assert.equal((await post('/api/admin/blocklist', { pattern: 'x' })).status, 401);
  assert.equal((await post('/api/admin/blocklist', { pattern: 'x' }, guest.token)).status, 401);
  assert.equal((await post('/api/bans', { identityId: 'x', reason: 'x' })).status, 401);
});

test('the public activity feed carries no message text', options, async () => {
  const guest = await (await post('/api/auth/guest')).json();
  await post(`/api/rooms/${ROOM}/messages`, { content: 'secret-do-not-publish' }, guest.token);

  const body = await (await fetch(`${base}/api/activity?limit=50`)).json();
  const leaked = body.events.filter((e) => e.preview);
  assert.equal(leaked.length, 0, 'activity must not republish message bodies');
  assert.ok(body.events.length > 0, 'but it should still report activity');
});

test('rooms stats and listing respond', options, async () => {
  const stats = await (await fetch(`${base}/api/rooms/stats`)).json();
  assert.equal(typeof stats.rooms, 'number');
  const list = await (await fetch(`${base}/api/rooms?limit=5`)).json();
  assert.ok(Array.isArray(list.rooms));
});
