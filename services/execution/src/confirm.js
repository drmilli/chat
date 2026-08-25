/**
 * Broadcast and confirmation tracking (T-402).
 *
 * Two rules govern everything here.
 *
 * 1. NEVER re-sign on failure. Retrying a broadcast re-sends the SAME signed
 *    bytes, which is safe because the hash is deterministic — a node that has
 *    seen it replies "already known", which is success, not an error. Building
 *    a fresh transaction after a timeout is what produces two live swaps for
 *    one user intent.
 *
 * 2. A receipt with status 0x0 is a FAILED trade, not a successful submission.
 *    The transaction was mined and the swap reverted; the user paid gas and got
 *    nothing. Reporting that as success is the worst bug this file could have,
 *    so it is the one thing tested most heavily.
 */

const { delay } = require('./rpc');
const { isNonceError } = require('./nonce');

/** 100ms blocks — poll fast; a swap normally confirms in well under a second. */
const POLL_INTERVAL_MS = Number(process.env.CONFIRM_POLL_INTERVAL_MS || 250);
const CONFIRM_TIMEOUT_MS = Number(process.env.CONFIRM_TIMEOUT_MS || 60_000);
const BROADCAST_ATTEMPTS = Number(process.env.BROADCAST_ATTEMPTS || 3);

/** "already known"/"known transaction" means the network HAS it. That is success. */
const ALREADY_KNOWN = /already known|known transaction|transaction already exists/i;

class TransactionFailedError extends Error {
  constructor(hash, receipt) {
    super(`Transaction ${hash} reverted on chain (status 0x0). Gas was spent; nothing was swapped.`);
    this.name = 'TransactionFailedError';
    this.hash = hash;
    this.receipt = receipt;
  }
}

class ConfirmationTimeoutError extends Error {
  constructor(hash, waitedMs) {
    super(
      `Transaction ${hash} was broadcast but not mined within ${waitedMs}ms. ` +
        'It may still confirm — do NOT re-sign; reconcile by hash.'
    );
    this.name = 'ConfirmationTimeoutError';
    this.hash = hash;
    this.waitedMs = waitedMs;
    // The caller must persist the hash and let a reconciler finish the job.
    // Marking this trade failed here would be a lie the chain may contradict.
    this.recoverable = true;
  }
}

class Confirmer {
  constructor(rpc, chain, options = {}) {
    this.rpc = rpc;
    this.chain = chain;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? CONFIRM_TIMEOUT_MS;
    this.attempts = options.attempts ?? BROADCAST_ATTEMPTS;
    this.confirmations = options.confirmations ?? chain.confirmations ?? 1;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || delay;
    this.warn = options.warn || ((msg) => console.warn(msg));
  }

  /**
   * Broadcasts already-signed bytes. Idempotent by construction.
   *
   * @param {string} signedTx 0x-prefixed raw transaction
   * @param {string} [expectedHash] the hash computed at signing time
   * @returns {Promise<string>} transaction hash
   */
  async broadcast(signedTx, expectedHash) {
    let lastError;

    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const hash = await this.rpc.sendRawTransaction(signedTx);
        if (expectedHash && hash && hash.toLowerCase() !== expectedHash.toLowerCase()) {
          // The node returned a different hash than the bytes we signed. Either
          // the transaction was mangled in transit or the provider is not
          // honest; either way, stop rather than track the wrong hash.
          throw new Error(`Node returned hash ${hash}, expected ${expectedHash}`);
        }
        return hash;
      } catch (err) {
        lastError = err;

        if (ALREADY_KNOWN.test(err.message || '')) {
          // The network already has it. This is the happy path on a retry.
          if (!expectedHash) throw err; // nothing to report back
          return expectedHash;
        }

        if (isNonceError(err)) {
          // Our nonce view has diverged. Re-broadcasting identical bytes cannot
          // fix that, and the caller must resync before building anything new.
          err.nonceDiverged = true;
          throw err;
        }

        if (attempt < this.attempts) {
          this.warn(`Broadcast attempt ${attempt} failed (${err.message}); resending identical bytes`);
          await this.sleep(this.pollIntervalMs * attempt);
        }
      }
    }

    throw lastError;
  }

  /**
   * Polls for the receipt.
   *
   * @returns {Promise<{hash: string, status: 'confirmed', blockNumber: number,
   *                    gasUsed: bigint, effectiveGasPrice: bigint, receipt: object}>}
   * @throws {TransactionFailedError} on an on-chain revert
   * @throws {ConfirmationTimeoutError} if it has not mined in time
   */
  async waitForConfirmation(hash, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const needed = options.confirmations ?? this.confirmations;
    const startedAt = this.now();

    for (;;) {
      const receipt = await this.rpc.getTransactionReceipt(hash);

      if (receipt) {
        // status is hex: 0x1 success, 0x0 reverted.
        if (BigInt(receipt.status ?? '0x0') === 0n) {
          throw new TransactionFailedError(hash, receipt);
        }

        if (needed > 1) {
          const head = await this.rpc.blockNumber();
          const depth = head - Number(BigInt(receipt.blockNumber)) + 1;
          if (depth < needed) {
            await this.sleep(this.pollIntervalMs);
            continue;
          }
        }

        return {
          hash,
          status: 'confirmed',
          blockNumber: Number(BigInt(receipt.blockNumber)),
          gasUsed: BigInt(receipt.gasUsed ?? '0x0'),
          effectiveGasPrice: BigInt(receipt.effectiveGasPrice ?? '0x0'),
          receipt,
        };
      }

      const waited = this.now() - startedAt;
      if (waited >= timeoutMs) {
        throw new ConfirmationTimeoutError(hash, waited);
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  /** Broadcast then wait. The common path. */
  async submitAndConfirm(signedTx, expectedHash, options = {}) {
    const hash = await this.broadcast(signedTx, expectedHash);
    return this.waitForConfirmation(hash, options);
  }
}

module.exports = {
  Confirmer,
  TransactionFailedError,
  ConfirmationTimeoutError,
  POLL_INTERVAL_MS,
  CONFIRM_TIMEOUT_MS,
};
