CREATE TABLE IF NOT EXISTS bans (
  id SERIAL PRIMARY KEY,
  identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocklist_patterns (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO blocklist_patterns (pattern)
VALUES
  ('scam.example.com'),
  ('free-audit.io'),
  ('nft.claim'),
  ('discord.gift/'),
  ('opensea.io.sell'),
  ('meta-mask'),
  ('walletconnect'),
  ('airdrop'),
  ('claim'),
  ('verify-account')
ON CONFLICT (pattern) DO NOTHING;
