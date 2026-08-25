-- Phase 6 trading schema.
--
-- Shaped by the P3 decisions:
--   D-001 launch chain is Robinhood Chain (EVM) -> `tx_hash`, not `tx_signature`
--   D-003 alpha ships limit orders as well as market -> `limit_orders`
--   D-004 fees are 0.1% flat + cashback -> fee and cashback recorded separately
--
-- MONEY IS NEVER A FLOAT. Raw on-chain amounts are stored as NUMERIC(78,0),
-- which holds a full uint256 exactly; human-readable values are derived at read
-- time from the token's decimals.

CREATE TABLE IF NOT EXISTS bot_wallets (
  id                SERIAL PRIMARY KEY,
  identity_id       TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL DEFAULT 'turnkey',
  provider_wallet_id TEXT NOT NULL,
  chain             TEXT NOT NULL,
  address           TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One wallet per identity per chain keeps deposit routing unambiguous.
  UNIQUE (identity_id, chain)
);

CREATE INDEX IF NOT EXISTS bot_wallets_address_idx ON bot_wallets(address);

CREATE TABLE IF NOT EXISTS trades (
  id            SERIAL PRIMARY KEY,
  identity_id   TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  room_id       TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  chain         TEXT NOT NULL,
  token_address TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type    TEXT NOT NULL DEFAULT 'market' CHECK (order_type IN ('market', 'limit')),
  amount_in     NUMERIC(78, 0) NOT NULL,
  amount_out    NUMERIC(78, 0),
  fee_amount    NUMERIC(78, 0) NOT NULL DEFAULT 0,
  tx_hash       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at  TIMESTAMPTZ,
  -- A submitted transaction must carry its hash, or it cannot be reconciled.
  CONSTRAINT trades_hash_required_when_submitted
    CHECK (status IN ('pending', 'failed') OR tx_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS trades_identity_idx ON trades(identity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trades_room_idx ON trades(room_id, created_at DESC);
-- Reconciliation looks trades up by hash; it must be unique per chain.
CREATE UNIQUE INDEX IF NOT EXISTS trades_tx_hash_idx ON trades(chain, tx_hash) WHERE tx_hash IS NOT NULL;
-- Finds work for the confirmation tracker.
CREATE INDEX IF NOT EXISTS trades_open_idx ON trades(status) WHERE status IN ('pending', 'submitted');

CREATE TABLE IF NOT EXISTS limit_orders (
  id              SERIAL PRIMARY KEY,
  identity_id     TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  room_id         TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  chain           TEXT NOT NULL,
  token_address   TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  amount_in       NUMERIC(78, 0) NOT NULL,
  trigger_price   NUMERIC(38, 18) NOT NULL CHECK (trigger_price > 0),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'filled', 'cancelled', 'expired', 'failed')),
  filled_trade_id INT REFERENCES trades(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A filled order must point at the trade that filled it.
  CONSTRAINT limit_orders_fill_link CHECK (status <> 'filled' OR filled_trade_id IS NOT NULL)
);

-- The price monitor scans open orders constantly; keep that scan cheap.
CREATE INDEX IF NOT EXISTS limit_orders_open_idx
  ON limit_orders(chain, token_address) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS limit_orders_identity_idx ON limit_orders(identity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deposits (
  id           SERIAL PRIMARY KEY,
  identity_id  TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  chain        TEXT NOT NULL,
  amount       NUMERIC(78, 0) NOT NULL,
  tx_hash      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  -- Deposit detection may see the same transaction repeatedly; credit it once.
  UNIQUE (chain, tx_hash)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id           SERIAL PRIMARY KEY,
  identity_id  TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  chain        TEXT NOT NULL,
  amount       NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
  destination  TEXT NOT NULL,
  tx_hash      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS withdrawals_identity_idx ON withdrawals(identity_id, created_at DESC);

-- D-004: fee and cashback are separate columns from the first trade. Netting
-- them into one number would make the accounting impossible to reconstruct.
CREATE TABLE IF NOT EXISTS fee_ledger (
  id              SERIAL PRIMARY KEY,
  trade_id        INT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  fee_amount      NUMERIC(78, 0) NOT NULL CHECK (fee_amount >= 0),
  cashback_amount NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (cashback_amount >= 0),
  fee_bps         INT NOT NULL,
  currency        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Never pay back more than was charged.
  CONSTRAINT fee_ledger_cashback_bounded CHECK (cashback_amount <= fee_amount),
  -- One ledger row per trade.
  UNIQUE (trade_id)
);
