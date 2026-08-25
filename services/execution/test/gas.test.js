const test = require('node:test');
const assert = require('node:assert');
const { Interface } = require('ethers');
const { GasEstimator, NODE_INTERFACE_ABI } = require('../src/gas');
const { robinhoodMainnet } = require('../src/chains');

const CHAIN = robinhoodMainnet({ ROBINHOOD_RPC_URLS: 'https://a.example,https://b.example' });
const iface = new Interface(NODE_INTERFACE_ABI);
const quiet = () => {};
// Real 20-byte addresses: gas.js encodes them for the precompile, so a
// placeholder like '0xbbb' would fail ABI encoding rather than exercise the path.
const TX = {
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  data: '0xdeadbeef',
};

/** Encodes a gasEstimateComponents reply the way the precompile would. */
function componentsReply({ total, l1, baseFee, l1BaseFee }) {
  return iface.encodeFunctionResult('gasEstimateComponents', [total, l1, baseFee, l1BaseFee]);
}

function fakeRpc(handlers) {
  const calls = [];
  return {
    calls,
    async call(method, params) {
      calls.push(method);
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected ${method}`);
      return typeof handler === 'function' ? handler(params) : handler;
    },
  };
}

test('applies headroom to the L2 half only, leaving the L1 half exact', async () => {
  // The L1 half is a function of calldata size, which is already known
  // exactly. Padding it is money spent for nothing.
  const rpc = fakeRpc({
    eth_call: componentsReply({ total: 100_000n, l1: 60_000n, baseFee: 100_000_000n, l1BaseFee: 0n }),
  });
  const gas = new GasEstimator(rpc, CHAIN, { warn: quiet, bufferPercent: 25 });
  const est = await gas.estimate(TX);

  // l1 60000 + l2 40000 * 1.25 = 60000 + 50000
  assert.equal(est.gasLimit, 110_000n);
  assert.equal(est.components.l1, 60_000n);
  assert.equal(est.components.l2, 40_000n);
});

test('does NOT bid a priority fee on an FCFS chain', async () => {
  // D-005 item 4: under first-come-first-served, a tip buys no better
  // position. An escalator here is pure overpayment.
  const rpc = fakeRpc({
    eth_call: componentsReply({ total: 100_000n, l1: 0n, baseFee: 100_000_000n, l1BaseFee: 0n }),
  });
  const est = await new GasEstimator(rpc, CHAIN, { warn: quiet }).estimate(TX);
  assert.equal(est.maxPriorityFeePerGas, 0n);
});

test('maxFee carries headroom for a basefee move, not a bid', async () => {
  const rpc = fakeRpc({
    eth_call: componentsReply({ total: 100_000n, l1: 0n, baseFee: 100_000_000n, l1BaseFee: 0n }),
  });
  const est = await new GasEstimator(rpc, CHAIN, { warn: quiet }).estimate(TX);
  assert.equal(est.maxFeePerGas, 200_000_000n, 'basefee * 2 + tip');
});

test('falls back to eth_estimateGas when the precompile is unavailable', async () => {
  // A non-Nitro node, or a provider that does not expose NodeInterface.
  const rpc = fakeRpc({
    eth_call: () => { throw new Error('method not supported'); },
    eth_estimateGas: '0x186a0', // 100000
    eth_gasPrice: '0x5f5e100',  // 100000000
  });
  const gas = new GasEstimator(rpc, CHAIN, { warn: quiet, bufferPercent: 25 });
  const est = await gas.estimate(TX);

  assert.equal(est.gasLimit, 125_000n, 'flat headroom on the whole estimate');
  assert.equal(est.components, null);
  assert.ok(rpc.calls.includes('eth_estimateGas'));
});

test('an empty precompile response also falls back', async () => {
  const rpc = fakeRpc({ eth_call: '0x', eth_estimateGas: '0x186a0', eth_gasPrice: '0x5f5e100' });
  const est = await new GasEstimator(rpc, CHAIN, { warn: quiet }).estimate(TX);
  assert.equal(est.components, null);
});

test('refuses to submit when the estimate breaches the cost ceiling', async () => {
  // An L1 basefee spike must produce a clear refusal, not a silent haircut on
  // the user's trade.
  const rpc = fakeRpc({
    eth_call: componentsReply({
      total: 1_000_000n, l1: 0n, baseFee: 1_000_000_000_000n, l1BaseFee: 0n,
    }),
  });
  const gas = new GasEstimator(rpc, CHAIN, { warn: quiet, maxCostWei: 1_000_000_000_000_000n });
  await assert.rejects(() => gas.estimate(TX), /exceeds the .* wei ceiling/);
});

test('reports the estimated cost so the caller can show it', async () => {
  const rpc = fakeRpc({
    eth_call: componentsReply({ total: 100_000n, l1: 0n, baseFee: 100_000_000n, l1BaseFee: 0n }),
  });
  const est = await new GasEstimator(rpc, CHAIN, { warn: quiet, bufferPercent: 0 }).estimate(TX);
  assert.equal(est.estimatedCostWei, 100_000n * 200_000_000n);
});

test('warns loudly if reused on a chain where the tip DOES buy ordering', async () => {
  const warnings = [];
  const rpc = fakeRpc({
    eth_call: componentsReply({ total: 100_000n, l1: 0n, baseFee: 1n, l1BaseFee: 0n }),
  });
  new GasEstimator(rpc, { ...CHAIN, ordering: 'auction' }, { warn: (m) => warnings.push(m) });
  assert.match(warnings.join(' '), /may never mine/);
});
