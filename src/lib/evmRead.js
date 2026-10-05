/* Read-only EVM chain access: gas estimation, dry-run simulation, allowance and
 * token metadata reads.
 *
 * Strictly read-only. Every method here is an `eth_*` view call — nothing is
 * signed, nothing is broadcast, and no key is involved. A simulation is a real
 * execution of the call against current chain state with no state change kept.
 *
 * Endpoints come from wallets.js, including its fallback lists, so a single
 * dead public RPC does not disable the chain.
 */

import { EVM_RPC } from './wallets.js';
import { selector, hexToBytes, bytesToHex } from './keccak.js';

export const SIG = {
  allowance: selector('allowance(address,address)'),
  balanceOf: selector('balanceOf(address)'),
  decimals: selector('decimals()'),
  symbol: selector('symbol()'),
  name: selector('name()')
};

const pad32 = (hex) => String(hex).replace(/^0x/, '').toLowerCase().padStart(64, '0');
export const encodeAddress = (addr) => pad32(addr);
export const encodeUint = (v) => BigInt(v).toString(16).padStart(64, '0');

/** Decode a single uint256 return value. */
export function decodeUint(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 3) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

/** Decode an ABI-encoded dynamic string (symbol/name). */
export function decodeAbiString(hex) {
  if (typeof hex !== 'string') return null;
  const body = hex.replace(/^0x/, '');
  if (body.length < 128) return null;
  try {
    const len = Number(BigInt(`0x${body.slice(64, 128)}`));
    if (!Number.isFinite(len) || len <= 0 || len > 128) return null;
    const data = body.slice(128, 128 + len * 2);
    const bytes = hexToBytes(data);
    if (!bytes) return null;
    return new TextDecoder().decode(bytes).replace(/\0+$/, '');
  } catch {
    return null;
  }
}

/** Decode a standard Error(string) revert payload. */
export function decodeRevertReason(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('0x08c379a0')) return null;
  return decodeAbiString(`0x${hex.slice(10)}`);
}

/* ---------------- transport ---------------- */

/**
 * Make one JSON-RPC call with endpoint fallback.
 * @returns {{ok:boolean, result?:any, error?:string, rpcUsed?:string}}
 */
export async function rpcRequest(chain, method, params = [], { timeoutMs = 12000 } = {}) {
  const cfg = EVM_RPC[chain];
  if (!cfg) return { ok: false, error: `Unsupported chain "${chain}"` };
  const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  let lastError = 'No endpoint available';

  for (const rpc of cfg.rpcs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        signal: ctrl.signal
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${rpc}`;
        continue;
      }
      const json = await res.json();
      if (json?.error) {
        const e = json.error;
        // A revert is a REAL result about the call, so surface it immediately.
        // Anything else (dead endpoint, rate limit, internal error) should fall
        // through to the next endpoint.
        const isRevert = Boolean(e.data) || /revert/i.test(e.message || '');
        if (isRevert) {
          return { ok: false, error: e.message || 'Execution reverted', rpcUsed: rpc, revertData: e.data || null };
        }
        lastError = e.message || 'RPC error';
        continue;
      }
      return { ok: true, result: json?.result ?? null, rpcUsed: rpc };
    } catch (err) {
      lastError = err?.name === 'AbortError'
        ? 'Request timed out'
        : /Failed to fetch|NetworkError|Load failed/i.test(String(err?.message))
          ? 'Endpoint refused browser access (CORS)'
          : err?.message || 'Request failed';
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError };
}

/* ---------------- higher-level reads ---------------- */

/** eth_getCode → is this a contract or a wallet? */
export async function probeCode(chain, address) {
  const r = await rpcRequest(chain, 'eth_getCode', [address, 'latest']);
  if (!r.ok) return { ok: false, error: r.error };
  const code = r.result || '0x';
  const isContract = code !== '0x' && code.length > 2;
  return { ok: true, isContract, codeSize: Math.max(0, (code.length - 2) / 2) };
}

/** Live EIP-1559 fee suggestion, with a legacy fallback. */
export async function suggestFees(chain) {
  const hist = await rpcRequest(chain, 'eth_feeHistory', ['0x5', 'latest', [10, 50, 90]]);
  if (hist.ok && hist.result) {
    const blocks = hist.result.baseFeePerGas || [];
    const rewards = hist.result.reward || [];
    const baseFee = blocks.length ? BigInt(blocks[blocks.length - 1]) : null;
    const tips = rewards.map((r) => BigInt(r[1] ?? r[0] ?? 0)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const medianTip = tips.length ? tips[Math.floor(tips.length / 2)] : 0n;
    const priority = medianTip > 0n ? medianTip : 1_000_000_000n; // 1 gwei floor
    return {
      ok: true,
      eip1559: true,
      baseFeePerGas: baseFee,
      maxPriorityFeePerGas: priority,
      maxFeePerGas: baseFee != null ? baseFee * 2n + priority : null,
      sampledBlocks: blocks.length,
      rpcUsed: hist.rpcUsed
    };
  }

  const legacy = await rpcRequest(chain, 'eth_gasPrice', []);
  if (!legacy.ok) return { ok: false, error: legacy.error || hist.error };
  return { ok: true, eip1559: false, gasPrice: decodeUint(legacy.result), rpcUsed: legacy.rpcUsed, note: hist.error };
}

/**
 * Dry-run a call. This executes against current state and keeps nothing.
 * A revert is reported with its decoded reason when the node supplies one.
 */
export async function simulateCall(chain, { from, to, data = '0x', value = null }) {
  if (!to) return { ok: false, error: 'A target address is required' };
  const tx = { to };
  if (from) tx.from = from;
  if (data && data !== '0x') tx.data = data;
  if (value) tx.value = typeof value === 'bigint' ? `0x${value.toString(16)}` : value;

  const res = await rpcRequest(chain, 'eth_call', [tx, 'latest']);
  if (res.ok) {
    return { ok: true, success: true, result: res.result, rpcUsed: res.rpcUsed };
  }
  const reason = decodeRevertReason(res.revertData);
  return {
    ok: true,
    success: false,
    reason: reason || res.error || 'Execution reverted',
    rawError: res.error,
    rpcUsed: res.rpcUsed
  };
}

export async function estimateGas(chain, { from, to, data = '0x', value = null }) {
  if (!from || !to) return { ok: false, error: 'Both a sender and a target are required to estimate gas' };
  const tx = { from, to };
  if (data && data !== '0x') tx.data = data;
  if (value) tx.value = typeof value === 'bigint' ? `0x${value.toString(16)}` : value;
  const res = await rpcRequest(chain, 'eth_estimateGas', [tx, 'latest']);
  if (!res.ok) return { ok: false, error: res.error };
  const gas = decodeUint(res.result);
  return { ok: true, gas, rpcUsed: res.rpcUsed };
}

export async function getNonce(chain, address) {
  const r = await rpcRequest(chain, 'eth_getTransactionCount', [address, 'latest']);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, nonce: decodeUint(r.result) };
}

/** ERC-20 allowance, as a bigint. */
export async function readAllowance(chain, token, owner, spender) {
  const data = `${SIG.allowance}${encodeAddress(owner)}${encodeAddress(spender)}`;
  const r = await rpcRequest(chain, 'eth_call', [{ to: token, data }, 'latest']);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, allowance: decodeUint(r.result) };
}

/** ERC-20 balanceOf (also works for ERC-721, which returns a token count). */
export async function readBalanceOf(chain, token, owner) {
  const data = `${SIG.balanceOf}${encodeAddress(owner)}`;
  const r = await rpcRequest(chain, 'eth_call', [{ to: token, data }, 'latest']);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, balance: decodeUint(r.result) };
}

/** Token metadata. Confirms the address actually implements an ERC-20. */
export async function readTokenMeta(chain, token) {
  const [dec, sym, nm] = await Promise.all([
    rpcRequest(chain, 'eth_call', [{ to: token, data: SIG.decimals }, 'latest']),
    rpcRequest(chain, 'eth_call', [{ to: token, data: SIG.symbol }, 'latest']),
    rpcRequest(chain, 'eth_call', [{ to: token, data: SIG.name }, 'latest'])
  ]);
  if (!dec.ok && !sym.ok) {
    return { ok: false, error: dec.error || sym.error || 'Not an ERC-20 contract' };
  }
  const decimals = dec.ok ? decodeUint(dec.result) : null;
  return {
    ok: true,
    decimals: decimals == null ? null : Number(decimals),
    symbol: sym.ok ? decodeAbiString(sym.result) : null,
    name: nm.ok ? decodeAbiString(nm.result) : null
  };
}

/** Best-effort address summary for the safety panel. */
export async function inspectAddress(chain, address) {
  const code = await probeCode(chain, address);
  if (!code.ok) return { ok: false, error: code.error, isContract: null };
  return { ok: true, isContract: code.isContract, codeSize: code.codeSize };
}

export const bytesToHexLocal = bytesToHex;
