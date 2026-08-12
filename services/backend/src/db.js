const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon closes idle connections; recycle ours first so we rarely hand out a
  // socket the server has already dropped.
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 20000),
  // Neon scales the compute to zero when idle, and waking it routinely takes
  // longer than 10s. A short cap here turns a normal cold start into a hard
  // "Connection terminated due to connection timeout" for the first request.
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 30000),
  max: Number(process.env.PG_POOL_MAX || 10),
  keepAlive: true,
});

// Without this listener, an idle client dropping (EADDRNOTAVAIL, ECONNRESET,
// Neon idle timeout) raises an unhandled 'error' event and kills the process —
// the API then looks "up but broken" to every client until someone restarts it.
pool.on('error', (err) => {
  console.error('Postgres pool error (connection discarded, service continues):', err.message);
});

// Transport-level failures. Retrying these is only safe when we know the
// statement never reached the server (see isSafeToRetry).
const RETRYABLE_CODES = new Set([
  'EADDRNOTAVAIL',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND', // transient DNS failure, e.g. after a network switch or sleep
  'EAI_AGAIN', // resolver temporarily unavailable
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
]);

// pg-pool raises this as a plain Error with no code when it gives up waiting
// for a client. The statement provably never ran, so it is always safe to retry.
const ACQUISITION_TIMEOUT = /connection timeout|timeout exceeded when trying to connect/i;

const WRITE_STATEMENT = /^\s*(insert|update|delete|alter|drop|create|truncate)/i;

const MAX_RETRIES = Number(process.env.PG_QUERY_RETRIES || 2);

function isSafeToRetry(err, text) {
  // Never reached the database — retrying cannot duplicate anything.
  if (ACQUISITION_TIMEOUT.test(err?.message || '')) return true;
  if (!RETRYABLE_CODES.has(err?.code)) return false;
  // A transport error can also fire after a statement was already committed.
  // Reads are idempotent; writes are not, so they surface the failure instead
  // of risking a duplicate row.
  return !WRITE_STATEMENT.test(text);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A dead pooled connection, a DNS blip or a Neon cold start all surface as an
 * error on the first query that uses them. Retrying the safe cases turns a
 * user-visible 500 into a slightly slower response.
 */
async function query(text, params) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isSafeToRetry(err, text)) throw err;
      const backoff = 250 * 2 ** attempt;
      console.warn(`Retrying query in ${backoff}ms after ${err.code || err.message}`);
      await delay(backoff);
    }
  }
}

module.exports = {
  query,
  getClient: () => pool.connect(),
  pool,
};
