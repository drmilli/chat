const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Must stay in sync with apps/extension/config.ts — a room id produced here and
// one produced by the extension have to match for the same token.
export function normalizeCA(address: string): string {
  const value = address.trim();
  return EVM_ADDRESS.test(value) ? value.toLowerCase() : value;
}

export function isValidCA(address: string): boolean {
  const value = address.trim();
  return EVM_ADDRESS.test(value) || BASE58_ADDRESS.test(value);
}
