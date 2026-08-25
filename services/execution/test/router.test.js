const test = require('node:test');
const assert = require('node:assert');
const {
  RouterSet, AllRoutersFailedError, Router, NoRouteError, RouterUnavailableError,
} = require('../src/router');
const { OneInchRouter } = require('../src/router/oneinch');
const { ZeroExRouter } = require('../src/router/zeroex');

const quiet = () => {};
const PARAMS = {
  chainId: 4663,
  tokenIn: '0x1111111111111111111111111111111111111111',
  tokenOut: '0x2222222222222222222222222222222222222222',
  amountIn: 1_000_000n,
  taker: '0x3333333333333333333333333333333333333333',
  slippageBps: 100,
};

/** A stub adapter whose behaviour each test dictates. */
class StubRouter extends Router {
  constructor(name, behaviour) {
    super(name);
    this.behaviour = behaviour;
    this.calls = 0;
  }
  async quote() {
    this.calls += 1;
    if (this.behaviour instanceof Error) throw this.behaviour;
    return { router: this.name, amountOut: this.behaviour, fetchedAt: 1000, amountIn: PARAMS.amountIn };
  }
  buildTransaction() { return this.quote(); }
}

test('uses the primary when it answers, without touching the fallback', async () => {
  const primary = new StubRouter('1inch', 900n);
  const fallback = new StubRouter('0x', 950n);
  const set = new RouterSet([primary, fallback], { warn: quiet });

  const quote = await set.quote(PARAMS);
  assert.equal(quote.router, '1inch');
  assert.equal(fallback.calls, 0, 'the fallback costs an API call it should not spend');
});

test('falls over to 0x when 1inch is down', async () => {
  // The whole point of D-005 picking two: an aggregator outage degrades
  // pricing rather than stopping trading.
  const set = new RouterSet(
    [new StubRouter('1inch', new RouterUnavailableError('1inch', 'HTTP 503')), new StubRouter('0x', 950n)],
    { warn: quiet }
  );
  assert.equal((await set.quote(PARAMS)).router, '0x');
});

test('distinguishes "no route anywhere" from "our routers are down"', async () => {
  // The UI must say different things: one is a fact about the token, the
  // other is our problem.
  const noRoute = new RouterSet(
    [new StubRouter('1inch', new NoRouteError('1inch')), new StubRouter('0x', new NoRouteError('0x'))],
    { warn: quiet }
  );
  await assert.rejects(() => noRoute.quote(PARAMS), (err) => {
    assert.ok(err instanceof AllRoutersFailedError);
    assert.equal(err.noRouteEverywhere, true);
    return true;
  });

  const outage = new RouterSet(
    [new StubRouter('1inch', new RouterUnavailableError('1inch', 'HTTP 503')),
     new StubRouter('0x', new NoRouteError('0x'))],
    { warn: quiet }
  );
  await assert.rejects(() => outage.quote(PARAMS), (err) => {
    assert.equal(err.noRouteEverywhere, false, 'an outage must not read as "untradeable"');
    return true;
  });
});

test('quoteBest picks the highest output', async () => {
  const set = new RouterSet([new StubRouter('1inch', 900n), new StubRouter('0x', 950n)], { warn: quiet });
  const best = await set.quoteBest(PARAMS);
  assert.equal(best.router, '0x');
  assert.equal(best.amountOut, 950n);
});

test('quoteBest compares as BigInt, not Number', async () => {
  // Math.max would coerce and silently lose precision at uint256 scale, then
  // pick the wrong route by a margin nobody would notice.
  const low = 10n ** 30n;
  const high = low + 1n;
  const set = new RouterSet([new StubRouter('1inch', low), new StubRouter('0x', high)], { warn: quiet });
  assert.equal((await set.quoteBest(PARAMS)).amountOut, high);
});

test('quoteBest tolerates one router failing', async () => {
  const set = new RouterSet(
    [new StubRouter('1inch', new RouterUnavailableError('1inch', 'down')), new StubRouter('0x', 950n)],
    { warn: quiet }
  );
  assert.equal((await set.quoteBest(PARAMS)).router, '0x');
});

test('quoteBest throws only when every router fails', async () => {
  const set = new RouterSet(
    [new StubRouter('1inch', new Error('a')), new StubRouter('0x', new Error('b'))],
    { warn: quiet }
  );
  await assert.rejects(() => set.quoteBest(PARAMS), AllRoutersFailedError);
});

test('fromEnv refuses to build with no credentials', () => {
  // Fail closed and say which key is missing, rather than 401-ing per trade.
  // Env is cleared so the result does not depend on the developer's shell.
  const saved = { one: process.env.ONEINCH_API_KEY, zero: process.env.ZEROEX_API_KEY };
  delete process.env.ONEINCH_API_KEY;
  delete process.env.ZEROEX_API_KEY;
  try {
    assert.throws(() => RouterSet.fromEnv({ warn: quiet }), /No router is configured/);
  } finally {
    if (saved.one) process.env.ONEINCH_API_KEY = saved.one;
    if (saved.zero) process.env.ZEROEX_API_KEY = saved.zero;
  }
});

test('fromEnv warns when only the primary is configured', () => {
  const saved = { one: process.env.ONEINCH_API_KEY, zero: process.env.ZEROEX_API_KEY };
  process.env.ONEINCH_API_KEY = 'test-key';
  delete process.env.ZEROEX_API_KEY;
  const warnings = [];
  try {
    const set = RouterSet.fromEnv({ warn: (m) => warnings.push(m) });
    assert.equal(set.routers.length, 1);
    assert.match(warnings.join(' '), /fallback router/);
  } finally {
    if (saved.one) process.env.ONEINCH_API_KEY = saved.one; else delete process.env.ONEINCH_API_KEY;
    if (saved.zero) process.env.ZEROEX_API_KEY = saved.zero;
  }
});

test('an unconfigured adapter reports itself as unusable', () => {
  assert.equal(new OneInchRouter({ apiKey: null }).configured, false);
  assert.equal(new OneInchRouter({ apiKey: 'k' }).configured, true);
  assert.equal(new ZeroExRouter({ apiKey: null }).configured, false);
});

test('adapters name the missing env var instead of sending an unauthenticated call', async () => {
  await assert.rejects(() => new OneInchRouter({ apiKey: null }).quote(PARAMS), /ONEINCH_API_KEY/);
  await assert.rejects(() => new ZeroExRouter({ apiKey: null }).quote(PARAMS), /ZEROEX_API_KEY/);
});

test('1inch normalises a documented v6 response', async () => {
  const router = new OneInchRouter({
    apiKey: 'k',
    now: () => 12345,
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ dstAmount: '987654' }) }),
  });
  const quote = await router.quote(PARAMS);

  assert.equal(quote.router, '1inch');
  assert.equal(quote.amountOut, 987_654n);
  assert.equal(quote.amountIn, 1_000_000n);
  assert.equal(quote.fetchedAt, 12345);
  assert.equal(quote.priceImpactBps, null, 'not reported is null, never zero');
});

test('1inch throws loudly on an unexpected shape rather than quoting zero', async () => {
  // Field mapping is unverified until the T-305 testnet swap; a mismatch must
  // be impossible to miss.
  const router = new OneInchRouter({
    apiKey: 'k',
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ unexpected: 1 }) }),
  });
  await assert.rejects(() => router.quote(PARAMS), /no destination amount/);
});

test('0x converts its percentage price impact into bps', async () => {
  const router = new ZeroExRouter({
    apiKey: 'k',
    now: () => 999,
    fetch: async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ buyAmount: '500000', estimatedPriceImpact: '1.25' }),
    }),
  });
  const quote = await router.quote(PARAMS);
  assert.equal(quote.amountOut, 500_000n);
  assert.equal(quote.priceImpactBps, 125);
});

test('a 4xx is no-route, a 5xx is an outage', async () => {
  const mk = (status) => new OneInchRouter({
    apiKey: 'k',
    fetch: async () => ({ ok: false, status, text: async () => JSON.stringify({ description: 'x' }) }),
  });
  await assert.rejects(() => mk(400).quote(PARAMS), NoRouteError);
  await assert.rejects(() => mk(503).quote(PARAMS), RouterUnavailableError);
});

test('a router returning no calldata is refused', async () => {
  const router = new OneInchRouter({
    apiKey: 'k',
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ dstAmount: '1' }) }),
  });
  await assert.rejects(() => router.buildTransaction(PARAMS), /no transaction/);
});
