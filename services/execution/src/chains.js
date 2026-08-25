/**
 * Chain registry.
 *
 * Everything here follows D-005, where the transaction model was confirmed
 * rather than assumed: Robinhood Chain is an Arbitrum Orbit (Nitro) L2, chain
 * id 4663, ETH gas token. That confirmation is load-bearing — the gas strategy
 * in gas.js and the "no MEV layer needed" position in D-005 item 2 are both
 * consequences of it being an Arbitrum-stack chain rather than an L1.
 */

/**
 * The Arbitrum NodeInterface precompile. Not a real deployed contract: the
 * Nitro node intercepts calls to this address. It is what lets us see the L1
 * and L2 halves of a gas estimate separately, which matters here because the
 * two move independently (D-005 item 4).
 */
const NODE_INTERFACE_ADDRESS = '0x00000000000000000000000000000000000000C8';

/** Split a comma/whitespace separated env var into a clean list. */
function parseUrlList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * RPC endpoints, in failover order (D-005 item 3).
 *
 * Overridable wholesale via ROBINHOOD_RPC_URLS so ops can repoint without a
 * deploy. Otherwise: the caller's Alchemy key first (chain-recommended, and the
 * best log/receipt tooling), then the first-party endpoint as a second opinion.
 * A single-provider list is allowed but warned about at construction — the plan
 * requires two, and one is a single point of failure for every trade.
 */
function mainnetRpcUrls(env) {
  const explicit = parseUrlList(env.ROBINHOOD_RPC_URLS);
  if (explicit.length) return explicit;

  const urls = [];
  if (env.ALCHEMY_API_KEY) {
    urls.push(`https://robinhood-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`);
  }
  if (env.QUICKNODE_RPC_URL) urls.push(env.QUICKNODE_RPC_URL);
  urls.push('https://rpc.mainnet.chain.robinhood.com');
  return urls;
}

function testnetRpcUrls(env) {
  const explicit = parseUrlList(env.ROBINHOOD_TESTNET_RPC_URLS);
  if (explicit.length) return explicit;
  return ['https://rpc.testnet.chain.robinhood.com'];
}

/**
 * @param {object} env
 * @returns {{key: string, chainId: number, name: string, nativeCurrency: object,
 *            rpcUrls: string[], explorer: string, nodeInterfaceAddress: string,
 *            ordering: string, blockTimeMs: number, confirmations: number}}
 */
function robinhoodMainnet(env = process.env) {
  return {
    key: 'robinhood',
    chainId: 4663,
    name: 'Robinhood Chain',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    rpcUrls: mainnetRpcUrls(env),
    explorer: 'https://robinhoodchain.blockscout.com',
    nodeInterfaceAddress: NODE_INTERFACE_ADDRESS,
    // First-come-first-served, private mempool (D-005 item 2). Read by gas.js,
    // which refuses to build a priority-fee escalator on an FCFS chain.
    ordering: 'fcfs',
    blockTimeMs: 100,
    // Orbit chains have a single sequencer and ~100ms blocks: one confirmation
    // is a soft-finality signal, not L1 finality. Enough for a trade receipt;
    // NOT enough to credit a deposit (T-404 sets its own, higher bar).
    confirmations: 1,
  };
}

/**
 * Testnet, for the T-305 acceptance criterion (a working swap before real money).
 *
 * ⚠️ The testnet chain id is NOT hardcoded because we have not confirmed it —
 * mainnet's 4663 is documented, the testnet's is not, and guessing it would
 * produce transactions signed for the wrong chain. Set ROBINHOOD_TESTNET_CHAIN_ID
 * from the chain's own docs before using this. Fails closed until you do.
 */
function robinhoodTestnet(env = process.env) {
  const chainId = Number(env.ROBINHOOD_TESTNET_CHAIN_ID);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(
      'ROBINHOOD_TESTNET_CHAIN_ID is unset. Look it up in the Robinhood Chain docs — ' +
        'signing with a guessed chain id produces a transaction no node will accept.'
    );
  }
  return {
    ...robinhoodMainnet(env),
    key: 'robinhood-testnet',
    chainId,
    name: 'Robinhood Chain Testnet',
    rpcUrls: testnetRpcUrls(env),
    explorer: 'https://testnet.robinhoodchain.blockscout.com',
  };
}

const CHAINS = {
  robinhood: robinhoodMainnet,
  'robinhood-testnet': robinhoodTestnet,
};

/**
 * Fails closed: an unknown chain key throws rather than defaulting to mainnet.
 * A typo in config must not route real money onto a chain nobody chose.
 */
function getChain(key, env = process.env) {
  const factory = CHAINS[key];
  if (!factory) {
    throw new Error(`Unknown chain "${key}". Known: ${Object.keys(CHAINS).join(', ')}`);
  }
  return factory(env);
}

module.exports = { getChain, robinhoodMainnet, robinhoodTestnet, NODE_INTERFACE_ADDRESS, parseUrlList };
