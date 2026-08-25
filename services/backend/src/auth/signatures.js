const { verifyMessage } = require('ethers');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const decodeBase58 = bs58.decode || bs58.default.decode;

/**
 * The message a wallet is asked to sign. It names the domain and embeds a
 * server-issued nonce, so a signature captured on one site cannot be replayed
 * on another (or twice on this one).
 */
function buildSignInMessage({ address, nonce, domain, issuedAt }) {
  return [
    `${domain} wants you to sign in with your wallet.`,
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    '',
    'Signing costs no gas and grants no spending permission.',
  ].join('\n');
}

/** Recovers the EVM signer and compares it to the claimed address. */
function verifyEvm({ message, signature, address }) {
  try {
    const recovered = verifyMessage(message, signature);
    return recovered.toLowerCase() === String(address).toLowerCase();
  } catch (err) {
    return false;
  }
}

/** Verifies an ed25519 signature against a base58 Solana public key. */
function verifySolana({ message, signature, address }) {
  try {
    const publicKey = decodeBase58(address);
    if (publicKey.length !== 32) return false;
    const sig = decodeBase58(signature);
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, publicKey);
  } catch (err) {
    return false;
  }
}

function verifySignature({ chain, message, signature, address }) {
  if (chain === 'solana') return verifySolana({ message, signature, address });
  return verifyEvm({ message, signature, address });
}

module.exports = { buildSignInMessage, verifySignature, verifyEvm, verifySolana };
