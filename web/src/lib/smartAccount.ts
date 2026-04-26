import {
  keccak256,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  type Hex,
  type Address,
} from 'viem';

// Coinbase Smart Wallet factory + implementation, as of writing, on Base mainnet.
// We're using the addresses for counterfactual derivation only — no on-chain calls.
//
// IMPORTANT FOR PRODUCTION: don't duplicate the factory's address math here. Instead
// call `factory.getAddress(owners, nonce)` on-chain (it's a view fn) and use whatever
// it returns. If Coinbase ever changes the factory or the implementation slot
// derivation, this local copy will silently disagree with reality.
//
// Pinned for v1 — VERIFY against current Coinbase Smart Wallet docs before relying on
// these for any real funds:
//   factory:        https://github.com/coinbase/smart-wallet
//   address page:   https://basescan.org/address/0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a
export const ACCOUNT_FACTORY: Address = '0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a';
export const ACCOUNT_IMPLEMENTATION: Address = '0x000100abaad02f1cfC8Bbe32bD5a564817339E72';

/**
 * Counterfactual address for a Coinbase Smart Wallet whose sole owner is a
 * P-256 (passkey) public key. Matches the on-chain factory's CREATE2 math:
 *
 *   salt          = keccak256(abi.encode(bytes[] owners, uint256 nonce))
 *   initCodeHash  = keccak256(abi.encodePacked(implementation, salt))
 *   address       = last20( keccak256(0xff || factory || salt || initCodeHash) )
 */
export function deriveSmartAccountAddress(
  publicKey: Hex,
  nonce: bigint = 0n,
): Address {
  const salt = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes[]' }, { type: 'uint256' }],
      [[publicKey], nonce],
    ),
  );

  const initCodeHash = keccak256(
    encodePacked(['address', 'bytes32'], [ACCOUNT_IMPLEMENTATION, salt]),
  );

  const create2 = keccak256(
    encodePacked(
      ['bytes1', 'address', 'bytes32', 'bytes32'],
      ['0xff', ACCOUNT_FACTORY, salt, initCodeHash],
    ),
  );

  // Last 20 bytes of the 32-byte hash = the address.
  return getAddress(`0x${create2.slice(26)}`);
}
