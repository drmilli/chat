/**
 * Slippage and quote guards.
 *
 * These matter more here than they would on most chains. D-005 item 2 found
 * that Robinhood Chain inherits Arbitrum's private mempool and FCFS ordering,
 * so there is no MEV relay to integrate — and therefore no MEV relay to hide
 * behind. Slippage bounds and quote freshness ARE the user protection. If this
 * file is lax, nothing downstream compensates.
 *
 * All amounts are BigInt: these are uint256 token amounts, and a float would
 * lose precision exactly where a loss is a real loss (see trading/fees.js).
 */

const BPS_DENOMINATOR = 10_000n;

/** 1% — the usual default for a liquid pair. */
const DEFAULT_SLIPPAGE_BPS = Number(process.env.TRADE_SLIPPAGE_BPS || 100);

/**
 * 5% — refuse anything looser unless a caller explicitly overrides the cap.
 * Above this a "slippage tolerance" stops being protection and becomes a
 * blank cheque to whoever fills the trade.
 */
const MAX_SLIPPAGE_BPS = Number(process.env.TRADE_MAX_SLIPPAGE_BPS || 500);

/** A quote older than this is stale. 100ms blocks make quotes age fast. */
const MAX_QUOTE_AGE_MS = Number(process.env.TRADE_MAX_QUOTE_AGE_MS || 15_000);

/** Refuse a route whose own price impact exceeds this, whatever slippage says. */
const MAX_PRICE_IMPACT_BPS = Number(process.env.TRADE_MAX_PRICE_IMPACT_BPS || 1000);

function toBigInt(value, label) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${label} must be a safe integer or a string; got ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new TypeError(`${label} must be a non-negative integer amount; got ${JSON.stringify(value)}`);
}

function assertSlippageBps(slippageBps, { maxBps = MAX_SLIPPAGE_BPS } = {}) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0) {
    throw new RangeError(`slippageBps must be a non-negative integer; got ${slippageBps}`);
  }
  if (slippageBps > maxBps) {
    throw new RangeError(
      `slippageBps ${slippageBps} exceeds the ${maxBps} bps cap. Above this the ` +
        'tolerance stops protecting the trader.'
    );
  }
  return slippageBps;
}

/**
 * The floor we put in the transaction. Rounds DOWN, which is the safe
 * direction: a lower floor can only make the trade more likely to succeed at a
 * price the user already accepted, while rounding up could reject a fill that
 * was within tolerance.
 *
 * @returns {bigint}
 */
function minAmountOut(quotedAmountOut, slippageBps = DEFAULT_SLIPPAGE_BPS, options = {}) {
  const quoted = toBigInt(quotedAmountOut, 'quotedAmountOut');
  assertSlippageBps(slippageBps, options);
  return (quoted * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;
}

/**
 * The ceiling for a sell-side/exact-output trade. Rounds UP for the mirror-image
 * reason: never commit to spending less than the tolerance actually allows.
 */
function maxAmountIn(quotedAmountIn, slippageBps = DEFAULT_SLIPPAGE_BPS, options = {}) {
  const quoted = toBigInt(quotedAmountIn, 'quotedAmountIn');
  assertSlippageBps(slippageBps, options);
  const numerator = quoted * (BPS_DENOMINATOR + BigInt(slippageBps));
  // Ceiling division.
  return (numerator + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

/** A quote is only worth acting on for a few seconds at 100ms block times. */
function assertQuoteFresh(quote, { maxAgeMs = MAX_QUOTE_AGE_MS, now = Date.now() } = {}) {
  if (!quote || typeof quote.fetchedAt !== 'number') {
    throw new Error('Quote is missing fetchedAt; cannot judge freshness, so refusing it.');
  }
  const age = now - quote.fetchedAt;
  if (age > maxAgeMs) {
    throw new Error(`Quote is ${age}ms old (limit ${maxAgeMs}ms). Re-quote rather than trade on it.`);
  }
  return age;
}

/**
 * Price impact is the router telling us the trade itself moves the price. A
 * thin-liquidity memecoin can show 40% impact while still being "within
 * slippage" of its own terrible quote, so this is a separate check.
 */
function assertPriceImpact(priceImpactBps, { maxBps = MAX_PRICE_IMPACT_BPS } = {}) {
  if (priceImpactBps == null) return null; // router did not report it
  if (!Number.isFinite(priceImpactBps) || priceImpactBps < 0) {
    throw new RangeError(`priceImpactBps must be a non-negative number; got ${priceImpactBps}`);
  }
  if (priceImpactBps > maxBps) {
    throw new Error(
      `Price impact ${(priceImpactBps / 100).toFixed(2)}% exceeds the ` +
        `${(maxBps / 100).toFixed(2)}% limit. The trade is large relative to the pool.`
    );
  }
  return priceImpactBps;
}

/**
 * Every guard in one call, returning what goes into the transaction.
 * Throws on the first violation — fail closed, never trade on a bad quote.
 */
function guardQuote(quote, { slippageBps = DEFAULT_SLIPPAGE_BPS, now = Date.now(), ...limits } = {}) {
  assertQuoteFresh(quote, { ...limits, now });
  assertPriceImpact(quote.priceImpactBps, limits);

  const amountOut = toBigInt(quote.amountOut, 'quote.amountOut');
  if (amountOut === 0n) {
    throw new Error('Router quoted zero output. There is no route; refusing to submit.');
  }

  return {
    amountOut,
    minAmountOut: minAmountOut(amountOut, slippageBps, limits),
    slippageBps,
  };
}

module.exports = {
  minAmountOut,
  maxAmountIn,
  assertSlippageBps,
  assertQuoteFresh,
  assertPriceImpact,
  guardQuote,
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  MAX_QUOTE_AGE_MS,
  MAX_PRICE_IMPACT_BPS,
  BPS_DENOMINATOR,
};
