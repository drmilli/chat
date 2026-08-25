/**
 * The Router interface every aggregator adapter implements (D-005 item 1).
 *
 * The point of this seam: nothing above it — route handlers, the engine, the
 * trade panel — may know which aggregator filled an order. D-005 picked 1inch
 * primary and 0x fallback precisely so that an aggregator outage is not an
 * outage, and that only holds if no caller reaches past this interface.
 *
 * Adapters normalise into one Quote shape:
 *
 *   {
 *     router: string,          // adapter name, recorded against the trade
 *     tokenIn, tokenOut: string,
 *     amountIn: bigint,        // exact input
 *     amountOut: bigint,       // expected output, BEFORE slippage
 *     priceImpactBps: number|null,
 *     fetchedAt: number,       // ms epoch — slippage.js refuses stale quotes
 *     tx: {to, data, value} | null,   // populated by buildTransaction
 *     raw: object,             // the untouched provider response
 *   }
 */

class NoRouteError extends Error {
  constructor(router, detail) {
    super(`${router}: no route available${detail ? ` — ${detail}` : ''}`);
    this.name = 'NoRouteError';
    this.router = router;
  }
}

class RouterUnavailableError extends Error {
  constructor(router, detail) {
    super(`${router}: unavailable — ${detail}`);
    this.name = 'RouterUnavailableError';
    this.router = router;
  }
}

/** The native gas token, by the pseudo-address both aggregators use for it. */
const NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function isNative(address) {
  return String(address).toLowerCase() === NATIVE_TOKEN;
}

class Router {
  constructor(name) {
    this.name = name;
  }

  /* eslint-disable no-unused-vars */
  /**
   * @param {{chainId: number, tokenIn: string, tokenOut: string, amountIn: bigint,
   *          taker: string, slippageBps: number}} params
   * @returns {Promise<object>} normalised Quote
   */
  async quote(params) {
    throw new Error(`${this.name}: quote() not implemented`);
  }

  /**
   * Returns the quote with `tx` populated and ready to sign.
   * Kept separate from quote() because a price check should not require the
   * calldata, and some providers charge differently for the two.
   */
  async buildTransaction(params) {
    throw new Error(`${this.name}: buildTransaction() not implemented`);
  }
  /* eslint-enable no-unused-vars */
}

/** Shared HTTP helper: injectable fetch, timeout, and useful error text. */
async function requestJson(url, { fetchImpl, headers = {}, timeoutMs = 8000, router }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new RouterUnavailableError(router, `non-JSON response (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const detail = body?.description || body?.reason || body?.message || `HTTP ${res.status}`;
      // 4xx here usually means "no liquidity for this pair", which is a route
      // problem, not an outage — the difference decides whether we fail over.
      if (res.status >= 400 && res.status < 500) throw new NoRouteError(router, detail);
      throw new RouterUnavailableError(router, detail);
    }
    return body;
  } catch (err) {
    if (err instanceof NoRouteError || err instanceof RouterUnavailableError) throw err;
    throw new RouterUnavailableError(router, err.message);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { Router, NoRouteError, RouterUnavailableError, NATIVE_TOKEN, isNative, requestJson };
