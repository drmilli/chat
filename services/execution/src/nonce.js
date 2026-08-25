/**
 * Per-address nonce allocation (T-402).
 *
 * ⚠️ RUN ONE INSTANCE — same constraint as realtime/hub.js.
 * This tracker lives in process memory. Two processes signing for the SAME
 * address will hand out the same nonce twice, and the loser's transaction is
 * silently dropped as "nonce too low". Today that is contained: D-001's model
 * gives each identity its own wallet (bot_wallets is UNIQUE per identity+chain),
 * so two users never share an address. It stops being contained the moment a
 * shared operator/treasury wallet appears — a sweeper, a fee collector, a
 * withdrawal signer (T-500). Before that ships, move allocation into Postgres
 * (SELECT ... FOR UPDATE on a per-address row) or serialise it behind one worker.
 *
 * The core invariant: for a given address, no two callers may hold the same
 * nonce at the same time. Allocation is therefore serialised per address —
 * `await`ing the chain mid-allocation is exactly where a naive implementation
 * interleaves and issues duplicates.
 */

const DEFAULT_RESYNC_AFTER_MS = Number(process.env.NONCE_RESYNC_AFTER_MS || 60_000);

class NonceManager {
  /**
   * @param {import('./rpc').RpcClient} rpc
   */
  constructor(rpc, options = {}) {
    this.rpc = rpc;
    this.resyncAfterMs = options.resyncAfterMs ?? DEFAULT_RESYNC_AFTER_MS;
    this.now = options.now || (() => Date.now());
    this.warn = options.warn || ((msg) => console.warn(msg));

    // address (lowercased) -> {next, lastSyncedAt}
    this.state = new Map();
    // address -> promise chain, so allocations for one address never interleave.
    this.locks = new Map();
  }

  _key(address) {
    return String(address).toLowerCase();
  }

  /**
   * Serialises `fn` against other work for the same address. Failures do not
   * poison the chain for subsequent callers.
   */
  _withLock(address, fn) {
    const key = this._key(address);
    const previous = this.locks.get(key) || Promise.resolve();
    const run = previous.then(fn, fn);
    // Keep the chain alive but swallow the result so one rejection does not
    // reject every queued allocation behind it.
    this.locks.set(key, run.then(() => undefined, () => undefined));
    return run;
  }

  /** Reads the authoritative pending count from the chain. */
  async _sync(address) {
    const pending = await this.rpc.getTransactionCount(address, 'pending');
    this.state.set(this._key(address), { next: pending, lastSyncedAt: this.now() });
    return pending;
  }

  /**
   * Allocates the next nonce for `address`.
   *
   * Resyncs against the chain when the cached value is stale, so a transaction
   * submitted by something outside this process (a manual send, a restart mid-
   * flight) does not leave us permanently one behind.
   *
   * @returns {Promise<number>}
   */
  async allocate(address) {
    return this._withLock(address, async () => {
      const key = this._key(address);
      const cached = this.state.get(key);
      const stale = !cached || this.now() - cached.lastSyncedAt > this.resyncAfterMs;

      if (stale) {
        const pending = await this._sync(address);
        // Trust the chain when it is ahead of us; never move backwards, because
        // a lagging provider reporting a lower count would re-issue a nonce
        // that is already in flight.
        if (cached && cached.next > pending) {
          this.state.set(key, { next: cached.next, lastSyncedAt: this.now() });
        }
      }

      const entry = this.state.get(key);
      const nonce = entry.next;
      entry.next = nonce + 1;
      return nonce;
    });
  }

  /**
   * Returns an unused nonce to the pool after a submission that provably never
   * reached the chain (a build/sign failure, or a transport error where nothing
   * was broadcast).
   *
   * Only safe for the most recently allocated nonce: releasing one from the
   * middle would create a gap that stalls every later transaction until it is
   * filled. Anything else forces a resync instead, which is slower but correct.
   */
  release(address, nonce) {
    return this._withLock(address, () => {
      const key = this._key(address);
      const entry = this.state.get(key);
      if (!entry) return;
      if (entry.next === nonce + 1) {
        entry.next = nonce;
      } else {
        this.warn(
          `Nonce ${nonce} for ${address} is not the newest allocation (next=${entry.next}); ` +
            'forcing a resync rather than leaving a gap.'
        );
        this.state.delete(key);
      }
    });
  }

  /**
   * Drops cached state so the next allocation re-reads the chain. Call after a
   * "nonce too low"/"already known" error, which means our view has diverged.
   */
  reset(address) {
    this.state.delete(this._key(address));
  }

  peek(address) {
    return this.state.get(this._key(address))?.next ?? null;
  }
}

/** Errors that mean our nonce view has diverged from the chain. */
const NONCE_ERROR = /nonce too low|nonce too high|already known|replacement transaction underpriced|invalid nonce/i;

function isNonceError(err) {
  return NONCE_ERROR.test(err?.message || '');
}

module.exports = { NonceManager, isNonceError, DEFAULT_RESYNC_AFTER_MS };
