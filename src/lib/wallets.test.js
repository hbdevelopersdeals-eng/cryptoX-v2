import { describe, it, expect } from 'vitest';
import { afterEach, vi } from 'vitest';
import {
  validateAddress, satsToCoin, hexToUnits, lamportsToSol,
  parseBitcoinBalance, parseEvmBalance, parseSolBalance, chainMeta, SYNC_METHODS, TRACKING_LIMITS,
  fetchWalletBalance, EVM_RPC, SUPPORTED_CHAINS
} from './wallets.js';

describe('address validation', () => {
  it('accepts valid Bitcoin legacy, P2SH and bech32 addresses', () => {
    expect(validateAddress('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').ok).toBe(true);
    expect(validateAddress('bitcoin', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy').ok).toBe(true);
    expect(validateAddress('bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4').ok).toBe(true);
  });

  it('rejects malformed Bitcoin addresses', () => {
    expect(validateAddress('bitcoin', 'bc1$$$not an address').ok).toBe(false);
    expect(validateAddress('bitcoin', '0x1234567890abcdef1234567890abcdef12345678').ok).toBe(false);
    expect(validateAddress('bitcoin', '').ok).toBe(false);
  });

  it('requires 0x plus 40 hex chars for EVM chains', () => {
    expect(validateAddress('ethereum', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984').ok).toBe(true);
    expect(validateAddress('ethereum', '0x1234').ok).toBe(false);
    expect(validateAddress('polygon', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984').ok).toBe(true);
  });

  it('accepts base58 Solana addresses', () => {
    expect(validateAddress('solana', 'So11111111111111111111111111111111111111112').ok).toBe(true);
    expect(validateAddress('solana', 'not base58 !!!').ok).toBe(false);
  });

  it('rejects unsupported chains', () => {
    expect(validateAddress('dogecoin', 'D8vFz4p1L37RUcHCMsAQrKcustZ8JYtAfo').ok).toBe(false);
  });
});

describe('unit conversion', () => {
  it('converts sats to BTC', () => {
    expect(satsToCoin(100000000)).toBe(1);
    expect(satsToCoin(123456789)).toBeCloseTo(1.23456789, 8);
    expect(satsToCoin(null)).toBeNull();
  });

  it('converts hex wei to ETH without BigInt precision loss', () => {
    expect(hexToUnits('0x0')).toBe(0);
    expect(hexToUnits('0xde0b6b3a7640000')).toBe(1); // 1e18
    expect(hexToUnits('0x1bc16d674ec80000')).toBe(2); // 2e18
    expect(hexToUnits('0x16345785d8a0000')).toBeCloseTo(0.1, 8);
    expect(hexToUnits('nonsense')).toBeNull();
  });

  it('converts lamports to SOL', () => {
    expect(lamportsToSol(1000000000)).toBe(1);
    expect(lamportsToSol(null)).toBeNull();
  });
});

describe('response parsing', () => {
  it('nets funded minus spent for Bitcoin, and separates mempool', () => {
    const r = parseBitcoinBalance({
      chain_stats: { funded_txo_sum: 500000000, spent_txo_sum: 200000000, tx_count: 4 },
      mempool_stats: { funded_txo_sum: 10000000, spent_txo_sum: 0 }
    });
    expect(r.balance).toBe(3);
    expect(r.pending).toBe(0.1);
    expect(r.txCount).toBe(4);
    expect(r.error).toBeNull();
  });

  it('reports an error for an unexpected Bitcoin payload', () => {
    expect(parseBitcoinBalance({}).balance).toBeNull();
    expect(parseBitcoinBalance({}).error).toBeTruthy();
  });

  it('decodes an EVM balance result', () => {
    expect(parseEvmBalance('0xde0b6b3a7640000').balance).toBe(1);
    expect(parseEvmBalance(undefined).error).toBeTruthy();
  });

  it('decodes a Solana RPC payload', () => {
    expect(parseSolBalance({ result: { value: 2000000000 } }).balance).toBe(2);
    expect(parseSolBalance({ error: { message: 'bad address' } }).error).toBe('bad address');
  });
});

describe('supported chains and honest capability reporting', () => {
  it('knows chain metadata', () => {
    expect(chainMeta('bitcoin').unit).toBe('BTC');
    expect(chainMeta('solana').kind).toBe('account');
    expect(chainMeta('nope')).toBeNull();
  });

  it('marks exchange API sync and wallet connect as unavailable', () => {
    const byId = Object.fromEntries(SYNC_METHODS.map((m) => [m.id, m]));
    expect(byId.manual.available).toBe(true);
    expect(byId.address.available).toBe(true);
    // These are deliberately not offered rather than faked.
    expect(byId.exchange_api.available).toBe(false);
    expect(byId.wallet_connect.available).toBe(false);
    expect(byId.exchange_api.detail).toMatch(/server-side/i);
  });

  it('states the tracking limits', () => {
    expect(TRACKING_LIMITS.join(' ')).toMatch(/token balances are not scanned/i);
  });

  it('gives every EVM chain at least one fallback endpoint', () => {
    Object.entries(EVM_RPC).forEach(([id, cfg]) => {
      expect(cfg.rpcs.length, `${id} needs a fallback`).toBeGreaterThanOrEqual(2);
      cfg.rpcs.forEach((u) => expect(u.startsWith('https://')).toBe(true));
      // Every chain must also appear in the public chain list with its own explorer.
      expect(chainMeta(id).explorer).toBe(cfg.explorer);
    });
    expect(SUPPORTED_CHAINS.length).toBeGreaterThanOrEqual(7);
  });
});

describe('endpoint fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls through to the next endpoint when the first returns a JSON-RPC error', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        // A dead endpoint answers HTTP 200 with a JSON-RPC error envelope.
        return { ok: true, json: async () => ({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: 1 }) };
      }
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' }) };
    }));

    const res = await fetchWalletBalance('ethereum', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(res.status).toBe('ok');
    expect(res.balance).toBe(1);
    expect(calls).toHaveLength(2);
    expect(res.rpcUsed).toBe(EVM_RPC.ethereum.rpcs[1]);
  });

  it('reports an error when every endpoint fails — never a zero balance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: 1 })
    })));

    const res = await fetchWalletBalance('polygon', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(res.status).toBe('error');
    expect(res.balance).toBeNull();
    expect(res.error).toBe('Internal error');
  });

  it('rejects a malformed address before making any request', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const res = await fetchWalletBalance('ethereum', 'not-an-address');
    expect(res.status).toBe('error');
    expect(spy).not.toHaveBeenCalled();
  });

  it('reads a Bitcoin balance from the indexer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        chain_stats: { funded_txo_sum: 500000000, spent_txo_sum: 200000000, tx_count: 3 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 }
      })
    })));
    const res = await fetchWalletBalance('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(res.status).toBe('ok');
    expect(res.balance).toBe(3);
    expect(res.unit).toBe('BTC');
  });
});
