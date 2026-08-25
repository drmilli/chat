/**
 * Fee and cashback arithmetic (D-004: 0.1% flat + cashback).
 *
 * Everything here is BigInt. On-chain amounts are uint256-scale integers, and
 * JavaScript numbers lose precision above 2^53 — a float rounding error in the
 * revenue line is the kind of bug that is discovered during an audit, months of
 * trades later. The database columns are NUMERIC(78,0) for the same reason.
 *
 * Rounding: fees round DOWN (never overcharge), cashback rounds DOWN (never pay
 * out more than earned). Both favour the user and the ledger stays consistent.
 */

const BPS_DENOMINATOR = 10_000n; // 1 bp = 0.01%

/** 0.1% — the market reference (D-004). */
const DEFAULT_FEE_BPS = Number(process.env.TRADE_FEE_BPS || 10);

/** Share of the fee returned to the trader, in percent. 0 disables cashback. */
const DEFAULT_CASHBACK_PERCENT = Number(process.env.TRADE_CASHBACK_PERCENT || 0);

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

/**
 * Splits a trade amount into the fee and what actually gets traded.
 *
 * @returns {{ feeAmount: bigint, netAmount: bigint, cashbackAmount: bigint, feeBps: number, cashbackPercent: number }}
 */
function calculateFee(amountIn, { feeBps = DEFAULT_FEE_BPS, cashbackPercent = DEFAULT_CASHBACK_PERCENT } = {}) {
  const amount = toBigInt(amountIn, 'amountIn');
  if (amount < 0n) throw new RangeError('amountIn cannot be negative');

  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) {
    // A fee above 10% is almost certainly a units mistake, so refuse it here
    // rather than discover it in the ledger.
    throw new RangeError(`feeBps must be an integer between 0 and 1000; got ${feeBps}`);
  }
  if (!Number.isFinite(cashbackPercent) || cashbackPercent < 0 || cashbackPercent > 100) {
    throw new RangeError(`cashbackPercent must be between 0 and 100; got ${cashbackPercent}`);
  }

  const feeAmount = (amount * BigInt(feeBps)) / BPS_DENOMINATOR; // floors
  const netAmount = amount - feeAmount;

  // Percent is allowed to be fractional (e.g. 87.5), so scale before dividing.
  const cashbackScaled = BigInt(Math.round(cashbackPercent * 100));
  const cashbackAmount = (feeAmount * cashbackScaled) / 10_000n; // floors

  return { feeAmount, netAmount, cashbackAmount, feeBps, cashbackPercent };
}

/** The ledger row for a settled trade. Fee and cashback stay separate (D-004). */
function buildFeeLedgerEntry(tradeId, amountIn, currency, options = {}) {
  const { feeAmount, cashbackAmount, feeBps } = calculateFee(amountIn, options);
  return {
    trade_id: tradeId,
    fee_amount: feeAmount.toString(),
    cashback_amount: cashbackAmount.toString(),
    fee_bps: feeBps,
    currency,
  };
}

module.exports = { calculateFee, buildFeeLedgerEntry, DEFAULT_FEE_BPS, DEFAULT_CASHBACK_PERCENT, BPS_DENOMINATOR };
