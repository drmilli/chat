/**
 * 0x adapter — the fallback router (D-005 item 1).
 *
 * Its value is not being better than 1inch; it is being *different*. A second
 * quote source with independent infrastructure means an aggregator outage
 * degrades quality rather than stopping trading. 0x brings RFQ-based liquidity
 * for stock tokens, which on this chain is a genuinely different fill path.
 *
 * ⚠️ Same caveat as the 1inch adapter: endpoints are from documentation, field
 * mapping is unverified against a live key. See T-305.
 */

const { Router, NoRouteError, requestJson } = require('./base');

const API_BASE = process.env.ZEROEX_API_BASE || 'https://api.0x.org/swap/permit2';

class ZeroExRouter extends Router {
  constructor(options = {}) {
    super('0x');
    this.apiKey = options.apiKey ?? process.env.ZEROEX_API_KEY;
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
      throw new Error('ZEROEX_API_KEY is not set; the 0x router cannot be used.');
    }
    return { '0x-api-key': this.apiKey, '0x-version': 'v2', Accept: 'application/json' };
  }

  _url(path, params) {
    return `${this.baseUrl}/${path}?${new URLSearchParams(params).toString()}`;
  }

  _normalise(body, params, tx = null) {
    const rawOut = body?.buyAmount ?? body?.minBuyAmount;
    if (rawOut == null) {
      throw new NoRouteError(
        this.name,
        `response had no buyAmount (keys: ${Object.keys(body || {}).join(', ')})`
      );
    }
    const amountOut = BigInt(rawOut);
    if (amountOut === 0n) throw new NoRouteError(this.name, 'quoted zero output');

    // 0x reports estimatedPriceImpact as a percentage string ("1.234").
    let priceImpactBps = null;
    if (body.estimatedPriceImpact != null) {
      const pct = Number(body.estimatedPriceImpact);
      if (Number.isFinite(pct)) priceImpactBps = Math.round(pct * 100);
    }

    return {
      router: this.name,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: BigInt(params.amountIn),
      amountOut,
      priceImpactBps,
      fetchedAt: this.now(),
      tx,
      raw: body,
    };
  }

  _params(params) {
    return {
      chainId: String(params.chainId),
      sellToken: params.tokenIn,
      buyToken: params.tokenOut,
      sellAmount: String(params.amountIn),
      taker: params.taker,
      slippageBps: String(params.slippageBps),
    };
  }

  async quote(params) {
    const body = await requestJson(this._url('price', this._params(params)), {
      fetchImpl: this.fetchImpl,
      headers: this._headers(),
      timeoutMs: this.timeoutMs,
      router: this.name,
    });
    return this._normalise(body, params);
  }

  async buildTransaction(params) {
    const body = await requestJson(this._url('quote', this._params(params)), {
      fetchImpl: this.fetchImpl,
      headers: this._headers(),
      timeoutMs: this.timeoutMs,
      router: this.name,
    });

    const tx = body?.transaction;
    if (!tx?.to || !tx?.data) {
      throw new NoRouteError(this.name, 'quote response contained no transaction');
    }

    return this._normalise(body, params, {
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value ?? 0),
    });
  }
}

module.exports = { ZeroExRouter, API_BASE };
