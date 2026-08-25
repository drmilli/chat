/**
 * RouterSet — the failover and best-quote layer over the adapters.
 *
 * D-005 picked 1inch primary, 0x fallback. Two modes, and the distinction is
 * about cost, not correctness:
 *
 *   quote()     — try in order, take the first that answers. One API call in
 *                 the common case. The default.
 *   quoteBest() — ask everyone, take the highest output. Strictly better
 *                 pricing, N times the API spend and bounded by the slowest
 *                 adapter. Worth it above a size threshold.
 *
 * Failure handling is the reason this class exists: a router that is *down*
 * (RouterUnavailableError) must be skipped, while a pair that genuinely has
 * *no route* anywhere must surface as no route rather than as an outage.
 */

const { NoRouteError, RouterUnavailableError } = require('./base');
const { OneInchRouter } = require('./oneinch');
const { ZeroExRouter } = require('./zeroex');

class AllRoutersFailedError extends Error {
  constructor(failures) {
    const detail = failures.map((f) => `${f.router}: ${f.message}`).join('; ');
    super(`No router could fill this trade — ${detail}`);
    this.name = 'AllRoutersFailedError';
    this.failures = failures;
    // If every failure was "no route", the pair is untradeable, which is a
    // user-facing fact. If any was an outage, this is our problem, not theirs,
    // and the UI should say so differently.
    this.noRouteEverywhere = failures.every((f) => f.type === 'NoRouteError');
  }
}

class RouterSet {
  /** @param {import('./base').Router[]} routers in preference order */
  constructor(routers, options = {}) {
    if (!routers?.length) throw new Error('RouterSet needs at least one router');
    this.routers = routers;
    this.warn = options.warn || ((msg) => console.warn(msg));
  }

  /** Builds the D-005 default set, skipping any router without credentials. */
  static fromEnv(options = {}) {
    const candidates = [new OneInchRouter(options), new ZeroExRouter(options)];
    const usable = candidates.filter((r) => r.configured);
    if (!usable.length) {
      throw new Error(
        'No router is configured. Set ONEINCH_API_KEY (primary) and ideally ZEROEX_API_KEY ' +
          '(fallback) — with neither, no trade can be routed.'
      );
    }
    if (usable.length === 1) {
      (options.warn || console.warn)(
        `Only ${usable[0].name} is configured. D-005 calls for a fallback router so that an ` +
          'aggregator outage degrades pricing rather than stopping trading.'
      );
    }
    return new RouterSet(usable, options);
  }

  async _tryEach(method, params) {
    const failures = [];
    for (const router of this.routers) {
      try {
        return await router[method](params);
      } catch (err) {
        const type = err instanceof NoRouteError ? 'NoRouteError'
          : err instanceof RouterUnavailableError ? 'RouterUnavailableError'
          : err.name || 'Error';
        failures.push({ router: router.name, message: err.message, type });
        this.warn(`Router ${router.name}.${method} failed (${err.message}); trying next`);
      }
    }
    throw new AllRoutersFailedError(failures);
  }

  quote(params) {
    return this._tryEach('quote', params);
  }

  buildTransaction(params) {
    return this._tryEach('buildTransaction', params);
  }

  /**
   * Queries every router and returns the best output. Individual failures are
   * tolerated; only a total wipeout throws.
   */
  async quoteBest(params) {
    const settled = await Promise.allSettled(this.routers.map((r) => r.quote(params)));

    const quotes = [];
    const failures = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') quotes.push(result.value);
      else {
        failures.push({
          router: this.routers[i].name,
          message: result.reason?.message || String(result.reason),
          type: result.reason?.name || 'Error',
        });
      }
    });

    if (!quotes.length) throw new AllRoutersFailedError(failures);

    // BigInt comparison — reduce, because Math.max would coerce to Number and
    // silently lose precision at uint256 scale.
    return quotes.reduce((best, q) => (q.amountOut > best.amountOut ? q : best));
  }
}

module.exports = {
  RouterSet,
  AllRoutersFailedError,
  OneInchRouter,
  ZeroExRouter,
  ...require('./base'),
};
