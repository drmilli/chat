const test = require('node:test');
const assert = require('node:assert');
const { RpcClient, RpcApplicationError, RpcTransportError } = require('../src/rpc');

const ok = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
const rpcError = (message, code = -32000) => ({
  ok: true,
  json: async () => ({ jsonrpc: '2.0', id: 1, error: { code, message } }),
});
const httpError = (status) => ({ ok: false, status, json: async () => ({}) });

function recorder(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (typeof next === 'function') return next(url);
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

const URLS = ['https://primary.example', 'https://secondary.example'];
const quiet = () => {};

test('falls over to the next provider on a transport failure', async () => {
  const { calls, fetchImpl } = recorder([new Error('ECONNRESET'), ok('0x2a')]);
  const client = new RpcClient(URLS, { fetch: fetchImpl, warn: quiet });

  assert.equal(await client.call('eth_blockNumber'), '0x2a');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, URLS[0]);
  assert.equal(calls[1].url, URLS[1], 'the second provider must be tried');
});

test('treats a provider HTTP error as transport, not as the chain answering', async () => {
  const { calls, fetchImpl } = recorder([httpError(429), ok('0x1')]);
  const client = new RpcClient(URLS, { fetch: fetchImpl, warn: quiet });

  assert.equal(await client.call('eth_blockNumber'), '0x1');
  assert.equal(calls.length, 2, 'a 429 on one provider must fail over');
});

test('does NOT fail over on a JSON-RPC application error', async () => {
  // The node answered. Every other node would say the same thing, and retrying
  // would hide the revert reason behind two more round trips.
  const { calls, fetchImpl } = recorder([rpcError('execution reverted: SlippageExceeded')]);
  const client = new RpcClient(URLS, { fetch: fetchImpl, warn: quiet });

  await assert.rejects(() => client.call('eth_call', [{}]), RpcApplicationError);
  assert.equal(calls.length, 1, 'a revert must not be retried against other providers');
});

test('a non-idempotent method stops at the first transport failure', async () => {
  const { calls, fetchImpl } = recorder([new Error('timeout'), ok('0xdead')]);
  const client = new RpcClient(URLS, { fetch: fetchImpl, warn: quiet });

  // Unknown methods are non-idempotent by default: we cannot know whether the
  // call landed, and silently re-sending is how an effect happens twice.
  await assert.rejects(() => client.call('some_unknown_write'), RpcTransportError);
  assert.equal(calls.length, 1);
});

test('a raw transaction broadcast IS retried — the hash makes it idempotent', async () => {
  const { calls, fetchImpl } = recorder([new Error('ECONNRESET'), ok('0xhash')]);
  const client = new RpcClient(URLS, { fetch: fetchImpl, warn: quiet });

  assert.equal(await client.sendRawTransaction('0xsigned'), '0xhash');
  assert.equal(calls.length, 2, 'identical signed bytes cannot produce two transactions');
});

test('throws when every provider is down, naming each failure', async () => {
  const { fetchImpl } = recorder([new Error('down A'), new Error('down B')]);
  const client = new RpcClient(URLS, { fetch: fetchImpl, warn: quiet });

  await assert.rejects(
    () => client.call('eth_blockNumber'),
    (err) => {
      assert.ok(err instanceof RpcTransportError);
      assert.equal(err.failures.length, 2);
      assert.match(err.message, /down A/);
      assert.match(err.message, /down B/);
      return true;
    }
  );
});

test('a failed provider is skipped while it is cooling down', async () => {
  let clock = 1000;
  const { calls, fetchImpl } = recorder([new Error('down'), ok('0x1'), ok('0x2')]);
  const client = new RpcClient(URLS, {
    fetch: fetchImpl,
    warn: quiet,
    now: () => clock,
    cooldownMs: 30_000,
  });

  await client.call('eth_blockNumber');            // primary fails, secondary serves
  clock += 1000;                                    // still inside the cooldown
  await client.call('eth_blockNumber');

  assert.equal(calls[2].url, URLS[1], 'the cooling provider must be skipped');
});

test('a provider returns to the rotation once its cooldown expires', async () => {
  let clock = 1000;
  const { calls, fetchImpl } = recorder([new Error('down'), ok('0x1'), ok('0x2')]);
  const client = new RpcClient(URLS, {
    fetch: fetchImpl,
    warn: quiet,
    now: () => clock,
    cooldownMs: 30_000,
  });

  await client.call('eth_blockNumber');
  clock += 31_000;
  await client.call('eth_blockNumber');

  assert.equal(calls[2].url, URLS[0], 'the primary must be retried after cooling off');
});

test('tries a cooling provider anyway rather than refusing to submit', async () => {
  let clock = 1000;
  const { calls, fetchImpl } = recorder([new Error('a'), new Error('b'), ok('0x1')]);
  const client = new RpcClient(URLS, { fetch: fetchImpl, warn: quiet, now: () => clock });

  await assert.rejects(() => client.call('eth_blockNumber'));  // both now cooling
  clock += 100;
  // A stale cooldown must never be the reason a trade cannot be sent.
  assert.equal(await client.call('eth_blockNumber'), '0x1');
  assert.equal(calls.length, 3);
});

test('assertChainId refuses an endpoint serving a different chain', async () => {
  const { fetchImpl } = recorder([ok('0x1')]); // chain 1, not 4663
  const client = new RpcClient(URLS, { fetch: fetchImpl, warn: quiet });

  await assert.rejects(() => client.assertChainId(4663), /serves chain 1.*configured for 4663/s);
});

test('assertChainId accepts the configured chain', async () => {
  const { fetchImpl } = recorder([ok('0x1237')]); // 4663
  const client = new RpcClient(URLS, { fetch: fetchImpl, warn: quiet });
  assert.equal(await client.assertChainId(4663), 4663);
});

test('warns when only one endpoint is configured', () => {
  const warnings = [];
  new RpcClient(['https://only.example'], { fetch: async () => ok('0x1'), warn: (m) => warnings.push(m) });
  assert.match(warnings.join(' '), /single provider|D-005/);
});

test('refuses to construct with no endpoints', () => {
  assert.throws(() => new RpcClient([]), /at least one endpoint/);
});
