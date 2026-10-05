/* NFT holding checks.
 *
 * Separate from explorer.js so the pure encoding/decoding is unit-testable
 * without stubbing fetch for the whole explorer.
 *
 * SCOPE — what this can and cannot do:
 *   CAN  resolve the standard via ERC-165 and read an owner's balance.
 *   CANNOT enumerate a wallet's NFTs. That needs an indexer that has walked every
 *        Transfer log since genesis; public RPC only serves bounded log ranges.
 *        Read-only public RPC exposes no "list my tokens" method, so this stays a
 *        per-contract check rather than a gallery.
 */

import { rpcRequest, decodeUint } from './evmRead.js';
import { SELECTORS, INTERFACE_IDS } from './abis.js';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const isAddress = (a) => ADDRESS_RE.test(String(a || ''));

/** Left-pad a 20-byte address to a 32-byte ABI word. */
export const padAddress = (a) => String(a).replace(/^0x/, '').toLowerCase().padStart(64, '0');

/** Left-pad a uint to a 32-byte ABI word. */
export const padUint = (v) => {
  const n = typeof v === 'bigint' ? v : BigInt(Math.max(0, Number(v) || 0));
  return n.toString(16).padStart(64, '0');
};

/** Calldata for `supportsInterface(bytes4)`. */
export const supportsInterfaceData = (ifaceId) =>
  `${SELECTORS.supportsInterface}${String(ifaceId).replace(/^0x/, '').toLowerCase().padEnd(64, '0')}`;

/** Calldata for ERC-721 `balanceOf(address)`. */
export const erc721BalanceData = (owner) => `${SELECTORS.balanceOf}${padAddress(owner)}`;

/** Calldata for ERC-1155 `balanceOf(address,uint256)`. */
export const erc1155BalanceData = (owner, id = 0) => `${SELECTORS.balanceOf}${padAddress(owner)}${padUint(id)}`;

/** Interpret an ERC-165 probe result. A missing reply is "not implemented". */
export function readInterfaceSupport(result) {
  if (result == null || result === '0x') return false;
  try {
    return decodeUint(result) === 1n;
  } catch {
    return false;
  }
}

/**
 * Resolve the NFT standard, then read the owner's balance with the correct
 * `balanceOf` arity. ERC-721 and ERC-1155 differ, so the standard is decided
 * BEFORE building calldata — assuming ERC-721 for a 1155 contract would encode
 * the wrong argument count and revert.
 */
export async function readNftBalance(chain, contract, owner, { tokenId = 0 } = {}) {
  if (!isAddress(contract)) return { error: 'Contract must be a 0x-prefixed 40-hex address' };
  if (!isAddress(owner)) return { error: 'Owner must be a 0x-prefixed 40-hex address' };

  const [i721, i1155] = await Promise.all([
    rpcRequest(chain, 'eth_call', [{ to: contract, data: supportsInterfaceData(INTERFACE_IDS.ERC721) }, 'latest']),
    rpcRequest(chain, 'eth_call', [{ to: contract, data: supportsInterfaceData(INTERFACE_IDS.ERC1155) }, 'latest'])
  ]);

  const is721 = i721.ok && readInterfaceSupport(i721.result);
  const is1155 = i1155.ok && readInterfaceSupport(i1155.result);

  if (!is721 && !is1155) {
    return {
      standard: 'not-nft',
      error: 'Contract does not declare ERC-721 or ERC-1155 via ERC-165',
      note: 'Some older collections predate ERC-165. Absence of a declaration is not proof it is not an NFT.'
    };
  }

  const standard = is1155 ? 'ERC-1155' : 'ERC-721';
  const data = is1155 ? erc1155BalanceData(owner, tokenId) : erc721BalanceData(owner);

  const r = await rpcRequest(chain, 'eth_call', [{ to: contract, data }, 'latest']);
  if (!r.ok) {
    return { standard, balance: null, error: r.error || 'balanceOf call failed' };
  }

  return {
    standard,
    balance: decodeUint(r.result),
    tokenId: is1155 ? Number(tokenId) : null,
    note: is1155
      ? `ERC-1155 balances are per token id — id ${tokenId} was read, not the whole collection.`
      : 'ERC-721 balance is the number of tokens owned from this collection.'
  };
}
