/**
 * services/execution — trade execution for Robinhood Chain (T-402).
 *
 * Built on D-005, where the chain model was confirmed rather than assumed:
 * Arbitrum Orbit (Nitro) L2, chain id 4663, ETH gas, FCFS ordering, no public
 * mempool. Two consequences run through the whole module:
 *
 *   • There is no MEV relay to integrate and none to hide behind, so the
 *     slippage and freshness guards in slippage.js are the real user protection.
 *   • Priority-fee bidding buys nothing under FCFS, so gas.js estimates and
 *     bounds rather than escalating.
 *
 * Not in this module by design:
 *   • Key custody — injected as a Signer (T-401, Turnkey per D-002).
 *   • Fee sweeps and the ledger — T-503, next to the database.
 *   • Limit-order lifecycle — T-407; this engine executes one swap at a time.
 */

module.exports = {
  ...require('./chains'),
  ...require('./rpc'),
  ...require('./gas'),
  ...require('./slippage'),
  ...require('./nonce'),
  ...require('./confirm'),
  ...require('./router'),
  ...require('./engine'),
};
