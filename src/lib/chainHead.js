import { useEffect, useState } from 'react';
import { reportError } from './telemetry.js';

/* Blockchain event streaming — head-of-chain layer.
 * Polls public JSON-RPC nodes for the latest block number and reports latency.
 * Full event indexing (logs, decoded events, reorg handling) needs an indexer
 * such as Ponder/Subsquid/The Graph and is part of the enterprise blueprint. */

export const CHAINS = [
  { id: 'ethereum', name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com' },
  { id: 'bsc', name: 'BNB Chain', rpc: 'https://bsc-rpc.publicnode.com' },
  { id: 'polygon', name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com' }
];

export const HEAD_POLL_MS = 15000;

/** JSON-RPC eth_blockNumber payload -> integer block height. */
export function parseBlockNumber(json) {
  const hex = json?.result;
  if (typeof hex !== 'string') return null;
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : null;
}

export async function fetchBlockNumber(chain, timeoutMs = 8000) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(chain.rpc, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const block = parseBlockNumber(json);
    if (block == null) throw new Error('invalid response');
    return { chainId: chain.id, name: chain.name, block, latencyMs: Date.now() - started, at: Date.now(), error: null };
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'timed out' : err?.message || 'request failed';
    reportError(err, { kind: 'chainHead.poll', chain: chain.id });
    return { chainId: chain.id, name: chain.name, block: null, latencyMs: Date.now() - started, at: Date.now(), error: message };
  } finally {
    clearTimeout(timer);
  }
}

export function useChainHeads({ enabled = true, chains = CHAINS } = {}) {
  const [state, setState] = useState({ heads: [], status: 'idle', lastAt: null, advances: 0 });

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let previous = {};
    const tick = async () => {
      const results = await Promise.all(chains.map((c) => fetchBlockNumber(c)));
      if (!alive) return;
      setState((s) => {
        let advances = s.advances;
        results.forEach((r) => {
          const prev = previous[r.chainId];
          if (r.block != null && prev != null && r.block > prev) advances += r.block - prev;
          if (r.block != null) previous[r.chainId] = r.block;
        });
        return { heads: results, status: results.some((r) => r.block != null) ? 'live' : 'error', lastAt: Date.now(), advances };
      });
    };
    tick();
    const iv = window.setInterval(tick, HEAD_POLL_MS);
    return () => { alive = false; window.clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return state;
}
