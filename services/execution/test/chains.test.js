const test = require('node:test');
const assert = require('node:assert');
const { getChain, robinhoodMainnet, robinhoodTestnet, parseUrlList } = require('../src/chains');

test('mainnet carries the confirmed D-005 facts', () => {
  const chain = robinhoodMainnet({});
  assert.equal(chain.chainId, 4663);
  assert.equal(chain.nativeCurrency.symbol, 'ETH');
  assert.equal(chain.ordering, 'fcfs', 'gas.js depends on this to refuse an escalator');
});

test('an explicit RPC list wins, so ops can repoint without a deploy', () => {
  const chain = robinhoodMainnet({ ROBINHOOD_RPC_URLS: 'https://one.example, https://two.example' });
  assert.deepEqual(chain.rpcUrls, ['https://one.example', 'https://two.example']);
});

test('an Alchemy key is placed ahead of the first-party endpoint', () => {
  const chain = robinhoodMainnet({ ALCHEMY_API_KEY: 'abc123' });
  assert.match(chain.rpcUrls[0], /alchemy\.com/);
  assert.match(chain.rpcUrls[0], /abc123/);
  assert.ok(chain.rpcUrls.some((u) => u.includes('rpc.mainnet.chain.robinhood.com')));
  assert.ok(chain.rpcUrls.length >= 2, 'D-005 item 3 requires a second provider');
});

test('the first-party endpoint is always present as a fallback', () => {
  assert.deepEqual(robinhoodMainnet({}).rpcUrls, ['https://rpc.mainnet.chain.robinhood.com']);
});

test('an unknown chain key fails closed', () => {
  // A typo must never route real money onto a chain nobody chose.
  assert.throws(() => getChain('ethereum'), /Unknown chain "ethereum"/);
  assert.throws(() => getChain(''), /Unknown chain/);
});

test('testnet refuses to guess its chain id', () => {
  // Signing with a guessed chain id produces a transaction no node accepts,
  // and the testnet id is not something D-005 was able to confirm.
  assert.throws(() => robinhoodTestnet({}), /ROBINHOOD_TESTNET_CHAIN_ID is unset/);
  assert.throws(() => robinhoodTestnet({ ROBINHOOD_TESTNET_CHAIN_ID: 'abc' }), /unset/);
});

test('testnet works once its chain id is supplied', () => {
  const chain = robinhoodTestnet({ ROBINHOOD_TESTNET_CHAIN_ID: '9999' });
  assert.equal(chain.chainId, 9999);
  assert.equal(chain.key, 'robinhood-testnet');
});

test('parseUrlList tolerates spacing and trailing separators', () => {
  assert.deepEqual(parseUrlList(' a , b ,, '), ['a', 'b']);
  assert.deepEqual(parseUrlList(''), []);
  assert.deepEqual(parseUrlList(undefined), []);
});
