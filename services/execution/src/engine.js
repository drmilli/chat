/**
 * ExecutionEngine — quote → guard → build → estimate → sign → broadcast → confirm.
 *
 * The engine never holds a key. Signing goes through an injected Signer:
 *
 *   { address: string,
 *     signTransaction(tx): Promise<{ raw: string, hash: string }> }
 *
 * That interface IS the T-401 seam. Turnkey drops in behind it, and so does a
 * local dev key, without this file changing. Keeping key custody outside the
 * engine is also what keeps D-002's "self-managed key storage stays prohibited"
 * true by construction rather than by discipline.
 *
 * The result object is shaped to map onto the `trades` row from migration 007,
 * including the states its CHECK constraints allow — in particular a timed-out
 * submission comes back as `submitted` WITH a tx_hash, which is exactly what
 * `trades_hash_required_when_submitted` demands.
 *
 * ERROR CONTRACT — the dividing line is nonce allocation:
 *
 *   BEFORE it (bad input, policy denial, no route, stale or zero quote, gas
 *   over the ceiling) executeSwap THROWS. Nothing was committed, no gas was
 *   spent, and there is no trade to record — writing a `trades` row for a
 *   rejected quote would fill the table with entries that have no tx hash and
 *   no economic meaning. Callers turn these into a 4xx.
 *
 *   FROM it onward executeSwap RETURNS a row, whatever happened. Once a nonce
 *   is allocated the attempt is real and must be recorded — including the
 *   `submitted` case, where the chain may still be about to confirm.
 */

const { guardQuote, DEFAULT_SLIPPAGE_BPS } = require('./slippage');
const { GasEstimator } = require('./gas');
const { NonceManager, isNonceError } = require('./nonce');
const { Confirmer, ConfirmationTimeoutError, TransactionFailedError } = require('./confirm');
const { RouterSet } = require('./router');
const { RpcClient } = require('./rpc');
const { getChain } = require('./chains');

class ExecutionEngine {
  constructor(options = {}) {
    this.chain = options.chain || getChain(process.env.TRADE_CHAIN || 'robinhood');
    this.rpc = options.rpc || new RpcClient(this.chain.rpcUrls, options);
    this.routers = options.routers || RouterSet.fromEnv(options);
    this.gas = options.gas || new GasEstimator(this.rpc, this.chain, options);
    this.nonces = options.nonces || new NonceManager(this.rpc, options);
    this.confirmer = options.confirmer || new Confirmer(this.rpc, this.chain, options);
    this.signer = options.signer;
    // Optional policy hook (T-401): per-tx caps, allowed tokens, rate limits.
    // Checked before anything irreversible happens.
    this.policy = options.policy || null;
    this.now = options.now || (() => Date.now());
    this.warn = options.warn || ((msg) => console.warn(msg));
  }

  /** One-time startup check: the RPC really serves the chain we sign for. */
  async preflight() {
    await this.rpc.assertChainId(this.chain.chainId);
    if (!this.signer?.address || typeof this.signer.signTransaction !== 'function') {
      throw new Error('ExecutionEngine requires a signer with { address, signTransaction }');
    }
    return { chainId: this.chain.chainId, signer: this.signer.address };
  }

  /**
   * Executes a market swap.
   *
   * @param {object} params
   * @param {string} params.identityId
   * @param {string} [params.roomId]
   * @param {string} params.tokenIn
   * @param {string} params.tokenOut
   * @param {bigint|string} params.amountIn  gross amount the user committed
   * @param {'buy'|'sell'} params.side
   * @param {bigint|string} [params.feeAmount] withheld from amountIn; the sweep
   *        that actually moves it to the treasury is T-503, not this engine.
   * @param {number} [params.slippageBps]
   */
  async executeSwap(params) {
    const {
      identityId,
      roomId = null,
      tokenIn,
      tokenOut,
      side,
      slippageBps = DEFAULT_SLIPPAGE_BPS,
      bestQuote = false,
    } = params;

    if (side !== 'buy' && side !== 'sell') {
      throw new RangeError(`side must be "buy" or "sell"; got ${JSON.stringify(side)}`);
    }

    const grossAmountIn = BigInt(params.amountIn);
    const feeAmount = BigInt(params.feeAmount ?? 0);
    if (feeAmount < 0n || feeAmount > grossAmountIn) {
      throw new RangeError('feeAmount must be between 0 and amountIn');
    }
    // Swap what is left after the fee is withheld (D-004).
    const amountIn = grossAmountIn - feeAmount;
    if (amountIn <= 0n) throw new RangeError('Nothing left to swap after the fee');

    const base = {
      identity_id: identityId,
      room_id: roomId,
      chain: this.chain.key,
      // `trades.token_address` is the traded token: what we bought, or what we sold.
      token_address: side === 'buy' ? tokenOut : tokenIn,
      side,
      order_type: 'market',
      amount_in: grossAmountIn.toString(),
      fee_amount: feeAmount.toString(),
    };

    // Policy first — before a quote is even fetched, so a blocked trade costs
    // no API calls and touches nothing.
    if (this.policy) {
      await this.policy.assertAllowed({ ...params, amountIn, chain: this.chain });
    }

    const taker = this.signer.address;
    const quoteParams = {
      chainId: this.chain.chainId,
      tokenIn,
      tokenOut,
      amountIn,
      taker,
      slippageBps,
    };

    // 1 — quote and guard. Fail closed: a stale, zero or high-impact quote
    // never reaches the signer.
    const quote = bestQuote
      ? await this.routers.quoteBest(quoteParams)
      : await this.routers.quote(quoteParams);
    const guard = guardQuote(quote, { slippageBps, now: this.now() });

    // 2 — build calldata. Re-quoted through the same router that priced it, so
    // the transaction matches the quote the guards approved.
    const built = await this.routers.buildTransaction({ ...quoteParams, router: quote.router });
    if (!built.tx) throw new Error(`${built.router} returned no transaction to sign`);

    // 3 — gas, Nitro-aware, with the hard ceiling (D-005 item 4).
    const gas = await this.gas.estimate({
      from: taker,
      to: built.tx.to,
      data: built.tx.data,
      value: built.tx.value,
    });

    // 4 — nonce. From here a failure may need the nonce released.
    const nonce = await this.nonces.allocate(taker);
    let broadcast = false;

    try {
      const unsigned = {
        type: 2,
        chainId: this.chain.chainId,
        to: built.tx.to,
        data: built.tx.data,
        value: built.tx.value ?? 0n,
        nonce,
        gasLimit: gas.gasLimit,
        maxFeePerGas: gas.maxFeePerGas,
        maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
      };

      const { raw, hash } = await this.signer.signTransaction(unsigned);

      // 5 — broadcast. Past this point the nonce is spent whatever happens:
      // the bytes may be on the network even if we never see the response.
      broadcast = true;
      const result = await this.confirmer.submitAndConfirm(raw, hash);

      return {
        ...base,
        status: 'confirmed',
        tx_hash: result.hash,
        amount_out: built.amountOut.toString(),
        min_amount_out: guard.minAmountOut.toString(),
        confirmed_at: new Date(this.now()).toISOString(),
        router: built.router,
        gas_used: result.gasUsed.toString(),
        effective_gas_price: result.effectiveGasPrice.toString(),
        block_number: result.blockNumber,
      };
    } catch (err) {
      if (!broadcast) {
        // Nothing was sent — the nonce is genuinely unused, so give it back
        // rather than leaving a gap that stalls this wallet's next trade.
        await this.nonces.release(taker, nonce);
      }
      if (isNonceError(err)) this.nonces.reset(taker);

      // A transaction that was broadcast but not yet mined is NOT a failure.
      // Recording it failed would contradict a chain that may still confirm it;
      // hand back `submitted` + the hash so a reconciler can finish the job.
      if (err instanceof ConfirmationTimeoutError) {
        this.warn(`Trade for ${identityId} timed out awaiting confirmation: ${err.hash}`);
        return {
          ...base,
          status: 'submitted',
          tx_hash: err.hash,
          amount_out: null,
          min_amount_out: guard.minAmountOut.toString(),
          error: err.message,
          router: built.router,
        };
      }

      if (err instanceof TransactionFailedError) {
        return {
          ...base,
          status: 'failed',
          tx_hash: err.hash,
          amount_out: null,
          min_amount_out: guard.minAmountOut.toString(),
          error: err.message,
          router: built.router,
        };
      }

      return {
        ...base,
        status: 'failed',
        tx_hash: null,
        amount_out: null,
        error: err.message,
        router: built.router,
      };
    }
  }
}

module.exports = { ExecutionEngine };
