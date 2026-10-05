/* Standard ABI signature registry and event topics.
 *
 * Selectors and topic hashes are DERIVED from the verified keccak-256
 * implementation in keccak.js rather than hard-coded, so they cannot drift.
 * (Cross-checked against the canonical values: transfer -> 0xa9059cbb,
 * Transfer topic -> 0xddf252ad…, supportsInterface -> 0x01ffc9a7.)
 */

import { selector, keccak256Hex } from './keccak.js';

/** ERC-165 interface identifiers (published constants, XORS of selectors). */
export const INTERFACE_IDS = {
  ERC165: '0x01ffc9a7',
  ERC721: '0x80ac58cd',
  ERC721Metadata: '0x5b5e139f',
  ERC721Enumerable: '0x780e9d63',
  ERC1155: '0xd9b67a26',
  ERC1155MetadataURI: '0x0e89341c',
  ERC2981: '0x2a55205a',
  ERC4907: '0xad092b5c'
};

export const INTERFACE_LABELS = {
  ERC721: 'ERC-721 (NFT collection)',
  ERC721Metadata: 'ERC-721 Metadata (name/symbol/tokenURI)',
  ERC721Enumerable: 'ERC-721 Enumerable (on-chain token list)',
  ERC1155: 'ERC-1155 (multi-token)',
  ERC1155MetadataURI: 'ERC-1155 Metadata URI',
  ERC2981: 'ERC-2981 (royalties)',
  ERC4907: 'ERC-4907 (rentable NFT)'
};

/**
 * Read-only functions we probe to discover what a contract supports.
 * `returns` drives decoding in explorer.js.
 */
export const FUNCTIONS = [
  { name: 'name', sig: 'name()', group: 'token', returns: 'string' },
  { name: 'symbol', sig: 'symbol()', group: 'token', returns: 'string' },
  { name: 'decimals', sig: 'decimals()', group: 'erc20', returns: 'uint' },
  { name: 'totalSupply', sig: 'totalSupply()', group: 'token', returns: 'uint' },
  { name: 'owner', sig: 'owner()', group: 'access', returns: 'address' },
  { name: 'paused', sig: 'paused()', group: 'access', returns: 'bool' },
  { name: 'version', sig: 'version()', group: 'meta', returns: 'string' },
  { name: 'DOMAIN_SEPARATOR', sig: 'DOMAIN_SEPARATOR()', group: 'eip2612', returns: 'bytes32' },
  { name: 'tokenURI', sig: 'tokenURI(uint256)', group: 'erc721', returns: 'string', args: ['uint256'] },
  { name: 'uri', sig: 'uri(uint256)', group: 'erc1155', returns: 'string', args: ['uint256'] },
  // Needed as calldata for other reads, so they must resolve in SELECTORS.
  { name: 'supportsInterface', sig: 'supportsInterface(bytes4)', group: 'erc165', returns: 'bool', args: ['bytes4'], probe: false },
  { name: 'balanceOf', sig: 'balanceOf(address)', group: 'erc20', returns: 'uint', args: ['address'], probe: false },
  { name: 'allowance', sig: 'allowance(address,address)', group: 'erc20', returns: 'uint', args: ['address', 'address'], probe: false }
];

/** Write functions listed for ABI completeness — never called here. */
export const WRITE_FUNCTIONS = [
  'transfer(address,uint256)',
  'approve(address,uint256)',
  'transferFrom(address,address,uint256)',
  'safeTransferFrom(address,address,uint256)',
  'safeTransferFrom(address,address,uint256,bytes)',
  'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)',
  'setApprovalForAll(address,bool)',
  'mint(address,uint256)',
  'burn(uint256)'
];

export const EVENTS = {
  Transfer: 'Transfer(address,address,uint256)',
  Approval: 'Approval(address,address,uint256)',
  ApprovalForAll: 'ApprovalForAll(address,address,bool)',
  TransferSingle: 'TransferSingle(address,address,address,uint256,uint256)',
  TransferBatch: 'TransferBatch(address,address,address,uint256[],uint256[])',
  OwnershipTransferred: 'OwnershipTransferred(address,address)'
};

/** topic0 = keccak256 of the canonical event signature. */
export const TOPICS = Object.fromEntries(
  Object.entries(EVENTS).map(([k, sig]) => [k, `0x${keccak256Hex(sig)}`])
);

/* Keyed by the short function name, derived from the signature itself so a name
 * can never drift from its selector (a missing key here silently produces
 * malformed calldata at runtime). */
export const SELECTORS = Object.fromEntries(
  [...FUNCTIONS.map((f) => f.sig), ...WRITE_FUNCTIONS]
    .map((sig) => [sig.slice(0, sig.indexOf('(')), selector(sig)])
);

/** Functions probed when discovering a contract's interface. */
export const PROBE_FUNCTIONS = FUNCTIONS.filter((f) => f.probe !== false);

/** Build the calldata for a function with no arguments. */
export const callData = (name) => SELECTORS[name];

/** Encode a single uint256 argument (used for tokenURI/uri probes). */
export const withUintArg = (name, value) =>
  `${SELECTORS[name]}${BigInt(value).toString(16).padStart(64, '0')}`;

/** Human-readable, minimal ABI for the functions we actually confirmed. */
export function buildDetectedAbi(confirmed = [], { name = null, kind = 'contract' } = {}) {
  const entries = [];

  confirmed.forEach((fnName) => {
    const fn = FUNCTIONS.find((f) => f.name === fnName);
    if (!fn) return;
    entries.push({
      type: 'function',
      name: fn.name,
      stateMutability: 'view',
      inputs: (fn.args || []).map((t) => ({ name: '', type: t })),
      outputs: [{ name: '', type: fn.returns === 'uint' ? 'uint256' : fn.returns === 'address' ? 'address' : fn.returns }]
    });
  });

  // Include the standard write surface only when this looks like a token.
  if (confirmed.includes('totalSupply') || confirmed.includes('symbol')) {
    WRITE_FUNCTIONS.filter((s) => !s.includes('Batch')).forEach((sig) => {
      const fname = sig.slice(0, sig.indexOf('('));
      if (entries.some((e) => e.name === fname)) return;
      entries.push({ type: 'function', name: fname, stateMutability: 'nonpayable', inputs: [], outputs: [], _note: 'signature only — argument types not enumerated' });
    });
  }

  if (kind === 'erc721' || kind === 'erc1155') {
    Object.entries(EVENTS).forEach(([evName, sig]) => {
      const args = sig.slice(sig.indexOf('(') + 1, -1);
      if (!args) return;
      entries.push({ type: 'event', name: evName, inputs: args.split(',').map((t) => ({ name: '', type: t, indexed: t === 'address' })), _sig: sig });
    });
  }

  return { contractName: name, detected: true, abi: entries };
}
