/* ULID and UUID identifiers (Section 20).
 *
 * ULID is used where a sortable identifier helps: 48 bits of millisecond
 * timestamp followed by 80 bits of randomness, encoded in Crockford base32, so
 * the string sorts lexicographically by creation time. Postgres `uuid` stays in
 * use where a random identifier is fine.
 *
 * Monotonicity within a millisecond is handled explicitly. Two ULIDs generated
 * in the same millisecond get the same timestamp prefix, and without a counter
 * the random part can sort before the previous one — which breaks the whole
 * reason for choosing ULID.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = -1;
let lastRandom = null;

/** Cryptographically random values, so two clients cannot collide. */
const randomBytes = (length) => {
  const out = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(out);
  } else {
    // No secure source means no secure identifier; refuse rather than pretend.
    throw new Error('ULID requires a cryptographic RNG; crypto.getRandomValues is unavailable.');
  }
  return out;
};

const encodeTime = (time) => {
  let remaining = time;
  let out = '';
  for (let i = TIME_LEN - 1; i >= 0; i -= 1) {
    out = ENCODING[remaining % ENCODING_LEN] + out;
    remaining = Math.floor(remaining / ENCODING_LEN);
  }
  return out;
};

const encodeRandom = (bytes) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ENCODING[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ENCODING[(value << (5 - bits)) & 31];
  return out.slice(0, RANDOM_LEN).padEnd(RANDOM_LEN, '0');
};

/**
 * Generate a ULID.
 * Within the same millisecond the random component increments instead of being
 * regenerated, so identifiers stay strictly increasing.
 */
export function ulid({ now = Date.now() } = {}) {
  const time = Math.floor(now);
  if (time > 0xffffffffffff) throw new Error('ULID timestamp exceeds 48 bits.');

  if (time === lastTime && lastRandom) {
    // Increment the random part in place, carrying like a little-endian counter.
    const chars = lastRandom.split('');
    let i = chars.length - 1;
    while (i >= 0) {
      const idx = ENCODING.indexOf(chars[i]);
      if (idx < ENCODING_LEN - 1) {
        chars[i] = ENCODING[idx + 1];
        break;
      }
      chars[i] = ENCODING[0];
      i -= 1;
    }
    if (i < 0) {
      throw new Error('ULID monotonic counter overflowed within one millisecond.');
    }
    lastRandom = chars.join('');
    return encodeTime(time) + lastRandom;
  }

  lastTime = time;
  lastRandom = encodeRandom(randomBytes(10));
  return encodeTime(time) + lastRandom;
}

/** Reset the monotonic state. Only for tests. */
export const _resetUlidState = () => { lastTime = -1; lastRandom = null; };

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isValidUlid(value) {
  const s = String(value || '').toUpperCase();
  if (!ULID_RE.test(s)) return false;
  // The first character encodes 48 bits in 10 chars, so it cannot exceed 7.
  return ENCODING.indexOf(s[0]) <= 7;
}

/** The creation time encoded in a ULID. */
export function ulidTime(value) {
  if (!isValidUlid(value)) return null;
  const s = String(value).toUpperCase();
  let time = 0;
  for (let i = 0; i < TIME_LEN; i += 1) time = time * ENCODING_LEN + ENCODING.indexOf(s[i]);
  return new Date(time);
}

/* ------------------------------------------------------------------ UUID v4 */

export function uuidV4() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const isValidUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

/**
 * Choose an identifier for a given table.
 * Sortable tables get a ULID; everything else gets a UUID, because a ULID
 * leaks a creation timestamp and that is a real disclosure for some records
 * (a support ticket's ULID reveals when it was filed).
 */
export const ID_STRATEGY = {
  'portfolio.id': 'ulid',
  'alert.id': 'ulid',
  'order.id': 'ulid',
  'invoice.id': 'ulid',
  'audit.id': 'ulid',
  'session.id': 'uuid',
  'invitation.id': 'uuid',
  'api_key.id': 'uuid',
  'data_request.id': 'uuid'
};

export const identifierFor = (key) => (ID_STRATEGY[key] === 'ulid' ? ulid() : uuidV4());
