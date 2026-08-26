/**
 * What chain a contract address belongs to, and what to call it.
 *
 * The room id IS the contract address, and its format is the only chain signal
 * we have — nothing in the room record says which chain it is on. That is
 * enough to tell Solana from EVM, which is the distinction that matters here:
 * running an ERC-20 call against a Solana mint does not return bad data, it
 * throws, and the panel was reporting that as "no metadata" rather than as
 * "wrong chain entirely".
 */

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type AddressChain = 'evm' | 'solana' | 'unknown';

export function addressChain(address: string): AddressChain {
  const value = (address || '').trim();
  if (EVM_ADDRESS.test(value)) return 'evm';
  if (BASE58_ADDRESS.test(value)) return 'solana';
  return 'unknown';
}

/**
 * Human names for the chains a wallet is likely to be on. A raw `0x1` in the
 * UI is an id, not an answer — nobody reads hex as "Ethereum".
 */
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
  // D-001's launch chain for trading.
  4663: 'Robinhood Chain',
};

export function chainName(chainId: string | number | null | undefined): string | null {
  if (chainId == null || chainId === '') return null;
  if (chainId === 'solana') return 'Solana';

  const numeric = typeof chainId === 'number' ? chainId : Number(chainId);
  if (!Number.isFinite(numeric)) return String(chainId);

  // Fall back to the decimal id rather than the hex: still not a name, but at
  // least it is the number people search for.
  return CHAIN_NAMES[numeric] ?? `Chain ${numeric}`;
}
