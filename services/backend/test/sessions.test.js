const test = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'a'.repeat(48);
const { issue, verify, requireAdmin, requireSession } = require('../src/auth/sessions');

function res() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('round-trips a session', () => {
  const payload = verify(issue({ sub: 'guest-1', kind: 'guest' }));
  assert.equal(payload.sub, 'guest-1');
  assert.equal(payload.kind, 'guest');
});

test('rejects a tampered payload', () => {
  const token = issue({ sub: 'guest-1', kind: 'guest' });
  const forged = Buffer.from(JSON.stringify({ sub: 'admin', kind: 'wallet', exp: Date.now() + 1e6 })).toString('base64url');
  assert.equal(verify(`${forged}.${token.split('.')[1]}`), null);
});

test('rejects garbage and empty input', () => {
  for (const bad of ['', 'nonsense', 'a.b', null, undefined, 42, {}]) {
    assert.equal(verify(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('rejects an expired token', () => {
  assert.equal(verify(issue({ sub: 'x', kind: 'guest' }, -1000)), null);
});

test('requireSession blocks anonymous callers', () => {
  const r = res();
  requireSession({ session: null }, r, () => assert.fail('should not call next()'));
  assert.equal(r.statusCode, 401);
});

test('requireAdmin fails closed when ADMIN_WALLETS is unset', () => {
  delete process.env.ADMIN_WALLETS;
  const r = res();
  requireAdmin({ session: { kind: 'wallet', address: '0xabc' } }, r, () => assert.fail('should not call next()'));
  assert.equal(r.statusCode, 503, 'an unconfigured server must not grant admin');
});

test('requireAdmin rejects guests and non-allowlisted wallets', () => {
  process.env.ADMIN_WALLETS = '0xAAA,0xBBB';

  const guest = res();
  requireAdmin({ session: { kind: 'guest', sub: 'guest-1' } }, guest, () => assert.fail());
  assert.equal(guest.statusCode, 401);

  const outsider = res();
  requireAdmin({ session: { kind: 'wallet', address: '0xCCC' } }, outsider, () => assert.fail());
  assert.equal(outsider.statusCode, 403);
});

test('requireAdmin admits an allowlisted wallet regardless of case', () => {
  process.env.ADMIN_WALLETS = '0xAAA,0xBBB';
  let called = false;
  requireAdmin({ session: { kind: 'wallet', address: '0xaaa' } }, res(), () => { called = true; });
  assert.equal(called, true);
});
