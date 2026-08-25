const test = require('node:test');
const assert = require('node:assert');
const { NonceManager, isNonceError } = require('../src/nonce');

const ADDR = '0xAbCdEf0000000000000000000000000000000001';
const quiet = () => {};

/** Fake RPC whose getTransactionCount can be made deliberately slow. */
function fakeRpc(count = 5, delayMs = 0) {
  const state = { count, calls: 0 };
  return {
    state,
    async getTransactionCount() {
      state.calls += 1;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return state.count;
    },
  };
}

test('allocates sequential nonces from the chain count', async () => {
  const rpc = fakeRpc(5);
  const nonces = new NonceManager(rpc, { warn: quiet });

  assert.equal(await nonces.allocate(ADDR), 5);
  assert.equal(await nonces.allocate(ADDR), 6);
  assert.equal(await nonces.allocate(ADDR), 7);
  assert.equal(rpc.state.calls, 1, 'the chain is read once, then tracked locally');
});

test('never issues the same nonce twice under concurrency', async () => {
  // The failure this guards: awaiting the chain mid-allocation lets a second
  // caller in before `next` is incremented, and both get the same nonce. One
  // transaction then dies as "nonce too low" — silently.
  const rpc = fakeRpc(100, 5);
  const nonces = new NonceManager(rpc, { warn: quiet });

  const issued = await Promise.all(
    Array.from({ length: 50 }, () => nonces.allocate(ADDR))
  );

  assert.equal(new Set(issued).size, 50, 'every nonce must be unique');
  assert.deepEqual(
    [...issued].sort((a, b) => a - b),
    Array.from({ length: 50 }, (_, i) => 100 + i),
    'and they must be contiguous — a gap stalls the wallet'
  );
});

test('addresses are tracked independently', async () => {
  const other = '0xBeef000000000000000000000000000000000002';
  const nonces = new NonceManager(fakeRpc(5), { warn: quiet });

  assert.equal(await nonces.allocate(ADDR), 5);
  assert.equal(await nonces.allocate(other), 5, 'a different wallet has its own sequence');
  assert.equal(await nonces.allocate(ADDR), 6);
});

test('address casing does not create a second sequence', async () => {
  const nonces = new NonceManager(fakeRpc(5), { warn: quiet });
  assert.equal(await nonces.allocate(ADDR.toLowerCase()), 5);
  assert.equal(await nonces.allocate(ADDR.toUpperCase()), 6);
});

test('releases the newest nonce so the next trade reuses it', async () => {
  const nonces = new NonceManager(fakeRpc(5), { warn: quiet });
  const n = await nonces.allocate(ADDR);
  await nonces.release(ADDR, n);
  assert.equal(await nonces.allocate(ADDR), n, 'an unbroadcast nonce is not wasted');
});

test('refuses to release from the middle, forcing a resync instead', async () => {
  // Releasing 5 while 6 is in flight would re-issue 5 and leave a permanent
  // gap at 6, stalling every later transaction from this wallet.
  const warnings = [];
  const rpc = fakeRpc(5);
  const nonces = new NonceManager(rpc, { warn: (m) => warnings.push(m) });

  const first = await nonces.allocate(ADDR);
  await nonces.allocate(ADDR);
  await nonces.release(ADDR, first);

  assert.match(warnings.join(' '), /not the newest allocation/);
  assert.equal(nonces.peek(ADDR), null, 'state is dropped so the chain is re-read');
});

test('resyncs when the cached value goes stale', async () => {
  let clock = 0;
  const rpc = fakeRpc(5);
  const nonces = new NonceManager(rpc, { warn: quiet, resyncAfterMs: 1000, now: () => clock });

  assert.equal(await nonces.allocate(ADDR), 5);
  rpc.state.count = 9; // something outside this process sent transactions
  clock += 2000;
  assert.equal(await nonces.allocate(ADDR), 9, 'the chain wins when it is ahead');
  assert.equal(rpc.state.calls, 2);
});

test('never moves backwards when a lagging provider reports a lower count', async () => {
  // A provider behind the head would otherwise make us re-issue a nonce that
  // is already in flight — the exact double-spend nonce.js exists to prevent.
  let clock = 0;
  const rpc = fakeRpc(5);
  const nonces = new NonceManager(rpc, { warn: quiet, resyncAfterMs: 1000, now: () => clock });

  await nonces.allocate(ADDR); // 5
  await nonces.allocate(ADDR); // 6, local next = 7
  rpc.state.count = 5;          // lagging provider
  clock += 2000;

  assert.equal(await nonces.allocate(ADDR), 7, 'local progress must be kept');
});

test('reset forces the next allocation to re-read the chain', async () => {
  const rpc = fakeRpc(5);
  const nonces = new NonceManager(rpc, { warn: quiet });

  await nonces.allocate(ADDR);
  nonces.reset(ADDR);
  rpc.state.count = 42;
  assert.equal(await nonces.allocate(ADDR), 42);
});

test('a failed allocation does not poison the queue behind it', async () => {
  let fail = true;
  const rpc = {
    async getTransactionCount() {
      if (fail) { fail = false; throw new Error('provider down'); }
      return 7;
    },
  };
  const nonces = new NonceManager(rpc, { warn: quiet });

  await assert.rejects(() => nonces.allocate(ADDR), /provider down/);
  assert.equal(await nonces.allocate(ADDR), 7, 'the next caller still gets served');
});

test('recognises the errors that mean our nonce view diverged', () => {
  assert.ok(isNonceError(new Error('nonce too low')));
  assert.ok(isNonceError(new Error('already known')));
  assert.ok(isNonceError(new Error('replacement transaction underpriced')));
  assert.ok(!isNonceError(new Error('execution reverted')));
  assert.ok(!isNonceError(new Error('insufficient funds')));
});
