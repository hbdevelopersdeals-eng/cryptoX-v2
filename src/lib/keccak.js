/* Keccak-256 (the original Keccak padding used by Ethereum, 0x01 domain byte —
 * NOT SHA-3's 0x06) plus EIP-55 checksum helpers.
 *
 * Scope note: this module only ever hashes PUBLIC data (addresses, selectors).
 * It contains no key material, no signing, and no secret handling. A hash is
 * safe to implement and verify here; key derivation is not, which is why the
 * app deliberately does not do it.
 *
 * Verified against the published Keccak-256 vectors in keccak.test.js.
 */

const MASK = (1n << 64n) - 1n;

/* Round constants (iota step). */
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

/* Rho rotation offsets, indexed R[x][y]. */
const R = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14]
];

const rotl = (v, n) => {
  const s = BigInt(n % 64);
  if (s === 0n) return v & MASK;
  return ((v << s) | (v >> (64n - s))) & MASK;
};

function permute(A) {
  for (let round = 0; round < 24; round += 1) {
    // theta
    const C = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x += 1) C[x] = A[x][0] ^ A[x][1] ^ A[x][2] ^ A[x][3] ^ A[x][4];
    const D = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x += 1) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) A[x][y] ^= D[x];
    }

    // rho + pi
    const B = [[0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n]];
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        B[y][(2 * x + 3 * y) % 5] = rotl(A[x][y], R[x][y]);
      }
    }

    // chi
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        A[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y] & MASK) & B[(x + 2) % 5][y]);
      }
    }

    // iota
    A[0][0] ^= RC[round];
  }
  return A;
}

export function utf8ToBytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export const bytesToHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function hexToBytes(hex) {
  const clean = String(hex).replace(/^0x/, '');
  if (clean.length % 2) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

/** Keccak-256 over raw bytes → 32-byte Uint8Array. */
export function keccak256(input) {
  const bytes = input instanceof Uint8Array ? input : utf8ToBytes(String(input));
  const rate = 136; // 1088-bit rate for 256-bit output
  const size = Math.ceil((bytes.length + 1) / rate) * rate;
  const padded = new Uint8Array(size);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;          // Keccak domain separator
  padded[padded.length - 1] ^= 0x80;     // final bit

  const A = [[0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n]];

  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i += 1) {
      let lane = 0n;
      for (let b = 7; b >= 0; b -= 1) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      A[i % 5][Math.floor(i / 5)] ^= lane;
    }
    permute(A);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    let lane = A[i % 5][Math.floor(i / 5)];
    for (let b = 0; b < 8; b += 1) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

export const keccak256Hex = (input) => bytesToHex(keccak256(input));

/** First 4 bytes of the hash of a signature, e.g. "balanceOf(address)". */
export const selector = (signature) => `0x${keccak256Hex(signature).slice(0, 8)}`;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55 mixed-case checksum encoding of an address. */
export function toChecksumAddress(address) {
  const body = String(address).replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(body)) return null;
  const hash = keccak256Hex(body);
  let out = '0x';
  for (let i = 0; i < body.length; i += 1) {
    out += parseInt(hash[i], 16) >= 8 ? body[i].toUpperCase() : body[i];
  }
  return out;
}

/**
 * EIP-55 validation.
 * All-lower or all-upper addresses carry no checksum, so they pass as
 * "unverified" rather than wrong — the caller reports which case applies.
 */
export function checkChecksum(address) {
  const addr = String(address || '').trim();
  if (!ADDRESS_RE.test(addr)) return { valid: false, checksum: 'invalid-format' };
  const body = addr.slice(2);
  if (body === body.toLowerCase()) return { valid: true, checksum: 'not-applied' };
  if (body === body.toUpperCase()) return { valid: true, checksum: 'not-applied' };
  return { valid: toChecksumAddress(addr) === addr, checksum: 'verified' };
}
