const test = require('node:test');
const assert = require('node:assert');
const { ExecutionEngine } = require('../src/engine');
const { RouterSet, Router } = require('../src/router');
const { NonceManager } = require('../src/nonce');
const { Confirmer } = require('../src/confirm');
const { robinhoodMainnet } = require('../src/chains');

const CHAIN = robinhoodMainnet({ ROBINHOOD_RPC_URLS: 'https://a.example,https://b.example' });
const quiet = () => {};
const TOKEN_IN = '0x1111111111111111111111111111111111111111';
const TOKEN_OUT = '0x2222222222222222222222222222222222222222';
const WALLET = '0x3333333333333333333333333333333333333333';
const HASH = '0xfeedface';

class FakeRouter extends Router {
  constructor(amountOut = 1_000_000n) {
    super('fake');
    this.amountOut = amountOut;
  }
  async quote(params) {
    return {
      router: this.name,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      amountOut: this.amountOut,
      priceImpactBps: 25,
      fetchedAt: Date.now(),
      tx: null,
      raw: {},
    };
  }
  async buildTransaction(params) {
    const q = await this.quote(params);
    q.tx = { to: TOKEN_OUT, data: '0xdeadbeef', value: 0n };
    return q;
  }
}

function build(overrides = {}) {
  const signed = { signs: 0 };
  const signer = {
    address: WALLET,
    async signTransaction(tx) {
      signed.signs += 1;
      signed.last = tx;
      return { raw: '0xsigned', hash: HASH };
    },
  };

  const rpc = {
    async getTransactionCount() { return 7; },
    async sendRawTransaction() { return HASH; },
    async getTransactionReceipt() {
      return { status: '0x1', blockNumber: '0x64', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00' };
    },
    async blockNumber() { return 100; },
    async call() { throw new Error('unexpected'); },
    async assertChainId() { return CHAIN.chainId; },
    ...overrides.rpc,
  };

  const gas = {
    async estimate() {
      return {
        gasLimit: 200_000n,
        maxFeePerGas: 200_000_000n,
        maxPriorityFeePerGas: 0n,
        estimatedCostWei: 1n,
        baseFee: 100_000_000n,
        components: null,
      };
    },
    ...overrides.gas,
  };

  const nonces = new NonceManager(rpc, { warn: quiet });
  const engine = new ExecutionEngine({
    chain: CHAIN,
    rpc,
    routers: new RouterSet([overrides.router || new FakeRouter()], { warn: quiet }),
    gas,
    nonces,
    confirmer: new Confirmer(rpc, CHAIN, { sleep: async () => {}, warn: quiet, ...overrides.confirmer }),
    signer,
    policy: overrides.policy,
    warn: quiet,
    now: () => 1_700_000_000_000,
  });

  return { engine, signer, signed, nonces, rpc };
}

const TRADE = {
  identityId: 'ident-1',
  roomId: 'room-1',
  tokenIn: TOKEN_IN,
  tokenOut: TOKEN_OUT,
  amountIn: 1_000_000n,
  side: 'buy',
};

test('a confirmed swap returns a row shaped for the trades table', async () => {
  const { engine } = build();
  const row = await engine.executeSwap(TRADE);

  assert.equal(row.status, 'confirmed');
  assert.equal(row.tx_hash, HASH);
  assert.equal(row.chain, 'robinhood');
  assert.equal(row.side, 'buy');
  assert.equal(row.order_type, 'market');
  assert.equal(row.identity_id, 'ident-1');
  assert.equal(row.room_id, 'room-1');
  // Amounts are strings: NUMERIC(78,0) columns, never floats.
  assert.equal(typeof row.amount_in, 'string');
  assert.equal(typeof row.amount_out, 'string');
  assert.equal(row.amount_in, '1000000');
  assert.ok(row.confirmed_at);
});

test('token_address records the token traded, not the token spent', async () => {
  const { engine } = build();
  const bought = await engine.executeSwap({ ...TRADE, side: 'buy' });
  assert.equal(bought.token_address, TOKEN_OUT, 'a buy is about what you bought');

  const sold = await engine.executeSwap({ ...TRADE, side: 'sell' });
  assert.equal(sold.token_address, TOKEN_IN, 'a sell is about what you sold');
});

test('the fee is withheld from the amount actually swapped', async () => {
  const router = new FakeRouter();
  let sawAmountIn;
  router.quote = async (p) => { sawAmountIn = p.amountIn; return FakeRouter.prototype.quote.call(router, p); };
  const { engine } = build({ router });

  const row = await engine.executeSwap({ ...TRADE, amountIn: 1_000_000n, feeAmount: 1_000n });

  assert.equal(sawAmountIn, 999_000n, 'the router prices the net amount');
  assert.equal(row.amount_in, '1000000', 'the row records the gross the user committed');
  assert.equal(row.fee_amount, '1000');
});

test('a timed-out submission is "submitted" WITH its hash, never "failed"', async () => {
  // Migration 007 requires a hash for a submitted trade, and the chain may
  // still confirm it. Recording failure here would be a lie.
  let clock = 0;
  const { engine } = build({
    rpc: { async getTransactionReceipt() { return null; } },
    confirmer: { now: () => (clock += 30_000), timeoutMs: 60_000 },
  });

  const row = await engine.executeSwap(TRADE);
  assert.equal(row.status, 'submitted');
  assert.equal(row.tx_hash, HASH, 'the hash is what lets a reconciler finish the job');
  assert.equal(row.amount_out, null);
});

test('an on-chain revert is recorded as failed, with the hash', async () => {
  const { engine } = build({
    rpc: {
      async getTransactionReceipt() { return { status: '0x0', blockNumber: '0x64', gasUsed: '0x5208' }; },
    },
  });

  const row = await engine.executeSwap(TRADE);
  assert.equal(row.status, 'failed');
  assert.equal(row.tx_hash, HASH);
  assert.match(row.error, /reverted on chain/);
});

test('a nonce is returned to the pool when nothing was broadcast', async () => {
  // A signing failure must not leave a gap that stalls this wallet's next trade.
  const { engine, nonces } = build();
  engine.signer.signTransaction = async () => { throw new Error('signer unavailable'); };

  const row = await engine.executeSwap(TRADE);
  assert.equal(row.status, 'failed');
  assert.equal(row.tx_hash, null);
  assert.equal(nonces.peek(WALLET), 7, 'the unused nonce is reusable');
});

test('a nonce is NOT reclaimed once the bytes may be on the network', async () => {
  // After broadcast the nonce is spent whatever the response said.
  const { engine, nonces } = build({
    rpc: { async sendRawTransaction() { throw new Error('ECONNRESET'); } },
    confirmer: { attempts: 1 },
  });

  await engine.executeSwap(TRADE);
  assert.equal(nonces.peek(WALLET), 8, 'the nonce stays consumed');
});

test('the signed transaction carries the chain id and Nitro gas fields', async () => {
  const { engine, signed } = build();
  await engine.executeSwap(TRADE);

  assert.equal(signed.last.chainId, 4663);
  assert.equal(signed.last.type, 2);
  assert.equal(signed.last.nonce, 7);
  assert.equal(signed.last.maxPriorityFeePerGas, 0n, 'no tip on an FCFS chain');
  assert.equal(signed.last.gasLimit, 200_000n);
});

test('a stale quote is refused before anything is signed', async () => {
  const router = new FakeRouter();
  router.quote = async (p) => ({
    ...(await FakeRouter.prototype.quote.call(router, p)),
    fetchedAt: 0, // ancient
  });
  const { engine, signed } = build({ router });

  // Throws rather than returning a row: nothing was committed, so there is no
  // trade to record (see the error contract in engine.js).
  await assert.rejects(() => engine.executeSwap(TRADE), /old/);
  assert.equal(signed.signs, 0, 'the signer must never see a stale quote');
});

test('a zero-output quote never reaches the signer', async () => {
  const { engine, signed } = build({ router: new FakeRouter(0n) });
  await assert.rejects(() => engine.executeSwap(TRADE), /quoted zero output/);
  assert.equal(signed.signs, 0);
});

test('no trades row is produced for a rejected quote', async () => {
  // The boundary is nonce allocation: before it we throw, after it we always
  // return a row. This keeps the trades table free of rows that never had a
  // transaction behind them.
  const { engine, nonces } = build({ router: new FakeRouter(0n) });
  await assert.rejects(() => engine.executeSwap(TRADE));
  assert.equal(nonces.peek(WALLET), null, 'no nonce was even allocated');
});

test('policy is consulted before any quote is fetched', async () => {
  // A blocked trade should cost no API calls and touch nothing.
  const router = new FakeRouter();
  let quoted = false;
  router.quote = async (p) => { quoted = true; return FakeRouter.prototype.quote.call(router, p); };

  const { engine } = build({
    router,
    policy: { async assertAllowed() { throw new Error('per-transaction cap exceeded'); } },
  });

  await assert.rejects(() => engine.executeSwap(TRADE), /per-transaction cap exceeded/);
  assert.equal(quoted, false);
});

test('rejects a bad side rather than guessing', async () => {
  const { engine } = build();
  await assert.rejects(() => engine.executeSwap({ ...TRADE, side: 'long' }), RangeError);
});

test('rejects a fee larger than the trade', async () => {
  const { engine } = build();
  await assert.rejects(
    () => engine.executeSwap({ ...TRADE, amountIn: 100n, feeAmount: 200n }),
    RangeError
  );
  await assert.rejects(
    () => engine.executeSwap({ ...TRADE, amountIn: 100n, feeAmount: 100n }),
    /Nothing left to swap/
  );
});

test('preflight refuses a signerless engine', async () => {
  const { engine } = build();
  engine.signer = { address: WALLET };
  await assert.rejects(() => engine.preflight(), /requires a signer/);
});
