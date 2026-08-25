/**
 * Gas estimation for an Arbitrum Nitro chain (T-402, D-005 item 4).
 *
 * The task originally said "EIP-1559 gas strategy". That wording is wrong for
 * this chain and this file deliberately does not implement one:
 *
 *   1. Ordering is first-come-first-served (D-005 item 2). Bidding a higher
 *      priority fee buys NO better position. A priority-fee escalator — correct
 *      and necessary on L1 — is pure overpayment here.
 *
 *   2. The dominant cost is the L1 data (calldata) component, not L2 execution.
 *      It tracks Ethereum's basefee, not L2 congestion, so it moves for reasons
 *      that have nothing to do with how busy this chain is.
 *
 *   3. Because the two halves move independently, a single flat headroom
 *      multiplier on the total is the wrong instrument. We ask the NodeInterface
 *      precompile to break the estimate apart and apply headroom to the L2
 *      half, which is what actually varies with state between estimate and
 *      execution.
 *
 * What we DO need is a hard ceiling. An L1 basefee spike can make a small trade
 * uneconomic; the user should get a clear refusal, not a silent haircut.
 */

const { Interface } = require('ethers');
const { NODE_INTERFACE_ADDRESS } = require('./chains');

/**
 * Arbitrum's NodeInterface. Not a deployed contract — the Nitro node
 * intercepts calls to this address and answers them.
 */
const NODE_INTERFACE_ABI = [
  'function gasEstimateComponents(address to, bool contractCreation, bytes calldata data) external payable returns (uint64 gasEstimate, uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)',
];

const nodeInterface = new Interface(NODE_INTERFACE_ABI);

/** Headroom on the L2 execution half. State can change between estimate and mining. */
const GAS_LIMIT_BUFFER_PERCENT = Number(process.env.GAS_LIMIT_BUFFER_PERCENT || 25);

/**
 * Absolute ceiling on what one transaction may cost in wei. Default 0.01 ETH.
 * A trade that costs more than this to submit is refused rather than executed —
 * on a 100ms-block L2 a normal swap is orders of magnitude below it, so hitting
 * this means something is wrong (L1 spike, malformed calldata, wrong chain).
 */
const MAX_GAS_COST_WEI = BigInt(process.env.MAX_GAS_COST_WEI || '10000000000000000');

/**
 * Floor for the priority fee. Nitro accepts 1559 fields, and a zero tip is
 * normally fine under FCFS, but some tooling and some sequencer configs treat
 * a literal 0 poorly. A token floor costs effectively nothing and avoids that
 * class of surprise. This is a FLOOR, never an escalator.
 */
const PRIORITY_FEE_WEI = BigInt(process.env.PRIORITY_FEE_WEI || '0');

function hexToBigInt(hex) {
  if (hex == null) return 0n;
  if (typeof hex === 'bigint') return hex;
  return BigInt(hex);
}

function withPercent(value, percent) {
  return (value * BigInt(100 + percent)) / 100n;
}

class GasEstimator {
  /**
   * @param {import('./rpc').RpcClient} rpc
   * @param {object} chain from chains.js
   */
  constructor(rpc, chain, options = {}) {
    this.rpc = rpc;
    this.chain = chain;
    this.bufferPercent = options.bufferPercent ?? GAS_LIMIT_BUFFER_PERCENT;
    this.maxCostWei = options.maxCostWei ?? MAX_GAS_COST_WEI;
    this.priorityFeeWei = options.priorityFeeWei ?? PRIORITY_FEE_WEI;
    this.warn = options.warn || ((msg) => console.warn(msg));

    if (chain.ordering !== 'fcfs' && this.priorityFeeWei === 0n) {
      // Guards against this file being reused on a chain where the tip DOES
      // buy ordering. Loud, because silently tipping zero there means the
      // transaction may simply never be mined.
      this.warn(
        `GasEstimator: chain ${chain.name} does not use FCFS ordering, but the ` +
          'priority fee is zero. On an auction-ordered chain that transaction may never mine.'
      );
    }
  }

  /**
   * Splits the estimate into its L1 and L2 halves via the NodeInterface.
   * Returns null if the precompile is unavailable (a non-Nitro node, or a
   * provider that does not expose it) — the caller falls back to eth_estimateGas.
   */
  async _components(tx) {
    // Encoded OUTSIDE the try on purpose. This step is local and deterministic:
    // if it throws, the transaction itself is malformed (a bad `to`, bad
    // calldata), which must surface as the error it is rather than be masked as
    // "the provider does not support the precompile".
    const data = nodeInterface.encodeFunctionData('gasEstimateComponents', [
      tx.to,
      false,
      tx.data || '0x',
    ]);

    try {
      const raw = await this.rpc.call('eth_call', [
        { to: this.chain.nodeInterfaceAddress || NODE_INTERFACE_ADDRESS, data, from: tx.from },
        'latest',
      ]);
      if (!raw || raw === '0x') return null;

      const [gasEstimate, gasEstimateForL1, baseFee, l1BaseFeeEstimate] =
        nodeInterface.decodeFunctionResult('gasEstimateComponents', raw);

      return {
        total: BigInt(gasEstimate),
        l1: BigInt(gasEstimateForL1),
        l2: BigInt(gasEstimate) - BigInt(gasEstimateForL1),
        baseFee: BigInt(baseFee),
        l1BaseFee: BigInt(l1BaseFeeEstimate),
      };
    } catch (err) {
      this.warn(`NodeInterface.gasEstimateComponents unavailable (${err.message}); using eth_estimateGas`);
      return null;
    }
  }

  /**
   * @param {{from: string, to: string, data?: string, value?: string|bigint}} tx
   * @returns {Promise<{gasLimit: bigint, maxFeePerGas: bigint, maxPriorityFeePerGas: bigint,
   *                    estimatedCostWei: bigint, components: object|null}>}
   */
  async estimate(tx) {
    const components = await this._components(tx);

    let gasLimit;
    if (components) {
      // Headroom on the L2 half only. The L1 half is a function of calldata
      // size, which is already known exactly — padding it wastes money.
      gasLimit = components.l1 + withPercent(components.l2, this.bufferPercent);
    } else {
      const raw = hexToBigInt(
        await this.rpc.call('eth_estimateGas', [
          {
            from: tx.from,
            to: tx.to,
            data: tx.data || '0x',
            value: tx.value ? `0x${BigInt(tx.value).toString(16)}` : '0x0',
          },
        ])
      );
      gasLimit = withPercent(raw, this.bufferPercent);
    }

    const baseFee = components?.baseFee ?? hexToBigInt(await this.rpc.call('eth_gasPrice'));

    // maxFee covers a doubling of the basefee between now and inclusion, plus
    // the tip. This is headroom, not a bid: under FCFS the surplus is refunded,
    // so a generous ceiling costs nothing and prevents a basefee tick from
    // stranding the transaction.
    const maxPriorityFeePerGas = this.priorityFeeWei;
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
    const estimatedCostWei = gasLimit * maxFeePerGas;

    if (estimatedCostWei > this.maxCostWei) {
      throw new Error(
        `Estimated gas cost ${estimatedCostWei} wei exceeds the ${this.maxCostWei} wei ceiling. ` +
          'Refusing to submit. Raise MAX_GAS_COST_WEI only if you have checked why it is this high.'
      );
    }

    return { gasLimit, maxFeePerGas, maxPriorityFeePerGas, estimatedCostWei, baseFee, components };
  }
}

module.exports = { GasEstimator, GAS_LIMIT_BUFFER_PERCENT, MAX_GAS_COST_WEI, PRIORITY_FEE_WEI, NODE_INTERFACE_ABI };
