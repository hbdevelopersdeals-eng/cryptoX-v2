import { describe, it, expect, vi, afterEach } from 'vitest';
import { keccak256Hex, selector, toChecksumAddress, checkChecksum, utf8ToBytes } from './keccak.js';
import { bech32Decode, bech32ToBytes, base58Check, base58Decode } from './addressCodec.js';
import { WALLET_CHAINS, derivePath, validateChainAddress, chainById, checksumLabel } from './chains.js';
import {
  CUSTODY_POLICY, CAPABILITIES, capabilitySummary, addressSimilarity, detectAddressPoisoning,
  analyseApprovals, assessAddressRisk, UNLIMITED_APPROVAL_THRESHOLD
} from './walletSecurity.js';
import {
  decodeUint, decodeAbiString, decodeRevertReason, encodeAddress, encodeUint,
  rpcRequest, probeCode, simulateCall, suggestFees, readAllowance, SIG
} from './evmRead.js';

const EVM_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

describe('keccak-256 and EIP-55', () => {
  it('matches the published Keccak-256 vectors', () => {
    expect(keccak256Hex('')).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(keccak256Hex('abc')).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  });

  it('derives the correct function selectors', () => {
    expect(selector('transfer(address,uint256)')).toBe('0xa9059cbb');
    expect(selector('balanceOf(address)')).toBe('0x70a08231');
    expect(SIG.allowance).toBe('0xdd62ed3e');
  });

  it('reproduces the canonical EIP-55 checksum', () => {
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'))
      .toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    expect(checkChecksum('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toEqual({ valid: true, checksum: 'verified' });
  });

  it('catches a corrupted checksum', () => {
    const r = checkChecksum('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD');
    expect(r.valid).toBe(false);
    expect(USDC).toBe(toChecksumAddress(USDC.toLowerCase()));
  });

  it('treats uniform case as having no checksum rather than as wrong', () => {
    expect(checkChecksum(EVM_ADDR.toLowerCase())).toEqual({ valid: true, checksum: 'not-applied' });
    expect(checkChecksum('0xnothex')).toEqual({ valid: false, checksum: 'invalid-format' });
  });

  it('hashes multibyte input as UTF-8', () => {
    expect(utf8ToBytes('é').length).toBe(2);
  });
});

describe('bech32 / bech32m', () => {
  it('accepts the BIP-173 valid vectors', () => {
    ['A12UEL5L', 'a12uel5l', 'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
      'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w'].forEach((v) => {
      expect(bech32Decode(v).ok, v).toBe(true);
    });
    expect(bech32Decode('A12UEL5L').variant).toBe('bech32');
  });

  it('rejects a bad checksum and malformed input', () => {
    expect(bech32Decode('A1G7SGD8').ok).toBe(false);
    expect(bech32Decode('A1G7SGD8').reason).toMatch(/checksum/i);
    expect(bech32Decode('pzry9x0s0muk').ok).toBe(false);   // no separator
    expect(bech32Decode('a12UEL5L').ok).toBe(false);        // mixed case
    // Tampering one data character of a valid vector must break the checksum.
    expect(bech32Decode('abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxz').ok).toBe(false);
  });

  it('converts 5-bit groups back to bytes, excluding the witness version', () => {
    const dec = bech32Decode('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    expect(dec.ok).toBe(true);
    expect(dec.data[0]).toBe(0); // witness version 0
    const program = bech32ToBytes(dec.data.slice(1, -6));
    expect(program.length).toBe(20); // P2WPKH
    // Including the version value makes the padding invalid — the bug this guards.
    expect(bech32ToBytes(dec.data.slice(0, -6))).toBeNull();
  });

  it('rejects invalid base58 characters and decodes valid ones', () => {
    expect(base58Check('0OIl').ok).toBe(false);
    expect(base58Check('So11111111111111111111111111111111111111112').ok).toBe(true);
    const decoded = base58Decode('So11111111111111111111111111111111111111112');
    expect(decoded.length).toBe(32); // a raw Solana public key
  });
});

describe('chain registry', () => {
  it('covers every chain in the scope with a SLIP-44 coin type', () => {
    const ids = WALLET_CHAINS.map((c) => c.id);
    ['evm', 'bitcoin', 'solana', 'tron', 'xrp', 'sui', 'aptos', 'ton', 'cosmos', 'polkadot', 'cardano']
      .forEach((id) => expect(ids, id).toContain(id));
    expect(chainById('bitcoin').slip44).toBe(0);
    expect(chainById('evm').slip44).toBe(60);
    expect(chainById('cardano').slip44).toBe(1815);
  });

  it('builds concrete derivation paths', () => {
    expect(derivePath('evm', { index: 3 })).toBe("m/44'/60'/0'/0/3");
    expect(derivePath('evm', { account: 1, change: 1, index: 2 })).toBe("m/44'/60'/1'/1/2");
    expect(derivePath('bitcoin')).toBe("m/84'/0'/0'/0/0");
    expect(derivePath('solana')).toBe("m/44'/501'/0'/0'");
    expect(derivePath('cardano', { index: 5 })).toBe("m/1852'/1815'/0'/0/5");
    expect(derivePath('sui', { index: 1 })).toBe("m/44'/784'/0'/0'/1'");
    expect(derivePath('nope')).toBeNull();
  });
});

describe('address validation by chain', () => {
  it('verifies EVM checksums and rejects a corrupted one', () => {
    const good = validateChainAddress('evm', USDC);
    expect(good.ok).toBe(true);
    expect(good.checksum).toBe('verified');

    const bad = validateChainAddress('evm', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49');
    // 0x…B49 differs in the last char; if the case pattern no longer matches it must fail.
    expect(bad.ok === false || bad.checksum !== 'verified').toBe(true);
  });

  it('validates Bitcoin bech32 with a real checksum', () => {
    const r = validateChainAddress('bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    expect(r.ok).toBe(true);
    expect(r.checksum).toBe('verified');
  });

  it('accepts Bitcoin legacy but labels it unverified', () => {
    const r = validateChainAddress('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(r.ok).toBe(true);
    expect(r.checksum).toBe('unverified');
  });

  it('validates Solana key length', () => {
    expect(validateChainAddress('solana', 'So11111111111111111111111111111111111111112').ok).toBe(true);
    expect(validateChainAddress('solana', 'abc').ok).toBe(false);
  });

  it('validates Tron by version byte and length', () => {
    const tron = validateChainAddress('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    expect(tron.ok, tron.reason).toBe(true);
    expect(tron.checksum).toBe('unverified'); // base58check is not verified here
    // The same string is not a Tron address (wrong version byte and prefix).
    expect(validateChainAddress('tron', 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH').ok).toBe(false);
  });

  it('validates XRP structurally and labels it unverified', () => {
    const r = validateChainAddress('xrp', 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH');
    expect(r.ok, r.reason).toBe(true);
    expect(r.checksum).toBe('unverified');
    expect(validateChainAddress('xrp', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').ok).toBe(false); // not an 'r' address
  });

  it('normalises Sui/Aptos hex addresses to 32 bytes', () => {
    const r = validateChainAddress('sui', '0x2');
    expect(r.ok).toBe(true);
    expect(r.normalized.length).toBe(66);
  });

  it('rejects a bech32 address whose checksum is wrong', () => {
    expect(bech32Decode('abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxz').ok).toBe(false);
    // Correct checksum but the wrong chain prefix must also be refused.
    const wrongHrp = validateChainAddress('cosmos', 'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw');
    expect(wrongHrp.ok).toBe(false);
    expect(wrongHrp.reason).toMatch(/cosmos1/);
  });

  it('rejects unsupported chains and empty input', () => {
    expect(validateChainAddress('dogecoin', 'D8vFz4p1L37RUcHCMsAQrKcustZ8JYtAfo').ok).toBe(false);
    expect(validateChainAddress('evm', '').ok).toBe(false);
  });

  it('labels how strong each validation result is', () => {
    expect(checksumLabel('verified')).toMatch(/verified/);
    expect(checksumLabel('unverified')).toMatch(/NOT verified/);
    expect(checksumLabel('not-applicable')).toMatch(/no checksum/);
  });
});

describe('custody policy and capability matrix', () => {
  it('states the refusals explicitly', () => {
    const text = CUSTODY_POLICY.map((p) => `${p.title} ${p.detail}`).join(' ');
    expect(text).toMatch(/never ask for a seed phrase/i);
    expect(text).toMatch(/no key material is generated/i);
    expect(text).toMatch(/can sign or broadcast a transaction/i);
    expect(CUSTODY_POLICY.length).toBeGreaterThanOrEqual(5);
  });

  it('marks key-holding features as not offered', () => {
    const byId = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c]));
    ['seed_security', 'hardware_wallet', 'ledger_trezor', 'walletconnect', 'send', 'swap', 'bridge', 'stake']
      .forEach((id) => expect(byId[id].status, id).toBe('none'));
  });

  it('marks the genuinely working features as supported', () => {
    const byId = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c]));
    ['receive', 'approvals', 'gas', 'simulation'].forEach((id) => expect(byId[id].status, id).toBe('supported'));
    ['evm', 'bitcoin', 'solana', 'tron', 'xrp', 'sui', 'aptos', 'ton', 'cosmos', 'polkadot', 'cardano']
      .forEach((id) => expect(byId[id], id).toBeDefined());
  });

  it('summarises the matrix', () => {
    const s = capabilitySummary();
    expect(s.supported + s.partial + s.none).toBe(CAPABILITIES.length);
    expect(s.none).toBeGreaterThan(0);
  });
});

describe('address poisoning detection', () => {
  // A poisoning lookalike shares a leading AND trailing chunk but differs in the
  // middle — that is what makes it look familiar in a wallet's history.
  const REAL = `0x1234${'0'.repeat(32)}abcd`;
  const LOOKALIKE = `0x1234${'f'.repeat(32)}abcd`;
  const NIBBLE_MATCH = `0xabcdef${'0'.repeat(28)}abcdef`;
  const NIBBLE_LOOKALIKE = `0xabcdef${'f'.repeat(28)}abcdef`;
  const known = [{ address: REAL, label: 'Exchange deposit' }];

  it('measures shared prefix and suffix', () => {
    const sim = addressSimilarity(REAL, LOOKALIKE);
    expect(sim.prefix).toBe(4);
    expect(sim.suffix).toBe(4);
    // Differing only in the LAST character is not poisoning — the tails differ.
    expect(addressSimilarity(REAL, `${REAL.slice(0, -1)}e`).suffix).toBe(0);
    expect(addressSimilarity('0xabc', '0xabc')).toBeNull(); // identical → not a lookalike
  });

  it('flags a lookalike that shares a long prefix AND suffix', () => {
    const hits = detectAddressPoisoning(LOOKALIKE, known);
    expect(hits.length).toBe(1);
    expect(hits[0].label).toBe('Exchange deposit');
    expect(hits[0].severity).toBe('medium');

    // Six matching characters on both ends escalates to high severity.
    const high = detectAddressPoisoning(NIBBLE_LOOKALIKE, [{ address: NIBBLE_MATCH, label: 'Cold wallet' }]);
    expect(high[0].severity).toBe('high');
  });

  it('does not flag an unrelated address', () => {
    expect(detectAddressPoisoning('0x9999999999999999999999999999999999999999', known)).toEqual([]);
  });
});

describe('address risk assessment', () => {
  it('flags the burn address as critical', () => {
    const r = assessAddressRisk('0x0000000000000000000000000000000000000000', 'evm');
    expect(r.risk).toBe('critical');
    expect(r.findings.some((f) => f.code === 'burn')).toBe(true);
  });

  it('flags a typo-level checksum failure as critical', () => {
    const r = assessAddressRisk('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD', 'evm');
    expect(r.risk).toBe('critical');
  });

  it('warns about poisoning and passes through the contract probe', () => {
    const real = `0xabcdef${'0'.repeat(28)}abcdef`;
    const lookalike = `0xabcdef${'f'.repeat(28)}abcdef`;
    const r = assessAddressRisk(lookalike, 'evm', {
      known: [{ address: real, label: 'Cold wallet' }],
      isContract: true
    });
    expect(r.findings.some((f) => f.code === 'address-poisoning')).toBe(true);
    expect(r.findings.some((f) => f.code === 'contract')).toBe(true);
    expect(r.risk).toBe('high');
  });

  it('reports clean when nothing is wrong', () => {
    const r = assessAddressRisk(USDC, 'evm');
    expect(r.risk).toBe('clean');
    expect(r.validation.checksum).toBe('verified');
  });
});

describe('approval analysis', () => {
  const MAX = UNLIMITED_APPROVAL_THRESHOLD;

  it('flags an unlimited allowance as high risk', () => {
    const r = analyseApprovals([{ token: USDC, symbol: 'USDC', spender: EVM_ADDR, spenderLabel: 'Uniswap', allowance: MAX }]);
    expect(r.rows[0].unlimited).toBe(true);
    expect(r.rows[0].risk).toBe('high');
    expect(r.unlimitedCount).toBe(1);
    expect(r.highRiskCount).toBe(1);
  });

  it('recognises a revoked allowance', () => {
    const r = analyseApprovals([{ token: USDC, symbol: 'USDC', spender: EVM_ADDR, allowance: 0n }]);
    expect(r.rows[0].revoked).toBe(true);
    expect(r.rows[0].unlimited).toBe(false);
    expect(r.revokedCount).toBe(1);
  });

  it('escalates a burn-address spender to critical', () => {
    const r = analyseApprovals([{
      token: USDC, spender: '0x000000000000000000000000000000000000dEaD', allowance: MAX
    }]);
    expect(r.rows[0].risk).toBe('critical');
  });

  it('notes an unlabelled spender', () => {
    const r = analyseApprovals([{ token: USDC, spender: EVM_ADDR, allowance: 5n }]);
    expect(r.rows[0].flags.some((f) => f.code === 'unknown-spender')).toBe(true);
  });
});

describe('EVM read helpers (pure parts)', () => {
  it('encodes and decodes uint256 values', () => {
    // Left-padded to a 32-byte word.
    expect(encodeAddress(EVM_ADDR)).toBe(`${'0'.repeat(24)}d8da6bf26964af9d7eed9e03e53415d37aa96045`);
    expect(encodeAddress(EVM_ADDR).length).toBe(64);
    expect(encodeUint(255)).toBe('00000000000000000000000000000000000000000000000000000000000000ff');
    expect(decodeUint('0xde0b6b3a7640000')).toBe(1000000000000000000n);
    expect(decodeUint('nope')).toBeNull();
  });

  it('decodes an ABI-encoded string', () => {
    // offset(32) | length(4) | "USDC" padded
    const encoded = `0x${'0'.repeat(62)}20${'0'.repeat(62)}0455534443${'0'.repeat(56)}`;
    expect(decodeAbiString(encoded)).toBe('USDC');
    expect(decodeAbiString('0x00')).toBeNull();
  });

  it('decodes a standard Error(string) revert', () => {
    const payload = `0x08c379a0${'0'.repeat(62)}20${'0'.repeat(62)}0342616400${'0'.repeat(54)}`;
    expect(decodeRevertReason(payload)).toBe('Bad');
    expect(decodeRevertReason('0xdeadbeef')).toBeNull();
  });
});

describe('EVM transport and simulation', () => {
  afterEach(() => vi.unstubAllGlobals());

  const okResponse = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });

  it('falls back to the second endpoint when the first errors', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } }) };
      return okResponse('0xde0b6b3a7640000');
    }));
    const r = await rpcRequest('ethereum', 'eth_gasPrice', []);
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(2);
  });

  it('distinguishes a wallet from a contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('0x6080604052')));
    const asContract = await probeCode('ethereum', USDC);
    expect(asContract.isContract).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => okResponse('0x')));
    const asWallet = await probeCode('ethereum', EVM_ADDR);
    expect(asWallet.isContract).toBe(false);
  });

  it('reports a successful dry run without broadcasting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('0x0000000000000000000000000000000000000000000000000000000000000001')));
    const r = await simulateCall('ethereum', { from: EVM_ADDR, to: USDC, data: SIG.decimals });
    expect(r.success).toBe(true);
  });

  it('surfaces a revert reason instead of pretending success', async () => {
    const revert = `0x08c379a0${'0'.repeat(62)}20${'0'.repeat(62)}0c496e73756666696369656e7400${'0'.repeat(42)}`;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted', data: revert } })
    })));
    const r = await simulateCall('ethereum', { to: USDC });
    expect(r.ok).toBe(true);
    expect(r.success).toBe(false);
    expect(r.reason).toBe('Insufficient');
  });

  it('requires a target for simulation and both parties for estimation', async () => {
    expect((await simulateCall('ethereum', {})).ok).toBe(false);
    expect((await suggestFees('dogecoin')).ok).toBe(false);
  });

  it('computes an EIP-1559 fee suggestion from fee history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({
      baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
      reward: [['0x3b9aca00', '0x59682f00'], ['0x3b9aca00', '0x59682f00']],
      gasUsedRatio: [0.5, 0.5]
    })));
    const f = await suggestFees('ethereum');
    expect(f.ok).toBe(true);
    expect(f.eip1559).toBe(true);
    expect(f.baseFeePerGas).toBe(1000000000n);
    // maxFee = base*2 + tip(1.5 gwei)
    expect(f.maxFeePerGas).toBe(1000000000n * 2n + 1500000000n);
  });

  it('reads an allowance as a bigint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')));
    const r = await readAllowance('ethereum', USDC, EVM_ADDR, USDC);
    expect(r.ok).toBe(true);
    expect(r.allowance).toBe((1n << 256n) - 1n);
  });
});
