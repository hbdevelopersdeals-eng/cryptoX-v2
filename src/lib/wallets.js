/* Read-only blockchain wallet tracking.
 *
 * Scope and safety boundaries (deliberate, not limitations to work around):
 *   - PUBLIC ADDRESSES ONLY. We never ask for, accept, transmit or store a seed
 *     phrase, private key, or exchange API secret.
 *   - WATCH-ONLY. This module cannot sign or move funds; it holds no keys, so
 *     there is nothing here to compromise.
 *   - No wallet "connect" handshake is needed to read a public balance, so we
 *     do not ship a WalletConnect/provider dependency that would imply signing.
 *
 * Every read is done against public, keyless endpoints. If an endpoint refuses
 * browser access (CORS) or fails, the result is reported as an error — we never
 * fabricate a balance.
 */

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Public, keyless endpoints, each verified to answer `eth_getBalance` at build
 * time. Multiple endpoints per chain because a single public RPC does go dark:
 * cloudflare-eth.com began returning a JSON-RPC "Internal error" and
 * polygon-rpc.com started requiring an API key, so each chain now has a
 * fallback. A CORS refusal or an error is surfaced to the user, never hidden.
 */
export const EVM_RPC = {
  ethereum: {
    name: 'Ethereum', native: 'ETH', decimals: 18, explorer: 'https://etherscan.io/address/',
    rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
  },
  arbitrum: {
    name: 'Arbitrum One', native: 'ETH', decimals: 18, explorer: 'https://arbiscan.io/address/',
    rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com']
  },
  optimism: {
    name: 'OP Mainnet', native: 'ETH', decimals: 18, explorer: 'https://optimistic.etherscan.io/address/',
    rpcs: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com']
  },
  bsc: {
    name: 'BNB Chain', native: 'BNB', decimals: 18, explorer: 'https://bscscan.com/address/',
    rpcs: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com']
  },
  polygon: {
    name: 'Polygon', native: 'POL', decimals: 18, explorer: 'https://polygonscan.com/address/',
    rpcs: ['https://polygon.drpc.org', 'https://1rpc.io/matic']
  }
};

export const SUPPORTED_CHAINS = [
  { id: 'bitcoin', name: 'Bitcoin', unit: 'BTC', kind: 'utxo', explorer: 'https://blockstream.info/address/' },
  ...Object.entries(EVM_RPC).map(([id, c]) => ({
    id, name: c.name, unit: c.native, kind: 'evm', explorer: c.explorer
  })),
  { id: 'solana', name: 'Solana', unit: 'SOL', kind: 'account', explorer: 'https://solscan.io/account/' }
];

export const chainMeta = (id) => SUPPORTED_CHAINS.find((c) => c.id === id) || null;

/* ---------------- pure helpers (unit tested) ---------------- */

const BTC_RE = /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Format-only validation. Passing this does NOT prove an address exists. */
export function validateAddress(chainId, address) {
  const addr = String(address || '').trim();
  if (!addr) return { ok: false, reason: 'Enter an address' };
  if (chainId === 'bitcoin') {
    if (addr.toLowerCase().startsWith('bc1')) {
      return BTC_RE.test(addr.toLowerCase())
        ? { ok: true, address: addr }
        : { ok: false, reason: 'Bech32 address looks malformed' };
    }
    return BTC_RE.test(addr)
      ? { ok: true, address: addr }
      : { ok: false, reason: 'Expected a legacy (1…/3…) or bech32 (bc1…) address' };
  }
  if (chainId === 'solana') {
    return SOL_RE.test(addr) ? { ok: true, address: addr } : { ok: false, reason: 'Expected a base58 Solana address (32–44 chars)' };
  }
  if (EVM_RPC[chainId]) {
    return EVM_RE.test(addr)
      ? { ok: true, address: addr }
      : { ok: false, reason: 'Expected 0x followed by 40 hex characters' };
  }
  return { ok: false, reason: 'Unsupported chain' };
}

/** sats → BTC */
export const satsToCoin = (sats) => (num(sats) == null ? null : num(sats) / 1e8);

/** Hex wei (or lamports) → decimal units, without BigInt precision loss. */
export function hexToUnits(hex, decimals = 18) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  let value = BigInt(hex);
  if (value === 0n) return 0;
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const frac = value % divisor;
  // Keep 8 significant decimals; anything beyond is noise for display.
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 8);
  return Number(`${whole}.${fracStr}`);
}

export const lamportsToSol = (lamports) => (num(lamports) == null ? null : num(lamports) / 1e9);

/** Blockstream address response → balance in BTC. */
export function parseBitcoinBalance(json) {
  const cs = json?.chain_stats;
  if (!cs) return { balance: null, error: 'Unexpected response from the Bitcoin indexer' };
  const funded = num(cs.funded_txo_sum);
  const spent = num(cs.spent_txo_sum);
  if (funded == null || spent == null) return { balance: null, error: 'Missing balance fields' };
  const memFunded = num(json?.mempool_stats?.funded_txo_sum) || 0;
  const memSpent = num(json?.mempool_stats?.spent_txo_sum) || 0;
  return {
    balance: satsToCoin(funded - spent),
    pending: satsToCoin(memFunded - memSpent),
    txCount: num(cs.tx_count),
    error: null
  };
}

/** JSON-RPC eth_getBalance result → native units. */
export function parseEvmBalance(result, decimals = 18) {
  if (typeof result !== 'string') return { balance: null, error: 'Unexpected RPC response' };
  const value = hexToUnits(result, decimals);
  return value == null ? { balance: null, error: 'Could not decode balance' } : { balance: value, error: null };
}

/** JSON-RPC getBalance (Solana) result → SOL. */
export function parseSolBalance(json) {
  const lamports = num(json?.result?.value);
  if (lamports == null) return { balance: null, error: json?.error?.message || 'Unexpected RPC response' };
  return { balance: lamportsToSol(lamports), error: null };
}

/* ---------------- network ---------------- */

async function jsonFetch(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const failure = (chain, address, err) => ({
  chain,
  address,
  balance: null,
  status: 'error',
  error:
    err?.name === 'AbortError'
      ? 'Request timed out'
      : /Failed to fetch|NetworkError|Load failed/i.test(String(err?.message))
        ? 'Endpoint refused browser access (CORS) — try another chain or retry later'
        : err?.message || 'Request failed',
  at: Date.now()
});

/**
 * Read the native balance of one public address.
 * Never throws: a failure comes back as { status: 'error', balance: null }.
 */
export async function fetchWalletBalance(chain, address) {
  const meta = chainMeta(chain);
  if (!meta) return { chain, address, balance: null, status: 'error', error: 'Unsupported chain', at: Date.now() };

  const check = validateAddress(chain, address);
  if (!check.ok) return { chain, address, balance: null, status: 'error', error: check.reason, at: Date.now() };
  const addr = check.address;

  try {
    if (chain === 'bitcoin') {
      const json = await jsonFetch(`https://blockstream.info/api/address/${encodeURIComponent(addr)}`);
      const parsed = parseBitcoinBalance(json);
      if (parsed.error) return { chain, address: addr, balance: null, status: 'error', error: parsed.error, at: Date.now() };
      return { chain, address: addr, balance: parsed.balance, pending: parsed.pending, txCount: parsed.txCount, unit: meta.unit, status: 'ok', error: null, at: Date.now() };
    }

    if (chain === 'solana') {
      const json = await jsonFetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addr] })
      });
      const parsed = parseSolBalance(json);
      if (parsed.error) return { chain, address: addr, balance: null, status: 'error', error: parsed.error, at: Date.now() };
      return { chain, address: addr, balance: parsed.balance, unit: meta.unit, status: 'ok', error: null, at: Date.now() };
    }

    /* Walk the endpoint list: one dead public RPC must not take the chain down. */
    const cfg = EVM_RPC[chain];
    const payload = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest']
    });
    let lastError = 'No endpoint available';

    for (const rpc of cfg.rpcs) {
      try {
        const json = await jsonFetch(rpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload
        });
        if (json?.error) {
          lastError = json.error.message || 'RPC error';
          continue; // try the next endpoint
        }
        const parsed = parseEvmBalance(json?.result, cfg.decimals);
        if (parsed.error) {
          lastError = parsed.error;
          continue;
        }
        return {
          chain, address: addr, balance: parsed.balance, unit: cfg.native,
          rpcUsed: rpc, status: 'ok', error: null, at: Date.now()
        };
      } catch (err) {
        lastError = err?.name === 'AbortError'
          ? 'Request timed out'
          : /Failed to fetch|NetworkError|Load failed/i.test(String(err?.message))
            ? 'Endpoint refused browser access (CORS)'
            : err?.message || 'Request failed';
      }
    }

    return { chain, address: addr, balance: null, status: 'error', error: lastError, at: Date.now() };
  } catch (err) {
    return failure(chain, addr, err);
  }
}

/**
 * How a holding can get into the portfolio, and what each method can honestly do
 * in a client-only app. Exchange API sync is listed as unavailable on purpose:
 * it needs server-side secret storage, and a browser-only app must never hold
 * exchange API keys.
 */
export const SYNC_METHODS = [
  {
    id: 'manual',
    name: 'Manual entry',
    available: true,
    detail: 'Record buys, sells and transfers yourself. Full lot, cost-basis and tax support.'
  },
  {
    id: 'address',
    name: 'Watch a public address',
    available: true,
    detail: 'Read-only native balance for Bitcoin, Ethereum, Arbitrum, OP Mainnet, BNB Chain, Polygon and Solana. No keys, no signing.'
  },
  {
    id: 'exchange_api',
    name: 'Exchange API sync',
    available: false,
    detail: 'Requires server-side secret storage. A browser-only app cannot hold exchange API keys safely, so this is not offered rather than faked.'
  },
  {
    id: 'wallet_connect',
    name: 'Interactive wallet connect',
    available: false,
    detail: 'Only needed to sign transactions. CryptoX is a read-only tracker, so it ships no signing provider.'
  }
];

/** Non-EVM chains and ERC-20 tokens are not scanned — say so instead of guessing. */
export const TRACKING_LIMITS = [
  'Only the native coin balance is read; ERC-20 / SPL / BRC-20 token balances are not scanned.',
  'Balances are spot reads — no transaction history, cost basis or P&L is derived from a watched address.',
  'Public endpoints may rate-limit or refuse browser access; failures are shown as errors, never as a zero balance.'
];
