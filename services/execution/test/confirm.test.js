const test = require('node:test');
const assert = require('node:assert');
const { Confirmer, TransactionFailedError, ConfirmationTimeoutError } = require('../src/confirm');
const { robinhoodMainnet } = require('../src/chains');

const CHAIN = robinhoodMainnet({ ROBINHOOD_RPC_URLS: 'https://a.example,https://b.example' });
const HASH = '0xabc123';
const quiet = () => {};

function fakeRpc({ sendResults = [], receipts = [], head = 100 } = {}) {
  const state = { sends: 0, receiptPolls: 0 };
  return {
    state,
    async sendRawTransaction() {
      const next = sendResults[state.sends++] ?? HASH;
      if (next instanceof Error) throw next;
      return next;
    },
    async getTransactionReceipt() {
      return receipts[state.receiptPolls++] ?? null;
    },
    async blockNumber() {
      return head;
    },
  };
}

const noSleep = async () => {};
const make = (rpc, options = {}) =>
  new Confirmer(rpc, CHAIN, { sleep: noSleep, warn: quiet, ...options });

test('a reverted transaction is a FAILED trade, not a successful submission', async () => {
  // The worst possible bug in this file: the user paid gas and got nothing.
  const rpc = fakeRpc({ receipts: [{ status: '0x0', blockNumber: '0x64', gasUsed: '0x5208' }] });
  await assert.rejects(
    () => make(rpc).waitForConfirmation(HASH),
    (err) => {
      assert.ok(err instanceof TransactionFailedError);
      assert.match(err.message, /reverted on chain/);
      assert.match(err.message, /Gas was spent; nothing was swapped/);
      return true;
    }
  );
});

test('a successful receipt returns the on-chain facts', async () => {
  const rpc = fakeRpc({
    receipts: [{ status: '0x1', blockNumber: '0x64', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00' }],
  });
  const result = await make(rpc).waitForConfirmation(HASH);

  assert.equal(result.status, 'confirmed');
  assert.equal(result.blockNumber, 100);
  assert.equal(result.gasUsed, 21000n);
  assert.equal(result.effectiveGasPrice, 1_000_000_000n);
});

test('polls until the receipt appears', async () => {
  const rpc = fakeRpc({ receipts: [null, null, { status: '0x1', blockNumber: '0x64' }] });
  const result = await make(rpc).waitForConfirmation(HASH);
  assert.equal(result.status, 'confirmed');
  assert.equal(rpc.state.receiptPolls, 3);
});

test('a broadcast that never mines is recoverable, not failed', async () => {
  // It may still confirm. Marking it failed would contradict the chain.
  let clock = 0;
  const rpc = fakeRpc({ receipts: [] });
  const confirmer = make(rpc, { now: () => (clock += 30_000), timeoutMs: 60_000 });

  await assert.rejects(
    () => confirmer.waitForConfirmation(HASH),
    (err) => {
      assert.ok(err instanceof ConfirmationTimeoutError);
      assert.equal(err.recoverable, true);
      assert.equal(err.hash, HASH);
      assert.match(err.message, /do NOT re-sign/);
      return true;
    }
  );
});

test('waits for the required depth before calling it confirmed', async () => {
  const rpc = fakeRpc({ receipts: [{ status: '0x1', blockNumber: '0x64' }], head: 100 });
  rpc.blockNumber = async () => 100; // depth 1
  const result = await make(rpc).waitForConfirmation(HASH, { confirmations: 1 });
  assert.equal(result.blockNumber, 100);
});

test('keeps polling while the receipt is not deep enough', async () => {
  let head = 100;
  const rpc = fakeRpc({ receipts: Array(5).fill({ status: '0x1', blockNumber: '0x64' }) });
  rpc.blockNumber = async () => head++;
  const result = await make(rpc).waitForConfirmation(HASH, { confirmations: 3 });
  assert.equal(result.status, 'confirmed');
});

test('"already known" on a retry is success — the network has it', async () => {
  const rpc = fakeRpc({ sendResults: [new Error('already known')] });
  assert.equal(await make(rpc).broadcast('0xsigned', HASH), HASH);
});

test('retries a transport failure by re-sending identical bytes', async () => {
  const rpc = fakeRpc({ sendResults: [new Error('ECONNRESET'), HASH] });
  assert.equal(await make(rpc).broadcast('0xsigned', HASH), HASH);
  assert.equal(rpc.state.sends, 2);
});

test('gives up after the attempt budget', async () => {
  const rpc = fakeRpc({ sendResults: [new Error('a'), new Error('b'), new Error('c')] });
  await assert.rejects(() => make(rpc, { attempts: 3 }).broadcast('0xsigned', HASH), /c/);
  assert.equal(rpc.state.sends, 3);
});

test('a nonce error is not retried — identical bytes cannot fix it', async () => {
  const rpc = fakeRpc({ sendResults: [new Error('nonce too low')] });
  await assert.rejects(
    () => make(rpc).broadcast('0xsigned', HASH),
    (err) => {
      assert.equal(err.nonceDiverged, true);
      return true;
    }
  );
  assert.equal(rpc.state.sends, 1, 'resyncing is the caller\'s job, not resending');
});

test('refuses a hash that does not match the bytes we signed', async () => {
  // Either the transaction was mangled or the provider is not honest. Either
  // way, tracking the wrong hash is worse than failing here.
  const rpc = fakeRpc({ sendResults: ['0xsomethingelse'] });
  await assert.rejects(
    () => make(rpc, { attempts: 1 }).broadcast('0xsigned', HASH),
    /returned hash 0xsomethingelse, expected 0xabc123/
  );
});

test('submitAndConfirm runs the whole path', async () => {
  const rpc = fakeRpc({ receipts: [{ status: '0x1', blockNumber: '0x64', gasUsed: '0x5208' }] });
  const result = await make(rpc).submitAndConfirm('0xsigned', HASH);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.hash, HASH);
});
