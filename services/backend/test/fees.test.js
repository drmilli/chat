const test = require('node:test');
const assert = require('node:assert');
const { calculateFee, buildFeeLedgerEntry } = require('../src/trading/fees');

test('takes 0.1% and leaves the rest', () => {
  const { feeAmount, netAmount } = calculateFee('1000000', { feeBps: 10 });
  assert.equal(feeAmount, 1000n);
  assert.equal(netAmount, 999000n);
  assert.equal(feeAmount + netAmount, 1000000n, 'nothing may be created or lost');
});

test('is exact at uint256 scale, where floats break', () => {
  const oneThousandEth = '1000000000000000000000'; // 1e21 wei — far beyond 2^53
  const { feeAmount, netAmount } = calculateFee(oneThousandEth, { feeBps: 10 });
  assert.equal(feeAmount, 1000000000000000000n, '0.1% of 1000 ETH is exactly 1 ETH');
  assert.equal(feeAmount + netAmount, BigInt(oneThousandEth));
});

test('rounds the fee down, never up', () => {
  // 0.1% of 999 is 0.999 — the trader must not be charged a whole unit.
  assert.equal(calculateFee(999, { feeBps: 10 }).feeAmount, 0n);
  assert.equal(calculateFee(1999, { feeBps: 10 }).feeAmount, 1n);
});

test('cashback is a share of the fee and never exceeds it', () => {
  const { feeAmount, cashbackAmount } = calculateFee('1000000', { feeBps: 10, cashbackPercent: 90 });
  assert.equal(feeAmount, 1000n);
  assert.equal(cashbackAmount, 900n);
  assert.ok(cashbackAmount <= feeAmount, 'the DB constraint mirrors this');
});

test('handles fractional cashback percentages', () => {
  const { cashbackAmount } = calculateFee('1000000', { feeBps: 10, cashbackPercent: 87.5 });
  assert.equal(cashbackAmount, 875n);
});

test('100% cashback equals the fee exactly; 0% pays nothing', () => {
  assert.equal(calculateFee('1000000', { feeBps: 10, cashbackPercent: 100 }).cashbackAmount, 1000n);
  assert.equal(calculateFee('1000000', { feeBps: 10, cashbackPercent: 0 }).cashbackAmount, 0n);
});

test('a zero-amount trade produces no fee', () => {
  const { feeAmount, netAmount, cashbackAmount } = calculateFee(0, { feeBps: 10, cashbackPercent: 90 });
  assert.equal(feeAmount, 0n);
  assert.equal(netAmount, 0n);
  assert.equal(cashbackAmount, 0n);
});

test('refuses input that would silently lose precision', () => {
  assert.throws(() => calculateFee(2 ** 53 + 2), TypeError, 'unsafe integers must be rejected');
  assert.throws(() => calculateFee(1.5), TypeError);
  assert.throws(() => calculateFee('12.5'), TypeError);
  assert.throws(() => calculateFee('abc'), TypeError);
  assert.throws(() => calculateFee(null), TypeError);
});

test('refuses an implausible fee or cashback setting', () => {
  assert.throws(() => calculateFee(100, { feeBps: 2000 }), RangeError, 'a 20% fee is a units mistake');
  assert.throws(() => calculateFee(100, { feeBps: -1 }), RangeError);
  assert.throws(() => calculateFee(100, { cashbackPercent: 150 }), RangeError);
});

test('builds a ledger row with fee and cashback separated', () => {
  const row = buildFeeLedgerEntry(42, '1000000', 'ETH', { feeBps: 10, cashbackPercent: 90 });
  assert.deepEqual(row, {
    trade_id: 42,
    fee_amount: '1000',
    cashback_amount: '900',
    fee_bps: 10,
    currency: 'ETH',
  });
  assert.equal(typeof row.fee_amount, 'string', 'NUMERIC(78,0) is written as a string, not a JS number');
});
