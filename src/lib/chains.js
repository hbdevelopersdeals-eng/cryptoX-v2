/* Chain + derivation-path registry and address validation.
 *
 * Pure reference data and format/checksum validation. No keys, no signing.
 *
 * Every chain reports HOW FAR its validation goes:
 *   'verified'      — a real checksum was checked (EIP-55, bech32/bech32m)
 *   'unverified'    — format only; the encoding's checksum was not checked
 *   'not-applicable'— the format carries no checksum at all
 * Reporting "unverified" instead of "valid" is deliberate: a format check that
 * passes is not proof the address is spendable, and never proof it is yours.
 */

import { checkChecksum, hexToBytes } from './keccak.js';
import { bech32Decode, bech32ToBytes, base58Check, base58Decode } from './addressCodec.js';

/** SLIP-44 coin types and the derivation paths wallets actually use. */
export const WALLET_CHAINS = [
  {
    id: 'evm', name: 'EVM chains', slip44: 60, curve: 'secp256k1',
    covers: ['Ethereum', 'BNB Chain', 'Polygon', 'Arbitrum', 'OP Mainnet'],
    paths: [{ label: 'BIP-44 standard', path: "m/44'/60'/0'/0/i" }]
  },
  {
    id: 'bitcoin', name: 'Bitcoin', slip44: 0, curve: 'secp256k1',
    paths: [
      { label: 'BIP-84 native segwit (bc1)', path: "m/84'/0'/0'/0/i" },
      { label: 'BIP-49 P2SH-segwit (3…)', path: "m/49'/0'/0'/0/i" },
      { label: 'BIP-44 legacy (1…)', path: "m/44'/0'/0'/0/i" }
    ]
  },
  { id: 'solana', name: 'Solana', slip44: 501, curve: 'ed25519', paths: [{ label: 'BIP-44', path: "m/44'/501'/0'/0'" }] },
  { id: 'tron', name: 'Tron', slip44: 195, curve: 'secp256k1', paths: [{ label: 'BIP-44', path: "m/44'/195'/0'/0/i" }] },
  { id: 'xrp', name: 'XRP Ledger', slip44: 144, curve: 'secp256k1', paths: [{ label: 'BIP-44', path: "m/44'/144'/0'/0/i" }] },
  { id: 'sui', name: 'Sui', slip44: 784, curve: 'ed25519', paths: [{ label: 'BIP-44', path: "m/44'/784'/0'/0'/i" }] },
  { id: 'aptos', name: 'Aptos', slip44: 637, curve: 'ed25519', paths: [{ label: 'BIP-44', path: "m/44'/637'/0'/0'/i" }] },
  { id: 'ton', name: 'TON', slip44: 607, curve: 'ed25519', paths: [{ label: 'BIP-44', path: "m/44'/607'/0'/0'" }] },
  { id: 'cosmos', name: 'Cosmos Hub', slip44: 118, curve: 'secp256k1', paths: [{ label: 'BIP-44', path: "m/44'/118'/0'/0/i" }] },
  { id: 'polkadot', name: 'Polkadot', slip44: 354, curve: 'sr25519', paths: [{ label: 'BIP-44', path: "m/44'/354'/0'/0'/i" }] },
  { id: 'cardano', name: 'Cardano', slip44: 1815, curve: 'ed25519', paths: [{ label: 'CIP-1852', path: "m/1852'/1815'/0'/0/i" }] }
];

export const chainById = (id) => WALLET_CHAINS.find((c) => c.id === id) || null;

/**
 * Build a concrete BIP-32 derivation path.
 * `change` is 0 for receive addresses and 1 for internal/change addresses on the
 * chains that use the two-branch scheme (Bitcoin, EVM, Cardano).
 */
export function derivePath(chainId, { account = 0, change = 0, index = 0 } = {}) {
  const a = `${account}'`;
  const c = String(change);
  switch (chainId) {
    case 'evm': return `m/44'/60'/${a}/${c}/${index}`;
    case 'bitcoin': return `m/84'/0'/${a}/${c}/${index}`;
    case 'tron': return `m/44'/195'/${a}/${c}/${index}`;
    case 'xrp': return `m/44'/144'/${a}/${c}/${index}`;
    case 'cosmos': return `m/44'/118'/${a}/${c}/${index}`;
    case 'cardano': return `m/1852'/1815'/${a}/${c}/${index}`;
    // Single-branch chains: no change level.
    case 'solana': return `m/44'/501'/${a}/0'`;
    case 'ton': return `m/44'/607'/${a}/0'`;
    // Ed25519 chains that hardened the final level.
    case 'sui': return `m/44'/784'/${a}/0'/${index}'`;
    case 'aptos': return `m/44'/637'/${a}/0'/${index}'`;
    case 'polkadot': return `m/44'/354'/${a}/0'/${index}'`;
    default: return null;
  }
}

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const pass = (normalized, checksum, note) => ({ ok: true, normalized, checksum, note });

/* ---------------- per-chain validators ---------------- */

function validateBitcoin(addr) {
  if (addr.toLowerCase().startsWith('bc1')) {
    const dec = bech32Decode(addr);
    if (!dec.ok) return fail(dec.reason);
    // data = [witnessVersion, ...program, ...6 checksum]. The version byte is NOT
    // part of the 5→8 conversion — including it makes the padding invalid and
    // would reject every valid segwit address.
    const version = dec.data[0];
    const program = bech32ToBytes(dec.data.slice(1, -6));
    if (!program) return fail('invalid segwit program encoding');
    if (version === 0) {
      if (dec.variant !== 'bech32') return fail('segwit v0 must use bech32, not bech32m');
      if (program.length !== 20 && program.length !== 32) return fail('segwit v0 program must be 20 or 32 bytes');
    } else if (version === 1) {
      if (dec.variant !== 'bech32m') return fail('taproot (v1) must use bech32m');
      if (program.length !== 32) return fail('taproot program must be 32 bytes');
    } else {
      return fail(`unsupported witness version ${version}`);
    }
    return pass(dec.variant === 'bech32m' ? addr.toLowerCase() : addr, 'verified', 'Bech32 checksum verified');
  }

  const b58 = base58Check(addr);
  if (!b58.ok) return fail(b58.reason);
  const decoded = base58Decode(addr);
  if (!decoded || decoded.length !== 25) return fail('legacy address must decode to 25 bytes');
  const version = decoded[0];
  if (version !== 0x00 && version !== 0x05) return fail('unexpected version byte for a mainnet address');
  if (version === 0x00 && addr[0] !== '1') return fail('P2PKH addresses start with 1');
  if (version === 0x05 && addr[0] !== '3') return fail('P2SH addresses start with 3');
  return pass(addr, 'unverified', 'Base58Check checksum not verified in the browser');
}

function validateBase58Fixed(addr, { expectLength, versionByte, prefix, name, checksum = 'unverified' }) {
  const b58 = base58Check(addr);
  if (!b58.ok) return fail(b58.reason);
  const decoded = base58Decode(addr);
  if (!decoded) return fail('could not decode base58');
  if (expectLength != null && decoded.length !== expectLength) {
    return fail(`${name} addresses decode to ${expectLength} bytes, got ${decoded.length}`);
  }
  if (versionByte != null && decoded[0] !== versionByte) {
    return fail(`unexpected version byte 0x${decoded[0].toString(16)} for ${name}`);
  }
  if (prefix && !addr.startsWith(prefix)) return fail(`${name} addresses start with "${prefix}"`);
  return pass(addr, checksum, checksum === 'unverified' ? 'Checksum not verified in the browser' : null);
}

function validateBech32Hrp(addr, { hrp, lengthBytes, name }) {
  const dec = bech32Decode(addr);
  if (!dec.ok) return fail(dec.reason);
  if (dec.hrp !== hrp) return fail(`expected a "${hrp}1…" address`);
  const bytes = bech32ToBytes(dec.data.slice(0, -6));
  if (!bytes) return fail('invalid data encoding');
  if (lengthBytes && !lengthBytes.includes(bytes.length)) {
    return fail(`${name} payload should be ${lengthBytes.join(' or ')} bytes, got ${bytes.length}`);
  }
  return pass(addr.toLowerCase(), 'verified', 'Bech32 checksum verified');
}

export function validateChainAddress(chainId, address) {
  const addr = String(address || '').trim();
  if (!addr) return fail('Enter an address');

  switch (chainId) {
    case 'evm': {
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        return fail('Expected 0x followed by 40 hex characters');
      }
      const c = checkChecksum(addr);
      if (c.checksum === 'verified' && !c.valid) {
        return fail('EIP-55 checksum failed — a character is wrong or the case is corrupted', { checksum: 'failed' });
      }
      return pass(addr, c.checksum === 'verified' ? 'verified' : 'not-applicable',
        c.checksum === 'verified' ? 'EIP-55 checksum verified' : 'All-lower or all-upper addresses carry no checksum');
    }

    case 'bitcoin':
      return validateBitcoin(addr);

    case 'solana': {
      const b58 = base58Check(addr);
      if (!b58.ok) return fail(b58.reason);
      const decoded = base58Decode(addr);
      if (!decoded) return fail('could not decode base58');
      // A Solana address is a raw 32-byte public key with no checksum.
      if (decoded.length !== 32) return fail(`Solana public keys are 32 bytes, got ${decoded.length}`);
      return pass(addr, 'not-applicable', 'Raw public key — this format carries no checksum');
    }

    case 'tron':
      return validateBase58Fixed(addr, { expectLength: 25, versionByte: 0x41, prefix: 'T', name: 'Tron' });

    case 'xrp': {
      // Structural checks only. XRPL's leading byte is not asserted here because
      // it could not be confirmed against a primary source in this environment —
      // claiming a version byte we cannot verify would be worse than omitting it.
      const b58 = base58Check(addr);
      if (!b58.ok) return fail(b58.reason);
      const decoded = base58Decode(addr);
      if (!decoded) return fail('could not decode base58');
      if (decoded.length !== 25) return fail(`XRP addresses decode to 25 bytes, got ${decoded.length}`);
      if (!addr.startsWith('r')) return fail('XRPL accounts start with "r"');
      return pass(addr, 'unverified', 'Base58Check checksum and prefix byte are not verified in the browser');
    }

    case 'sui': {
      if (!/^0x[0-9a-fA-F]{1,64}$/.test(addr)) return fail('Expected 0x followed by up to 64 hex characters');
      const padded = `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
      return pass(padded, 'not-applicable', 'Hex address — no checksum in this format');
    }

    case 'aptos': {
      if (!/^0x[0-9a-fA-F]{1,64}$/.test(addr)) return fail('Expected 0x followed by up to 64 hex characters');
      const padded = `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
      return pass(padded, 'not-applicable', 'Hex address — no checksum in this format');
    }

    case 'ton': {
      // Friendly form: 48 base64url chars beginning with EQ/UQ. Raw form: workchain:hex.
      if (/^-?\d+:[0-9a-fA-F]{64}$/.test(addr)) {
        return pass(addr, 'not-applicable', 'Raw workchain:hex form — no checksum');
      }
      if (!/^[A-Za-z0-9_-]{48}$/.test(addr)) {
        return fail('Expected a 48-character friendly address (EQ…/UQ…) or workchain:hex');
      }
      if (!/^(EQ|UQ|0Q|kQ)/.test(addr)) {
        return fail('Friendly TON addresses normally start with EQ or UQ');
      }
      return pass(addr, 'unverified', 'Base64url integrity is not decoded in the browser');
    }

    case 'cosmos':
      return validateBech32Hrp(addr, { hrp: 'cosmos', lengthBytes: [20, 32], name: 'Cosmos' });

    case 'polkadot': {
      const b58 = base58Check(addr);
      if (!b58.ok) return fail(b58.reason);
      const decoded = base58Decode(addr);
      if (!decoded) return fail('could not decode base58');
      if (decoded.length !== 33 && decoded.length !== 34) {
        return fail(`SS58 addresses decode to 33–34 bytes, got ${decoded.length}`);
      }
      if (decoded[0] !== 0) return fail('Not a Polkadot mainnet prefix (SS58 prefix 0)');
      return pass(addr, 'unverified', 'SS58 uses a blake2b checksum, which is not verified in the browser');
    }

    case 'cardano': {
      if (/^(Ae2|DdzFF)/.test(addr)) {
        return pass(addr, 'unverified', 'Byron-era address — full validation not available');
      }
      const dec = bech32Decode(addr);
      if (!dec.ok) return fail(dec.reason);
      if (dec.hrp !== 'addr' && dec.hrp !== 'addr_test') return fail('Expected an "addr1…" Shelley address');
      const bytes = bech32ToBytes(dec.data.slice(0, -6));
      if (!bytes) return fail('invalid data encoding');
      if (bytes.length < 28) return fail('Shelley address payload is too short');
      return pass(addr.toLowerCase(), 'verified', 'Bech32 checksum verified');
    }

    default:
      return fail('Unsupported chain');
  }
}

/** Human label for how strong a validation result is. */
export function checksumLabel(checksum) {
  switch (checksum) {
    case 'verified': return 'checksum verified';
    case 'unverified': return 'format checked — checksum NOT verified';
    default: return 'no checksum in this format';
  }
}
