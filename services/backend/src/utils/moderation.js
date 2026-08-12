const blockedPatterns = [
  'scam.example.com',
  'free-audit.io',
  'nft.claim',
  'discord.gift/',
  'opensea.io.sell',
  'meta-mask',
  'walletconnect',
  'airdrop',
  'claim',
  'verify-account',
];

function normalizeText(text) {
  return (text || '').toLowerCase();
}

function contentMatchesBlockedPatterns(text, patterns = blockedPatterns) {
  const normalized = normalizeText(text);
  return patterns.some((pattern) => normalized.includes(pattern));
}

async function fetchActiveBlocklistPatterns(query) {
  try {
    const result = await query('SELECT pattern FROM blocklist_patterns WHERE active = true');
    return result.rows.map((row) => row.pattern);
  } catch (err) {
    return blockedPatterns;
  }
}

async function isBanned(query, identityId, roomId) {
  const whereClauses = ['active = true', '(expires_at IS NULL OR expires_at > NOW())'];
  const params = [];
  if (identityId) {
    params.push(identityId);
    whereClauses.push('(identity_id = $' + params.length + ' OR identity_id IS NULL)');
  }
  if (roomId) {
    params.push(roomId);
    whereClauses.push('(room_id = $' + params.length + ' OR room_id IS NULL)');
  }
  const sql = `SELECT 1 FROM bans WHERE ${whereClauses.join(' AND ')} LIMIT 1`;
  const result = await query(sql, params);
  return result.rowCount > 0;
}

module.exports = {
  contentMatchesBlockedPatterns,
  fetchActiveBlocklistPatterns,
  isBanned,
};
