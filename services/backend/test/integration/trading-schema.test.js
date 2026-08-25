/**
 * The trading schema's job is to make bad money data impossible to store.
 * These tests assert what it REFUSES, not just what it accepts.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

require('dotenv').config();

const hasDb = Boolean(process.env.DATABASE_URL);
const options = { skip: hasDb ? false : 'DATABASE_URL not set' };

let db;
const IDENTITY = `schema-test-${crypto.randomBytes(4).toString('hex')}`;
const CHAIN = 'robinhood';
const created = { trades: [] };

test.before(async () => {
  if (!hasDb) return;
  db = require('../../src/db');
  await db.query('INSERT INTO identities (id, verified, created_at) VALUES ($1, FALSE, NOW())', [IDENTITY]);
});

test.after(async () => {
  if (!db) return;
  await db.query('DELETE FROM fee_ledger WHERE trade_id = ANY($1::int[])', [created.trades]).catch(() => {});
  await db.query('DELETE FROM limit_orders WHERE identity_id = $1', [IDENTITY]).catch(() => {});
  await db.query('DELETE FROM trades WHERE identity_id = $1', [IDENTITY]).catch(() => {});
  await db.query('DELETE FROM deposits WHERE identity_id = $1', [IDENTITY]).catch(() => {});
  await db.query('DELETE FROM withdrawals WHERE identity_id = $1', [IDENTITY]).catch(() => {});
  await db.query('DELETE FROM bot_wallets WHERE identity_id = $1', [IDENTITY]).catch(() => {});
  await db.query('DELETE FROM identities WHERE id = $1', [IDENTITY]).catch(() => {});
  await db.pool.end().catch(() => {});
});

async function rejects(sql, params, label) {
  await assert.rejects(() => db.query(sql, params), label);
}

test('stores a uint256 amount without losing precision', options, async () => {
  // 2^256-1 would overflow any float; NUMERIC(78,0) must hold it exactly.
  const huge = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  const res = await db.query(
    `INSERT INTO trades (identity_id, chain, token_address, side, amount_in, status)
     VALUES ($1, $2, '0xtoken', 'buy', $3, 'pending') RETURNING id, amount_in`,
    [IDENTITY, CHAIN, huge]
  );
  created.trades.push(res.rows[0].id);
  assert.equal(res.rows[0].amount_in, huge, 'amount must round-trip exactly');
});

test('rejects an invalid side and an invalid status', options, async () => {
  await rejects(
    `INSERT INTO trades (identity_id, chain, token_address, side, amount_in) VALUES ($1,$2,'0xt','sideways',1)`,
    [IDENTITY, CHAIN],
    'side must be buy or sell'
  );
  await rejects(
    `INSERT INTO trades (identity_id, chain, token_address, side, amount_in, status)
     VALUES ($1,$2,'0xt','buy',1,'teleported')`,
    [IDENTITY, CHAIN],
    'status must be a known state'
  );
});

test('a confirmed trade cannot exist without a transaction hash', options, async () => {
  await rejects(
    `INSERT INTO trades (identity_id, chain, token_address, side, amount_in, status)
     VALUES ($1,$2,'0xt','buy',1,'confirmed')`,
    [IDENTITY, CHAIN],
    'confirmed trades must carry tx_hash'
  );
});

test('the same transaction hash cannot be recorded twice on a chain', options, async () => {
  const hash = `0x${crypto.randomBytes(32).toString('hex')}`;
  const first = await db.query(
    `INSERT INTO trades (identity_id, chain, token_address, side, amount_in, status, tx_hash)
     VALUES ($1,$2,'0xt','buy',1,'submitted',$3) RETURNING id`,
    [IDENTITY, CHAIN, hash]
  );
  created.trades.push(first.rows[0].id);
  await rejects(
    `INSERT INTO trades (identity_id, chain, token_address, side, amount_in, status, tx_hash)
     VALUES ($1,$2,'0xt','sell',1,'submitted',$3)`,
    [IDENTITY, CHAIN, hash],
    'duplicate tx_hash must be rejected'
  );
});

test('a deposit is credited only once per transaction', options, async () => {
  const hash = `0x${crypto.randomBytes(32).toString('hex')}`;
  await db.query(
    `INSERT INTO deposits (identity_id, chain, amount, tx_hash) VALUES ($1,$2,1000,$3)`,
    [IDENTITY, CHAIN, hash]
  );
  await rejects(
    `INSERT INTO deposits (identity_id, chain, amount, tx_hash) VALUES ($1,$2,1000,$3)`,
    [IDENTITY, CHAIN, hash],
    'the same deposit must not be credited twice'
  );
});

test('cashback can never exceed the fee charged', options, async () => {
  const res = await db.query(
    `INSERT INTO trades (identity_id, chain, token_address, side, amount_in, status, tx_hash)
     VALUES ($1,$2,'0xt','buy',1000,'submitted',$3) RETURNING id`,
    [IDENTITY, CHAIN, `0x${crypto.randomBytes(32).toString('hex')}`]
  );
  const tradeId = res.rows[0].id;
  created.trades.push(tradeId);

  await db.query(
    `INSERT INTO fee_ledger (trade_id, fee_amount, cashback_amount, fee_bps, currency)
     VALUES ($1, 100, 90, 10, 'ETH')`,
    [tradeId]
  );

  const second = await db.query(
    `INSERT INTO trades (identity_id, chain, token_address, side, amount_in, status, tx_hash)
     VALUES ($1,$2,'0xt','buy',1000,'submitted',$3) RETURNING id`,
    [IDENTITY, CHAIN, `0x${crypto.randomBytes(32).toString('hex')}`]
  );
  created.trades.push(second.rows[0].id);

  await rejects(
    `INSERT INTO fee_ledger (trade_id, fee_amount, cashback_amount, fee_bps, currency)
     VALUES ($1, 100, 150, 10, 'ETH')`,
    [second.rows[0].id],
    'cashback above the fee must be rejected'
  );
});

test('a filled limit order must reference the trade that filled it', options, async () => {
  await rejects(
    `INSERT INTO limit_orders (identity_id, chain, token_address, side, amount_in, trigger_price, status)
     VALUES ($1,$2,'0xt','buy',1000,1.5,'filled')`,
    [IDENTITY, CHAIN],
    'a filled order needs filled_trade_id'
  );

  const ok = await db.query(
    `INSERT INTO limit_orders (identity_id, chain, token_address, side, amount_in, trigger_price)
     VALUES ($1,$2,'0xt','buy',1000,1.5) RETURNING id, status`,
    [IDENTITY, CHAIN]
  );
  assert.equal(ok.rows[0].status, 'open', 'orders start open');
});

test('a limit order cannot trigger at a non-positive price', options, async () => {
  await rejects(
    `INSERT INTO limit_orders (identity_id, chain, token_address, side, amount_in, trigger_price)
     VALUES ($1,$2,'0xt','buy',1000,0)`,
    [IDENTITY, CHAIN],
    'trigger_price must be > 0'
  );
});

test('one bot wallet per identity per chain', options, async () => {
  await db.query(
    `INSERT INTO bot_wallets (identity_id, provider_wallet_id, chain, address) VALUES ($1,'tk-1',$2,'0xaaa')`,
    [IDENTITY, CHAIN]
  );
  await rejects(
    `INSERT INTO bot_wallets (identity_id, provider_wallet_id, chain, address) VALUES ($1,'tk-2',$2,'0xbbb')`,
    [IDENTITY, CHAIN],
    'a second wallet on the same chain must be rejected'
  );
});

test('a withdrawal cannot be for zero or a negative amount', options, async () => {
  await rejects(
    `INSERT INTO withdrawals (identity_id, chain, amount, destination) VALUES ($1,$2,0,'0xdest')`,
    [IDENTITY, CHAIN],
    'amount must be positive'
  );
});
