const test = require('node:test');
const assert = require('node:assert');
const { Wallet } = require('ethers');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { buildSignInMessage, verifySignature } = require('../src/auth/signatures');

const b58encode = bs58.encode || bs58.default.encode;
const message = (address, nonce = 'n1') =>
  buildSignInMessage({ address, nonce, domain: 'token-chat.test', issuedAt: '2026-01-01T00:00:00.000Z' });

test('sign-in message names the domain, address and nonce', () => {
  const text = message('0xabc', 'nonce-123');
  assert.match(text, /token-chat\.test/);
  assert.match(text, /0xabc/);
  assert.match(text, /nonce-123/);
  assert.match(text, /grants no spending permission/i, 'must reassure the signer');
});

test('EVM: accepts a genuine signature', async () => {
  const wallet = Wallet.createRandom();
  const text = message(wallet.address);
  const signature = await wallet.signMessage(text);
  assert.equal(verifySignature({ chain: 'evm', message: text, signature, address: wallet.address }), true);
});

test('EVM: rejects a signature made by a different key', async () => {
  const wallet = Wallet.createRandom();
  const impostor = Wallet.createRandom();
  const text = message(wallet.address);
  const signature = await impostor.signMessage(text);
  assert.equal(verifySignature({ chain: 'evm', message: text, signature, address: wallet.address }), false);
});

test('EVM: rejects a signature over different text (replay onto another nonce)', async () => {
  const wallet = Wallet.createRandom();
  const signature = await wallet.signMessage(message(wallet.address, 'nonce-A'));
  const other = message(wallet.address, 'nonce-B');
  assert.equal(verifySignature({ chain: 'evm', message: other, signature, address: wallet.address }), false);
});

test('EVM: malformed signature returns false instead of throwing', () => {
  assert.equal(verifySignature({ chain: 'evm', message: 'hi', signature: 'not-a-signature', address: '0xabc' }), false);
});

test('Solana: accepts a genuine ed25519 signature', () => {
  const kp = nacl.sign.keyPair();
  const address = b58encode(kp.publicKey);
  const text = message(address);
  const signature = b58encode(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey));
  assert.equal(verifySignature({ chain: 'solana', message: text, signature, address }), true);
});

test('Solana: rejects another keypair and malformed input', () => {
  const kp = nacl.sign.keyPair();
  const other = nacl.sign.keyPair();
  const address = b58encode(kp.publicKey);
  const text = message(address);
  const signature = b58encode(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey));

  assert.equal(verifySignature({ chain: 'solana', message: text, signature, address: b58encode(other.publicKey) }), false);
  assert.equal(verifySignature({ chain: 'solana', message: text, signature: 'zzz', address }), false);
  assert.equal(verifySignature({ chain: 'solana', message: text, signature, address: 'not-base58!' }), false);
});
