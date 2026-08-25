/**
 * 1inch adapter — the primary router (D-005 item 1).
 *
 * Chosen primary because 1inch advertises explicit chain-4663 support across
 * Classic Swap and Fusion, including the RWA/stock-token routing that is this
 * chain's reason to exist.
 *
 * ⚠️ FIELD MAPPING IS UNVERIFIED. D-005 was desk research: the endpoints and
 * the chain id come from 1inch's own documentation, but no request in this repo
 * has ever been sent with a live API key. The response field names below follow
 * the documented v6 shape (`dstAmount`, `tx.{to,data,value}`) and are the most
 * likely thing to be wrong on first contact. Run the T-305 testnet swap before
 * trusting this with money — normaliseQuote() is deliberately strict so a
 * mismatch throws loudly instead of quietly quoting zero.
 */

const { Router, NoRouteError, requestJson } = require('./base');

const API_BASE = process.env.ONEINCH_API_BASE || 'https://api.1inch.dev/swap/v6.0';

class OneInchRouter extends Router {
  constructor(options = {}) {
    super('1inch');
    this.apiKey = options.apiKey ?? process.env.ONEINCH_API_KEY;
    this.baseUrl = options.baseUrl ?? API_BASE;
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.now = options.now || (() => Date.now());
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  _headers() {
    if (!this.apiKey) {
      // Fail closed and say which env var is missing, rather than sending an
      // unauthenticated request and reporting a confusing 401 as "no route".
      throw new Error('ONEINCH_API_KEY is not set; the 1inch router cannot be used.');
    }
    return { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' };
  }

  _url(chainId, path, params) {
    const qs = new URLSearchParams(params).toString();
    return `${this.baseUrl}/${chainId}/${path}?${qs}`;
  }

  /** Strict normalisation — an unexpected shape must throw, never quote zero. */
  _normalise(body, params, tx = null) {
    const rawOut = body?.dstAmount ?? body?.toAmount ?? body?.toTokenAmount;
    if (rawOut == null) {
      throw new NoRouteError(
        this.name,
        `response had no destination amount (keys: ${Object.keys(body || {}).join(', ')})`
      );
    }
    const amountOut = BigInt(rawOut);
    if (amountOut === 0n) throw new NoRouteError(this.name, 'quoted zero output');

    return {
      router: this.name,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: BigInt(params.amountIn),
      amountOut,
      // 1inch does not return price impact on the quote endpoint; slippage.js
      // treats null as "not reported" rather than "zero", which would be a lie.
      priceImpactBps: null,
      fetchedAt: this.now(),
      tx,
      raw: body,
    };
  }

  async quote(params) {
    const body = await requestJson(
      this._url(params.chainId, 'quote', {
        src: params.tokenIn,
        dst: params.tokenOut,
        amount: String(params.amountIn),
      }),
      { fetchImpl: this.fetchImpl, headers: this._headers(), timeoutMs: this.timeoutMs, router: this.name }
    );
    return this._normalise(body, params);
  }

  async buildTransaction(params) {
    const body = await requestJson(
      this._url(params.chainId, 'swap', {
        src: params.tokenIn,
        dst: params.tokenOut,
        amount: String(params.amountIn),
        from: params.taker,
        origin: params.taker,
        // 1inch takes slippage as a percentage, we carry it as bps everywhere.
        slippage: String(params.slippageBps / 100),
        // We apply our own guards and gas ceiling (gas.js), so let the router
        // return calldata even when its own simulation is unhappy — we would
        // rather see the revert reason from our own estimate.
        disableEstimate: 'true',
      }),
      { fetchImpl: this.fetchImpl, headers: this._headers(), timeoutMs: this.timeoutMs, router: this.name }
    );

    if (!body?.tx?.to || !body?.tx?.data) {
      throw new NoRouteError(this.name, 'swap response contained no transaction');
    }

    return this._normalise(body, params, {
      to: body.tx.to,
      data: body.tx.data,
      value: BigInt(body.tx.value ?? 0),
    });
  }
}

module.exports = { OneInchRouter, API_BASE };
