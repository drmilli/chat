# services/execution

Trade execution for Robinhood Chain. Built for **T-402**, on the decisions in
`docs/decisions.md` (D-001 launch chain, D-005 execution stack).

## What this module is

A swap goes through one path:

```
quote → guard → build calldata → estimate gas → allocate nonce → sign → broadcast → confirm
```

`ExecutionEngine.executeSwap()` runs it and returns an object shaped for the
`trades` row in migration 007.

## What it deliberately is not

| Concern | Where it lives | Why not here |
|---|---|---|
| Key custody | Injected `Signer` (T-401, Turnkey per D-002) | The engine must never hold a key — that is what keeps "no self-managed key storage" true by construction |
| Fee sweeps and the ledger | T-503, next to the database | Money movement belongs in a transaction with the ledger write |
| Limit-order lifecycle | T-407 | This engine executes one swap at a time |
| Whitelist / per-tx caps | Injected `policy` hook (T-401) | Policy is a product decision, execution is mechanism |

## Two things D-005 changed about the obvious design

**No priority-fee escalator.** Ordering is first-come-first-served, so bidding a
higher tip buys no better position — an escalator is pure overpayment. `gas.js`
estimates, splits the L1 and L2 halves via the NodeInterface precompile, applies
headroom only to the half that actually varies, and enforces a hard cost
ceiling.

**No MEV relay, and none needed.** Arbitrum's sequencer has no public mempool
and transactions stay private until sequenced, so sandwiching and gas-bidding
frontrunning are structurally unavailable. That also means there is nothing to
hide behind: the guards in `slippage.js` are the real user protection. Do not
describe the product as MEV-protected beyond what the sequencer actually gives.

## The two invariants worth knowing before changing anything

**Transport failure ≠ application failure** (`rpc.js`). A provider that did not
answer gets failed over; a provider that answered "execution reverted" does not,
because every other provider will say the same. Inverting this produces an
engine that retries a revert until something succeeds for the wrong reason.

**A broadcast transaction's nonce is spent, whatever the response said**
(`engine.js`, `nonce.js`). Nonces are only returned to the pool when nothing
reached the network. A confirmation timeout is reported as `submitted` with its
hash — never `failed` — because the chain may still confirm it, and re-signing
is how one user intent becomes two live swaps.

## Status: unverified against a live chain

D-005 was desk research. Nothing in this module has been exercised against a
real endpoint, and two things are most likely to be wrong on first contact:

1. **Aggregator response field mapping** (`router/oneinch.js`, `router/zeroex.js`).
   Endpoints and the chain id come from vendor documentation; the field names
   follow the documented shapes. Normalisation is deliberately strict so a
   mismatch throws loudly instead of quietly quoting zero.
2. **The testnet chain id**, which is not hardcoded because it was never
   confirmed. `robinhoodTestnet()` refuses to run until you set
   `ROBINHOOD_TESTNET_CHAIN_ID`.

**Before any real money moves:** complete the T-305 acceptance criterion — a
working testnet swap through the 1inch adapter — and confirm Turnkey supports
chain 4663 (still the riskiest open assumption in Phase 6).

## Tests

```
npm run test --workspace services-execution
```

98 tests, no network and no credentials: RPC, routers, gas and signer are all
injected, so the suite runs identically on a fork. Config lives in
`services/backend/.env.example` under "Trading execution".
