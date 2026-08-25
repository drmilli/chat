# Decision Log

Decisions that shape the build, with the evidence available at the time. Append
new entries; supersede rather than rewrite, so the reasoning stays auditable.

---

## D-001 · Launch chain: Robinhood Chain
**Date:** 2026-08-25 · **Status:** Accepted · **Task:** T-300 · **Owner:** Product

Trading launches on **Robinhood Chain**, resolving the brief (Solana) vs PRD
(Robinhood Chain) conflict in favour of the PRD.

**Evidence available when deciding**
- All 5 Phase 0 spike pages resolved to Solana base58 addresses; GMGN served
  `/sol/token/…`, Padre likewise.
- Axiom advertises `pulseChains=sol,robinhood,bnb` and
  `trackerChains=sol,robinhood,bnb,eth`, so Robinhood is supported by at least
  one target terminal, but no observed page used it.
- All 4 genuine rooms in the production database are Solana base58 (one a
  pump.fun token).
- Frontrun supports both Solana and Robinhood Chain.

**Consequence to manage — chat and trading are on different chains today.**
Detection and every existing room are Solana; trading will be Robinhood. Until
Robinhood tokens actually appear on the target terminals, a user in a room can
be looking at a token they cannot trade through us. Options, still open:
1. Detect and open Robinhood-chain rooms too (needs the terminals to list them).
2. Ship trading only in rooms whose token is on the launch chain, and say so in
   the UI for the rest.
3. Revisit D-001 if terminal traffic stays Solana-dominant.

**Engineering impact**
- The execution engine is **not** Solana-shaped: Jupiter and Jito do not apply,
  so the trading doc's "aggregator routing (Jupiter on Solana)" and "Jito
  bundles" are void.
- ✅ **CONFIRMED EVM (2026-08-25, D-005).** Earlier notes inferred "EVM-shaped"
  from Axiom listing `robinhood` beside `sol,bnb,eth`; that inference was flagged
  here as unverified. It is now confirmed from chain documentation: Robinhood
  Chain is an Arbitrum Orbit (Nitro) L2, chain ID 4663, ETH gas. The data model's
  `tx_hash` naming stands. The "EIP-1559 gas" wording in T-402 does **not** — see
  D-005 item 4, where Nitro's FCFS ordering makes a priority-fee escalator
  useless.

- `normalizeCA` already lowercases EVM addresses and preserves base58, so room
  ids stay correct for both.

---

## D-002 · Key infrastructure: Turnkey
**Date:** 2026-08-25 · **Status:** Accepted · **Task:** T-301 · **Owner:** Product/Backend

Embedded wallets use **Turnkey**. Self-managed key storage stays prohibited
(breach surface + Chrome Web Store rejection risk).

**Rationale:** Frontrun uses Turnkey for this exact product shape, so the pattern
is proven at ~50k users; its policy engine supports the per-transaction caps and
allowed-program lists the plan requires as defense in depth.

**Next:** confirm Turnkey's Robinhood Chain support depth before Phase 6 starts —
this pairs D-001 with D-002 and is the single riskiest unknown.

---

## D-003 · Alpha order types: market **and** limit
**Date:** 2026-08-25 · **Status:** Accepted · **Task:** T-303 · **Owner:** Product

The Trading Alpha ships both market and limit orders, going beyond the trading
doc's recommendation of market-only.

**Consequence:** limit orders need persistent order storage, price monitoring,
cancellation, and expiry — plus their own failure modes (partial fills, stale
orders, monitoring outages). Phase 6 grows from the doc's 3–5 weeks; treat
5–7 weeks as realistic and add the order-lifecycle work explicitly (T-407).

---

## D-004 · Fee model: 0.1% flat + cashback
**Date:** 2026-08-25 · **Status:** Accepted · **Task:** T-302 · **Owner:** Product

Match the market reference: **0.1% flat per trade with cashback**.

**Open sub-decisions:** cashback percentage, and its funding source (fee revenue
share vs treasury subsidy). `fee_ledger` must record fee and cashback separately
from day one, or the accounting cannot be reconstructed later.

---

## D-005 · EVM execution stack: 1inch primary, 0x fallback, no private mempool
**Date:** 2026-08-25 · **Status:** Accepted · **Task:** T-305 · **Owner:** Backend
**Unblocks:** T-402

D-001 invalidated the Solana tooling and left five questions open. All five now
have answers. **Confidence: desk research, not hands-on** — every claim below is
from vendor and chain documentation, and none of it has been exercised against a
live endpoint from this repo. Item 0 is settled beyond doubt; items 1–4 need the
testnet swap in the acceptance criterion before a single real trade depends on
them.

**0 · Transaction model — EVM. Confirmed; no longer an assumption.**
Robinhood Chain is a public **Arbitrum Orbit (Nitro) Ethereum L2**, chain ID
**4663**, **ETH as the gas token**, ~100 ms blocks, settling to Ethereum. Public
testnet 2026-02-10, mainnet 2026-07-01. Standard Ethereum JSON-RPC, permissionless
deployment, ERC-4337 account abstraction available. Blockscout explorer at
`robinhoodchain.blockscout.com`.
*Consequence:* the migration-007 shape is correct as written — `tx_hash`,
`NUMERIC(78,0)` uint256 amounts, EVM addresses. Nothing in the data model needs
revisiting. This retires the ⚠️ flag on D-001.

**1 · Aggregator/router — 1inch primary, 0x fallback.**
Both are live on 4663, as is LI.FI; Uniswap and Arcus (dYdX team) are deployed
natively, and the chain reached top-five DEX volume within two weeks of mainnet.
This is a far healthier liquidity picture than "a new chain may have only a
native DEX", which is what D-005 was braced for.
- **1inch** — explicit 4663 support across Classic Swap and Fusion; pass 4663 as
  `chainId` and existing integration code routes there. Chosen as primary for the
  RWA/stock-token routing it advertises on this chain specifically.
- **0x** — RFQ-based liquidity for stock tokens. Chosen as fallback: a second
  quote source behind one interface, so an aggregator outage is not an outage.
- **LI.FI** — noted, not integrated. It is bridge-shaped; we are single-chain.
*Engineering:* T-402 defines one `Router` interface with two adapters. Never call
an aggregator SDK directly from route handlers.

**2 · MEV protection — none needed, and none exists. Launch without it.**
The plan budgeted a Flashbots equivalent (T-504, 1 week). On an Arbitrum-stack
chain that work is largely moot: **there is no public mempool.** The sequencer
orders first-come-first-served and transactions stay private until sequenced, so
the gas-price-bidding frontrun and the sandwich — the attacks a private mempool
buys protection from — are structurally unavailable to an outside observer.
*Caveat to verify:* if this chain enables **Timeboost**, an express-lane
controller gets priority ordering. Arbitrum documents that the controller still
cannot frontrun or sandwich, but confirm whether 4663 runs it before relying on
the argument.
*Consequence:* **T-504 shrinks from "build MEV-protected submission" to "confirm
the sequencer's ordering policy and document it."** Slippage guards in T-402 do
the real user protection here. Say so in the UI rather than implying a private
relay we do not have.

**3 · RPC providers — first-party plus Alchemy, with QuickNode third.**
Officially supported: **Alchemy** (chain-recommended), **QuickNode**,
**Blockdaemon**, **dRPC**, **Validation Cloud**. First-party endpoint:
`https://rpc.mainnet.chain.robinhood.com`.
*Decision:* Alchemy primary (best tooling for confirmation tracking and log
queries), first-party secondary, QuickNode third. The plan's two-provider minimum
is comfortably met — this was a stated risk that turned out not to be one.

**4 · Gas — Nitro, not mainnet EIP-1559. Do not port a 1559 bidding strategy.**
T-402 says "EIP-1559 gas strategy". Nitro accepts 1559-style fields, but the
economics differ and copying a mainnet strategy wastes effort and money:
- Ordering is FCFS, so **bidding a higher priority fee buys no better position.**
  A priority-fee escalator — standard practice on L1 — is pure overpayment here.
- The dominant cost is the **L1 data (calldata) component**, not L2 execution, and
  it moves with Ethereum's basefee rather than with L2 congestion.
- Estimate with `eth_estimateGas` plus Nitro's `NodeInterface.gasEstimateComponents`
  to see the L1 and L2 parts separately; a flat headroom multiplier on the total is
  the wrong instrument when the two halves move independently.
*Consequence:* T-402's gas work is "Nitro-aware estimation with a bounded ceiling",
not a 1559 escalator.

**Still to confirm before real money — carry these into T-402/T-401:**
1. A working **testnet swap** through the 1inch adapter (the T-305 acceptance
   criterion; unmet until an RPC key exists).
2. Whether 4663 runs **Timeboost** (feeds item 2).
3. **Turnkey's support for chain 4663** — still the riskiest open pairing
   (D-002). Being standard EVM makes it very likely rather than certain, and
   "likely" is not what a custody decision should rest on.

**Sources:** Robinhood Chain docs (`docs.robinhood.com/chain`), Chainstack,
QuickNode and Alchemy chain guides, ChainList 4663, 1inch Business and 0x
announcements, Arbitrum Timeboost/Nitro docs. Retrieved 2026-08-25.

---

## D-006 · Realtime transport — OPEN
**Status:** Open · Task T-201 · **Owner:** Backend/Product

Shipped: an in-process SSE hub (no vendor, no cost, **single instance**). The
plan specified a managed provider (Supabase Realtime or Ably) behind an adapter.
Recommendation: keep SSE until one instance is a real constraint; the adapter
interface already exists for the swap.
