/**
 * Multi-provider JSON-RPC client with failover (T-402, D-005 item 3).
 *
 * The distinction this file exists to make:
 *
 *   TRANSPORT failure — the provider did not answer (timeout, 5xx, socket
 *   error, rate limit). Nothing is known about whether the call happened.
 *   → fail over to the next provider.
 *
 *   APPLICATION failure — the provider answered, and the answer was an error
 *   ("execution reverted", "nonce too low", "insufficient funds"). That IS the
 *   chain's answer, and every other provider will say the same thing.
 *   → return it. Failing over here would turn one honest revert into three
 *     wasted round trips and hide the reason from the caller.
 *
 * Getting that backwards is how an execution engine ends up retrying a revert
 * until something eventually succeeds for the wrong reason.
 */

/**
 * Methods safe to re-send after a transport failure.
 *
 * Reads are trivially safe. `eth_sendRawTransaction` is on the list for a
 * non-obvious reason: a signed transaction has a deterministic hash, so
 * broadcasting it twice cannot produce two transactions — the second node
 * replies "already known". The real double-spend hazard is nonce reuse, and
 * that is nonce.js's job, not this file's.
 */
const IDEMPOTENT_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
  'eth_sendRawTransaction',
]);

/** A JSON-RPC error object came back — the node answered, so do not fail over. */
class RpcApplicationError extends Error {
  constructor(method, error) {
    super(`${method}: ${error?.message || 'JSON-RPC error'}`);
    this.name = 'RpcApplicationError';
    this.code = error?.code;
    this.data = error?.data;
    this.method = method;
  }
}

/** Every provider failed at the transport level. */
class RpcTransportError extends Error {
  constructor(method, failures) {
    const detail = failures.map((f) => `${f.url}: ${f.message}`).join('; ');
    super(`${method}: all ${failures.length} RPC provider(s) failed — ${detail}`);
    this.name = 'RpcTransportError';
    this.method = method;
    this.failures = failures;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class RpcClient {
  /**
   * @param {string[]} urls Failover order; index 0 is primary.
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] Injectable so tests never touch the network.
   */
  constructor(urls, options = {}) {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('RpcClient needs at least one endpoint URL');
    }
    this.urls = urls;
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.warn = options.warn || ((msg) => console.warn(msg));
    this.now = options.now || (() => Date.now());

    // url -> timestamp before which we skip this provider.
    this.cooldownUntil = new Map();
    this.id = 0;

    if (urls.length === 1) {
      this.warn(
        'RpcClient: only one RPC endpoint configured. Every trade now depends on ' +
          'a single provider staying up — D-005 item 3 requires two.'
      );
    }
  }

  /** Providers to try, in order: those off cooldown first, then the rest. */
  _endpointOrder() {
    const now = this.now();
    const ready = [];
    const cooling = [];
    for (const url of this.urls) {
      if ((this.cooldownUntil.get(url) || 0) > now) cooling.push(url);
      else ready.push(url);
    }
    // If everything is cooling off, try anyway rather than fail outright — a
    // stale cooldown must never be the reason a trade cannot be submitted.
    return ready.concat(cooling);
  }

  async _postOnce(url, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        // 4xx/5xx from the provider is transport-level: an auth or quota
        // problem with THIS provider, not an answer from the chain.
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {string} method
   * @param {any[]} [params]
   * @param {{idempotent?: boolean}} [opts] Override the built-in classification.
   * @returns {Promise<any>} the JSON-RPC `result`
   */
  async call(method, params = [], opts = {}) {
    const idempotent = opts.idempotent ?? IDEMPOTENT_METHODS.has(method);
    const payload = { jsonrpc: '2.0', id: ++this.id, method, params };
    const failures = [];

    for (const url of this._endpointOrder()) {
      try {
        const body = await this._postOnce(url, payload);

        if (body && body.error) {
          // The chain answered. Every provider would answer the same.
          throw new RpcApplicationError(method, body.error);
        }
        // A successful call clears any cooldown this provider was serving.
        this.cooldownUntil.delete(url);
        return body ? body.result : undefined;
      } catch (err) {
        if (err instanceof RpcApplicationError) throw err;

        failures.push({ url, message: err.message });
        this.cooldownUntil.set(url, this.now() + this.cooldownMs);

        if (!idempotent) {
          // We cannot know whether the call landed. Re-sending a
          // non-idempotent method could duplicate its effect, so stop and let
          // the caller decide — silently retrying is how money moves twice.
          throw new RpcTransportError(method, failures);
        }
        this.warn(`RPC ${method} failed on ${url} (${err.message}); trying next provider`);
      }
    }

    throw new RpcTransportError(method, failures);
  }

  async chainId() {
    return Number(await this.call('eth_chainId'));
  }

  async getTransactionCount(address, block = 'pending') {
    return Number(await this.call('eth_getTransactionCount', [address, block]));
  }

  async getTransactionReceipt(hash) {
    return this.call('eth_getTransactionReceipt', [hash]);
  }

  async blockNumber() {
    return Number(await this.call('eth_blockNumber'));
  }

  async sendRawTransaction(signedTx) {
    return this.call('eth_sendRawTransaction', [signedTx]);
  }

  /**
   * Guards the misconfiguration that silently signs for the wrong network: an
   * RPC URL that does not serve the chain we think it does. Call at startup.
   */
  async assertChainId(expected) {
    const actual = await this.chainId();
    if (actual !== expected) {
      throw new Error(
        `RPC endpoint serves chain ${actual}, but this engine is configured for ${expected}. ` +
          'Refusing to sign for a chain nobody chose.'
      );
    }
    return actual;
  }
}

module.exports = { RpcClient, RpcApplicationError, RpcTransportError, IDEMPOTENT_METHODS, delay };
