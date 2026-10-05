/* Address encodings used by the supported chains. Pure functions, no secrets.
 *
 * Why this exists: a mistyped address is one of the most common ways funds are
 * lost. Where an address carries a real checksum we verify it, so a single
 * wrong character is caught BEFORE anything is signed:
 *   - bech32 / bech32m (BIP-173/350): Bitcoin segwit, Cosmos, Cardano
 *   - EIP-55 (keccak-based): all EVM chains — implemented in keccak.js
 *   - Base58Check (double-SHA256): NOT implemented here, so addresses that use
 *     it are validated for format only and reported as "unverified".
 */

export const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_MAP = (() => {
  const m = {};
  for (let i = 0; i < BECH32_CHARSET.length; i += 1) m[BECH32_CHARSET[i]] = i;
  return m;
})();

const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (let i = 0; i < values.length; i += 1) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ values[i];
    for (let j = 0; j < 5; j += 1) {
      if ((top >> j) & 1) chk ^= GEN[j];
    }
  }
  return chk;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/**
 * Decode a bech32 / bech32m string.
 * @returns {{ok:boolean, hrp?:string, data?:number[], variant?:'bech32'|'bech32m', reason?:string}}
 */
export function bech32Decode(input) {
  const str = String(input || '');
  if (str.length < 8) return { ok: false, reason: 'too short' };
  if (str.length > 90) return { ok: false, reason: 'too long (BIP-173 limit is 90 chars)' };
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) {
    return { ok: false, reason: 'mixed case is not allowed' };
  }
  const lower = str.toLowerCase();
  const sep = lower.lastIndexOf('1');
  if (sep < 1 || sep + 7 > lower.length) return { ok: false, reason: 'invalid separator position' };

  const hrp = lower.slice(0, sep);
  const dataPart = lower.slice(sep + 1);
  const data = [];
  for (let i = 0; i < dataPart.length; i += 1) {
    const v = BECH32_MAP[dataPart[i]];
    if (v === undefined) return { ok: false, reason: `invalid character "${dataPart[i]}"` };
    data.push(v);
  }

  const checksum = polymod([...hrpExpand(hrp), ...data]);
  if (checksum === BECH32_CONST) return { ok: true, hrp, data, variant: 'bech32' };
  if (checksum === BECH32M_CONST) return { ok: true, hrp, data, variant: 'bech32m' };
  return { ok: false, reason: 'checksum failed (a character is wrong)' };
}

/** Convert 5-bit groups into 8-bit bytes; returns null on invalid padding. */
export function bech32ToBytes(data) {
  let acc = 0;
  let bits = 0;
  const out = [];
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] < 0 || data[i] > 31) return null;
    acc = (acc << 5) | data[i];
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  // Remaining bits must be zero padding shorter than a byte.
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) return null;
  return new Uint8Array(out);
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Format-level Base58 validation.
 * There is no checksum check here (that needs double-SHA256), so the caller
 * must report these addresses as "unverified" rather than "valid".
 */
export function base58Check(addr) {
  const s = String(addr || '');
  if (!s) return { ok: false, reason: 'empty' };
  for (let i = 0; i < s.length; i += 1) {
    if (!B58_ALPHABET.includes(s[i])) return { ok: false, reason: `invalid base58 character "${s[i]}"` };
  }
  return { ok: true, checksum: 'unverified' };
}

/** Base58 → bytes, for length and version-byte inspection. */
export function base58Decode(addr) {
  const s = String(addr || '');
  let num = 0n;
  for (let i = 0; i < s.length; i += 1) {
    const idx = B58_ALPHABET.indexOf(s[i]);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = hex === '00' ? new Uint8Array(0) : hexToBytesLocal(hex);
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros += 1;
  const out = new Uint8Array(zeros + body.length);
  out.set(body, zeros);
  return out;
}

function hexToBytesLocal(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
