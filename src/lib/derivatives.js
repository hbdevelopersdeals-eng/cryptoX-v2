import { useEffect, useRef, useState } from 'react';
import { backoffDelay } from './realtime.js';
import { reportError } from './telemetry.js';

/* Derivatives data: funding rate, mark/index price, open interest and
 * liquidation events — all from Binance USDⓈ-M public futures endpoints.
 * Parsers are pure so they can be unit tested. */

const FAPI = 'https://fapi.binance.com';
export const LIQUIDATION_STREAM_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr';

export const FUNDING_POLL_MS = 60000;
export const OI_POLL_MS = 30000;

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function parsePremiumIndex(json) {
  if (!json || typeof json !== 'object') return null;
  const markPrice = num(json.markPrice);
  if (markPrice == null) return null;
  return {
    symbol: json.symbol || null,
    markPrice,
    indexPrice: num(json.indexPrice),
    fundingRate: num(json.lastFundingRate),
    nextFundingTime: num(json.nextFundingTime),
    at: Date.now()
  };
}

export function parseOpenInterest(json) {
  if (!json || typeof json !== 'object') return null;
  const openInterest = num(json.openInterest);
  if (openInterest == null) return null;
  return { symbol: json.symbol || null, openInterest, at: Date.now() };
}

/** Liquidation order event -> normalized shape. */
export function parseLiquidation(payload) {
  const o = payload?.o || payload?.data?.o || null;
  if (!o) return null;
  const price = num(o.ap) ?? num(o.p);
  const qty = num(o.q);
  if (price == null || qty == null) return null;
  return {
    symbol: o.s || null,
    side: o.S === 'SELL' ? 'long_liquidation' : 'short_liquidation',
    price,
    qty,
    notional: price * qty,
    at: num(o.T) || Date.now()
  };
}

async function getJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const fetchFunding = async (symbol = 'BTCUSDT') => parsePremiumIndex(await getJson(`${FAPI}/fapi/v1/premiumIndex?symbol=${symbol}`));
export const fetchOpenInterest = async (symbol = 'BTCUSDT') => parseOpenInterest(await getJson(`${FAPI}/fapi/v1/openInterest?symbol=${symbol}`));

/** Poll funding + open interest for one symbol. */
export function useDerivatives({ symbol = 'BTCUSDT', enabled = true } = {}) {
  const [state, setState] = useState({ funding: null, openInterest: null, error: null, lastAt: null, polls: 0 });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const [funding, oi] = await Promise.all([fetchFunding(symbol), fetchOpenInterest(symbol)]);
        if (!alive) return;
        setState((s) => ({ funding: funding || s.funding, openInterest: oi || s.openInterest, error: null, lastAt: Date.now(), polls: s.polls + 1 }));
      } catch (err) {
        reportError(err, { kind: 'derivatives.poll', symbol });
        if (alive) setState((s) => ({ ...s, error: err?.message || 'request failed' }));
      }
    };
    tick();
    const iv = window.setInterval(tick, Math.min(FUNDING_POLL_MS, OI_POLL_MS));
    return () => { alive = false; window.clearInterval(iv); };
  }, [symbol, enabled]);
  return state;
}

/** Stream liquidation orders (futures !forceOrder@arr) with reconnect. */
export function useLiquidations({ enabled = true, limit = 40 } = {}) {
  const [state, setState] = useState({ status: 'idle', events: [], received: 0, reconnects: 0, error: null, lastAt: null });
  const eventsRef = useRef([]);
  useEffect(() => {
    if (!enabled || typeof WebSocket === 'undefined') return undefined;
    let alive = true;
    let attempt = 0;
    let socket = null;
    let timer = null;

    const connect = () => {
      if (!alive) return;
      setState((s) => ({ ...s, status: attempt ? 'reconnecting' : 'connecting' }));
      socket = new WebSocket(LIQUIDATION_STREAM_URL);
      socket.onopen = () => { attempt = 0; setState((s) => ({ ...s, status: 'live' })); };
      socket.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data);
          const normalized = parseLiquidation(parsed);
          if (!normalized) return;
          eventsRef.current = [normalized, ...eventsRef.current].slice(0, limit);
          setState((s) => ({
            ...s,
            events: eventsRef.current,
            received: s.received + 1,
            lastAt: normalized.at
          }));
        } catch (err) {
          reportError(err, { kind: 'derivatives.liquidationParse' });
        }
      };
      socket.onerror = () => setState((s) => ({ ...s, error: 'socket error' }));
      socket.onclose = () => {
        if (!alive) return;
        attempt += 1;
        setState((s) => ({ ...s, status: 'reconnecting', reconnects: s.reconnects + 1 }));
        timer = setTimeout(connect, backoffDelay(attempt));
      };
    };
    connect();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      try { socket?.close(); } catch { /* noop */ }
    };
  }, [enabled, limit]);
  return state;
}
