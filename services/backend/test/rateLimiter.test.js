const test = require('node:test');
const assert = require('node:assert');
const { tierFor, TIERS } = require('../src/middleware/rateLimiter');

test('a verified wallet gets a higher allowance than a guest', () => {
  assert.equal(tierFor({ session: { kind: 'wallet', sub: '0xabc' } }), 'wallet');
  assert.equal(tierFor({ session: { kind: 'guest', sub: 'guest-1' } }), 'guest');
  assert.equal(tierFor({}), 'anonymous');
  assert.ok(TIERS.wallet > TIERS.guest, 'wallet tier must exceed guest tier');
});
