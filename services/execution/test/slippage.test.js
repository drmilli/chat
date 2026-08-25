const test = require('node:test');
const assert = require('node:assert');
const {
  minAmountOut, maxAmountIn, assertSlippageBps, assertQuoteFresh, assertPriceImpact, guardQuote,
} = require('../src/slippage');

test('1% slippage leaves 99% as the floor', () => {
  assert.equal(minAmountOut(1_000_000n, 100), 990_000n);
});

test('is exact at uint256 scale, where a float would drift', () => {
  const out = '123456789012345678901234567890';
  assert.equal(minAmountOut(out, 100), (BigInt(out) * 9900n) / 10_000n);
});

test('the output floor rounds DOWN', () => {
  // 99% of 999 is 989.01 — rounding up would reject a fill inside tolerance.
  assert.equal(minAmountOut(999n, 100), 989n);
});

test('the input ceiling rounds UP, the mirror image', () => {
  // Never commit to spending less than the tolerance actually allows.
  assert.equal(maxAmountIn(999n, 100), 1009n); // 1008.99 -> 1009
  assert.equal(maxAmountIn(1_000_000n, 100), 1_010_000n);
});

test('zero slippage means the quote must be met exactly', () => {
  assert.equal(minAmountOut(1_000_000n, 0), 1_000_000n);
});

test('refuses a tolerance above the cap', () => {
  // Past this a "tolerance" is a blank cheque to whoever fills the trade.
  assert.throws(() => assertSlippageBps(5001, { maxBps: 500 }), /exceeds the 500 bps cap/);
  assert.throws(() => minAmountOut(1000n, 900, { maxBps: 500 }), RangeError);
});

test('refuses a nonsensical tolerance', () => {
  assert.throws(() => assertSlippageBps(-1), RangeError);
  assert.throws(() => assertSlippageBps(1.5), RangeError);
});

test('refuses an amount that would silently lose precision', () => {
  assert.throws(() => minAmountOut(2 ** 53 + 2, 100), TypeError);
  assert.throws(() => minAmountOut('12.5', 100), TypeError);
  assert.throws(() => minAmountOut(null, 100), TypeError);
});

test('a stale quote is refused', () => {
  const quote = { fetchedAt: 1000 };
  assert.equal(assertQuoteFresh(quote, { maxAgeMs: 15_000, now: 6_000 }), 5_000);
  assert.throws(
    () => assertQuoteFresh(quote, { maxAgeMs: 15_000, now: 20_000 }),
    /19000ms old/
  );
});

test('a quote with no timestamp is refused rather than trusted', () => {
  assert.throws(() => assertQuoteFresh({}), /cannot judge freshness/);
  assert.throws(() => assertQuoteFresh(null), /cannot judge freshness/);
});

test('excessive price impact is refused even when slippage would allow it', () => {
  // A thin pool can be "within slippage" of its own terrible quote.
  assert.equal(assertPriceImpact(500, { maxBps: 1000 }), 500);
  assert.throws(() => assertPriceImpact(4000, { maxBps: 1000 }), /40.00% exceeds the 10.00% limit/);
});

test('an unreported price impact is null, not zero', () => {
  // Treating "not reported" as "no impact" would be a lie in the safe direction.
  assert.equal(assertPriceImpact(null), null);
  assert.equal(assertPriceImpact(undefined), null);
});

test('guardQuote returns the floor that goes into the transaction', () => {
  const quote = { amountOut: 1_000_000n, priceImpactBps: 50, fetchedAt: 1000 };
  const guard = guardQuote(quote, { slippageBps: 100, now: 2000 });
  assert.equal(guard.amountOut, 1_000_000n);
  assert.equal(guard.minAmountOut, 990_000n);
  assert.equal(guard.slippageBps, 100);
});

test('guardQuote refuses a zero-output quote', () => {
  // No route. Submitting would burn gas to receive nothing.
  assert.throws(
    () => guardQuote({ amountOut: 0n, fetchedAt: 1000 }, { now: 1100 }),
    /quoted zero output/
  );
});

test('guardQuote fails closed on the first violation', () => {
  const stale = { amountOut: 1_000_000n, priceImpactBps: 50, fetchedAt: 0 };
  assert.throws(() => guardQuote(stale, { now: 999_999 }), /old/);
  const heavy = { amountOut: 1_000_000n, priceImpactBps: 9999, fetchedAt: 1000 };
  assert.throws(() => guardQuote(heavy, { now: 1100 }), /Price impact/);
});
