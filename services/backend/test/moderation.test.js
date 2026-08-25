const test = require('node:test');
const assert = require('node:assert');
const { contentMatchesBlockedPatterns } = require('../src/utils/moderation');

test('flags a blocked pattern anywhere in the message', () => {
  const patterns = ['scam.example.com', 'free-airdrop'];
  assert.equal(contentMatchesBlockedPatterns('visit scam.example.com now', patterns), true);
  assert.equal(contentMatchesBlockedPatterns('FREE-AIRDROP!!', patterns), true, 'must be case-insensitive');
});

test('leaves ordinary messages alone', () => {
  const patterns = ['scam.example.com'];
  assert.equal(contentMatchesBlockedPatterns('liquidity is locked', patterns), false);
  assert.equal(contentMatchesBlockedPatterns('', patterns), false);
});

test('an empty pattern list blocks nothing', () => {
  assert.equal(contentMatchesBlockedPatterns('anything at all', []), false);
});
