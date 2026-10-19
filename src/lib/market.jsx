import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { COINS, binanceMap, FALLBACK_SPARK } from './coins.js';
import { mulberry32 } from './indicators.js';
import { reportError } from './telemetry.js';

/* ------------------------------------------------------------------ *
 *  Live market data layer with explicit data provenance.
 *
 *  - CoinGecko REST (markets + global) refreshes every 60s.
 *  - Binance WebSocket (!ticker@arr) overlays true real-time prices.
 *  - Every payload is tagged with its source so the UI can never present
 *    synthetic data as real: 'coingecko' | 'binance' | 'simulated'.
 *  - Synthetic candles are generated ONLY when both live hosts fail, are
 *    cached with source='simulated', and are refused by the strategy
 *    engine and paper trader.
 *  - Reconnects use exponential backoff with jitter and a slow retry
 *    rather than giving up permanently.
 *  - The realtime socket and the 1s tick pause while the tab is hidden.
 * ------------------------------------------------------------------ */

// 250 is CoinGecko's ceiling for a single /coins/markets request, and one
// request is what this feed can afford: the payload carries a 7-day sparkline
// per row. The old value of 150 was an arbitrary cut of a response we were
// already paying for, so the table simply stopped 100 coins early for no gain.
//
// Anything past 250 needs paging. That is deliberately not done here: an
// endless table is the wrong answer to "I cannot find my coin", so the next
// step for those is search, not more rows.
const CG_PER_PAGE = 250;
const CG_MARKETS = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${CG_PER_PAGE}&page=1&sparkline=true&price_change_percentage=24h%2C7d`;
const CG_GLOBAL = 'https://api.coingecko.com/api/v3/global';

// Binance pair book for coins we want true real-time quotes.
const SYM_INFO = {};
for (const c of COINS) {
  if (c.binance && c.binance !== 'USDTUSDT') {
    const div = c.binance.startsWith('1000') ? 1000 : 1;
    SYM_INFO[c.sym] = { pair: c.binance, div, name: c.name, id: c.id };
  }
}

const WS_URLS = ['wss://stream.binance.com:9443/ws/!ticker@arr', 'wss://data-stream.binance.vision/ws/!ticker@arr'];
const STALE_AFTER_MS = 20000;

const MarketContext = createContext(null);
export const useMarket = () => useContext(MarketContext);

function downsample(arr, n) {
  if (!arr || !arr.length) return [];
  if (arr.length <= n) return arr;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor((i * arr.length) / n)]);
  return out;
}

function normalizeRow(c) {
  return {
    id: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    image: c.image,
    source: 'coingecko',
    rank: c.market_cap_rank || 0,
    price: c.current_price ?? 0,
    pct24: c.price_change_percentage_24h_in_currency ?? 0,
    pct7: c.price_change_percentage_7d_in_currency ?? 0,
    mcap: c.market_cap ?? 0,
    vol: c.total_volume ?? 0,
    spark: downsample(c.sparkline_in_7d?.price, 36),
    _p0: c.current_price ?? 1,
    _m0: c.market_cap ?? 1
  };
}

const fallbackRows = () =>
  COINS.map((c, i) => {
    const base = c.base;
    return {
      id: c.id, symbol: c.sym, name: c.name,
      image: `https://assets.coingecko.com/coins/images/${cgNum(c.id)}/small/${c.id}.png`,
      source: 'simulated',
      rank: i + 1, price: base, pct24: (Math.sin(i * 3.7) * 5 + Math.sin(i) * 2).toFixed(2) * 1,
      pct7: (Math.sin(i * 2.1) * 9).toFixed(2) * 1, mcap: base * (1e7 + i * 1.2e6), vol: base * 4e6,
      spark: FALLBACK_SPARK.map((v) => base * v * (1 + (i % 7) * 0.01)),
      _p0: base, _m0: base * 1e7, demo: true
    };
  });

const cgNum = (id) =>
  ({ bitcoin: 1, ethereum: 279, tether: 325, binancecoin: 825, solana: 4128, ripple: 44, 'usd-coin': 6319, cardano: 975, dogecoin: 5, litecoin: 2, polkadot: 12171, 'avalanche-2': 12559, chainlink: 8775, 'matic-network': 4713, uniswap: 12504, near: 10365, sui: 20947, aptos: 26415, pepe: 29850, 'render-token': 11636, 'internet-computer': 14495, arbitrum: 28176, optimism: 12532, cosmos: 3794, stellar: 512, 'the-open-network': 11419, filecoin: 12817, 'injective-protocol': 11829, 'trons-usd': 1958, monero: 328 }[id] || 1);

async function fetchJson(url, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export function MarketProvider({ children }) {
  const [rows, setRows] = useState(null); // null = loading
  const [global, setGlobal] = useState({ mcap: 0, vol: 0, btcDom: 0 });
  const [conn, setConn] = useState({ ws: 'connecting', cg: 'connecting', stale: false, lastTickAt: null });
  const [clock, setClock] = useState(Date.now());
  const [reloadKey, setReloadKey] = useState(0);

  const rowsRef = useRef(null);
  const tickersRef = useRef({}); // symbol -> {price, pct, vol, hi, lo}
  const globalRef = useRef({ mcap: 0, vol: 0, btcDom: 0 });
  const demoRef = useRef(false);
  const wsRef = useRef(null);
  const wsTriesRef = useRef(0);
  const lastTickAtRef = useRef(null);
  const klineCache = useRef({});


  /* -------- CoinGecko baseline (60s) -------- */
  useEffect(() => {
    let alive = true;
    const loadCG = async () => {
      try {
        const [m, g] = await Promise.all([fetchJson(CG_MARKETS), fetchJson(CG_GLOBAL)]);
        if (!alive) return;
        demoRef.current = false;
        const normalized = (Array.isArray(m) ? m : []).map(normalizeRow);
        if (normalized.length) {
          const t = tickersRef.current;
          rowsRef.current = normalized.map((r) => {
            const lv = t[r.symbol];
            if (lv) {
              const ratio = lv.price / (r._p0 || 1);
              return { ...r, price: lv.price, pct24: lv.pct ?? r.pct24, mcap: (r._m0 || 1) * ratio, vol: lv.vol ?? r.vol };
            }
            return r;
          });
          setRows([...rowsRef.current]);
        }
        const gd = g?.data;
        if (gd) {
          globalRef.current = { mcap: gd.total_market_cap?.usd || 0, vol: gd.total_volume?.usd || 0, btcDom: gd.market_cap_percentage?.btc || 0 };
          setGlobal({ ...globalRef.current });
        }
        setConn((c) => ({ ...c, cg: 'live' }));
      } catch (err) {
        if (!alive) return;
        if (!rowsRef.current) {
          demoRef.current = true;
          rowsRef.current = fallbackRows();
          setRows([...rowsRef.current]);
          setGlobal({ mcap: 2.2e12, vol: 7.8e10, btcDom: 52.4 });
          globalRef.current = { mcap: 2.2e12, vol: 7.8e10, btcDom: 52.4 };
          reportError(err, { kind: 'feed.coingecko.fallback', note: 'serving simulated snapshot' });
        }
        setConn((c) => ({ ...c, cg: 'offline' }));
      }
    };
    loadCG();
    const iv = window.setInterval(loadCG, 60000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [reloadKey]);

  /* -------- Binance WebSocket live stream (pauses while hidden) -------- */
  useEffect(() => {
    let alive = true;
    let retryTimer = null;
    let slowTimer = null;

    const connect = () => {
      if (!alive) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      const url = WS_URLS[wsTriesRef.current % WS_URLS.length];
      setConn((c) => ({ ...c, ws: 'connecting' }));
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reportError(err, { kind: 'feed.ws.construct' });
        scheduleRetry();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        wsTriesRef.current = 0;
        if (alive) setConn((c) => ({ ...c, ws: 'live' }));
      };

      ws.onmessage = (ev) => {
        try {
          const list = JSON.parse(ev.data);
          if (!Array.isArray(list)) return;
          const t = tickersRef.current;
          let changed = false;
          for (const s of list) {
            if (s?.e !== '24hrTicker' && !s?.s) continue;
            const info = SYM_INFO[s.s];
            if (!info) continue;
            const price = parseFloat(s.c) / info.div;
            if (!price) continue;
            t[info.sym] = {
              price,
              pct: parseFloat(s.P) || 0,
              vol: parseFloat(s.q) || 0,
              hi: parseFloat(s.h) / info.div,
              lo: parseFloat(s.l) / info.div
            };
            changed = true;
          }
          if (changed) {
            lastTickAtRef.current = Date.now();
            setConn((c) => (Date.now() - (c.lastTickAt || 0) > 4000 ? { ...c, lastTickAt: Date.now() } : c));
          }
        } catch { /* partial frame — ignore */ }
      };

      ws.onerror = () => { /* handled by onclose */ };
      ws.onclose = () => {
        if (!alive) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        wsTriesRef.current += 1;
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (!alive) return;
      window.clearTimeout(retryTimer);
      if (wsTriesRef.current > 6) {
        setConn((c) => ({ ...c, ws: 'offline' }));
        // slow retry: keep trying every 60s instead of giving up for good
        window.clearTimeout(slowTimer);
        slowTimer = window.setTimeout(() => {
          wsTriesRef.current = 1;
          connect();
        }, 60000);
        return;
      }
      const base = Math.min(2000 * wsTriesRef.current, 20000);
      const jitter = Math.random() * 0.3 * base;
      retryTimer = window.setTimeout(connect, base + jitter);
    };

    const onVisibility = () => {
      if (document.hidden) {
        try { wsRef.current?.close(); } catch { /* noop */ }
      } else {
        wsTriesRef.current = 0;
        connect();
      }
    };

    connect();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      window.clearTimeout(retryTimer);
      window.clearTimeout(slowTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
  }, []);

  /* -------- 1s merge tick: live ticks + staleness (paused when hidden) -------- */
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const base = rowsRef.current;
      if (!base) return;
      const t = tickersRef.current;
      const now = Date.now();
      const g = globalRef.current;
      // Only rows with a live exchange tick are rebuilt; everything else is
      // returned by reference, so its last provider values stay untouched.
      //
      // There used to be a sine-wave "wobble" here that nudged every other row
      // by a fraction of a percent so the table looked alive. It was invented
      // movement drawn exactly like a real tick, which is the one thing a price
      // feed must never do: a stale number that admits it is stale is worth
      // more than a moving number that is made up.
      // Headline totals move only when the provider refreshes them, every 60s.
      // They were wobbled for the same cosmetic reason and are not any more.
      const next = base.map((r) => {
        const lv = t[r.symbol];
        if (!lv) return r;
        const ratio = lv.price / (r._p0 || 1);
        return { ...r, price: lv.price, pct24: lv.pct ?? r.pct24, vol: lv.vol || r.vol,
          mcap: r._m0 ? r._m0 * ratio : r.mcap, live: 1 };
      });
      rowsRef.current = next;
      setRows(next);
      const { mcap, vol, btcDom: dom } = g;
      globalRef.current = { mcap, vol, btcDom: dom };
      setGlobal({ mcap, vol, btcDom: dom });
      setConn((c) => {
        const stale = c.ws === 'live' && lastTickAtRef.current != null && now - lastTickAtRef.current > STALE_AFTER_MS;
        return stale === c.stale ? c : { ...c, stale };
      });
      setClock(now);
    }, 1000);
    return () => window.clearInterval(iv);
  }, []);

  /* -------- derived helpers -------- */
  const bySymbol = useMemo(() => {
    const map = {};
    (rows || []).forEach((r) => { map[r.symbol] = r; });
    return map;
  }, [rows]);

  const byId = useMemo(() => {
    const map = {};
    (rows || []).forEach((r) => { map[r.id] = r; });
    return map;
  }, [rows]);

  const binanceInfo = useMemo(() => {
    const map = {};
    for (const [sym, info] of Object.entries(SYM_INFO)) map[sym] = info;
    return map;
  }, []);

  /* Data provenance summary used by the topbar chip, charts and the status page. */
  const feed = useMemo(() => {
    const marketSimulated = rows != null && rows.length > 0 && (rows[0]?.source === 'simulated');
    return {
      marketSource: marketSimulated ? 'simulated' : 'coingecko',
      realtime: conn.ws,           // connecting | live | offline
      stale: !!conn.stale,
      simulated: marketSimulated,
      lastTickAt: conn.lastTickAt,
      level: marketSimulated ? 'simulated' : conn.ws === 'live' && !conn.stale ? 'live' : conn.ws === 'offline' || conn.stale ? 'degraded' : 'connecting'
    };
  }, [rows, conn]);

  /* Returns { candles, source, fetchedAt } — callers MUST check `source`. */
  async function getKlines(symbol, interval = '1h', limit = 260) {
    const info = SYM_INFO[symbol] || binanceMap[symbol];
    const pair = info?.pair;
    const div = info?.div || 1;
    const key = `${symbol}:${interval}`;
    const cached = klineCache.current[key];
    if (cached && Date.now() - cached.at < 45000) {
      return { candles: cached.data, source: cached.source, fetchedAt: cached.at };
    }

    if (pair) {
      const hosts = ['https://api.binance.com', 'https://data-api.binance.vision'];
      for (const host of hosts) {
        try {
          const raw = await fetchJson(`${host}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`, 9000);
          if (Array.isArray(raw) && raw.length) {
            const data = raw.map((k) => ({
              t: k[0],
              o: parseFloat(k[1]) / div, h: parseFloat(k[2]) / div,
              l: parseFloat(k[3]) / div, c: parseFloat(k[4]) / div,
              v: parseFloat(k[5])
            }));
            klineCache.current[key] = { data, at: Date.now(), source: 'binance' };
            return { candles: data, source: 'binance', fetchedAt: Date.now() };
          }
        } catch { /* try next host */ }
      }
    }

    // No live source available: deterministic synthetic candles, clearly tagged.
    const row = bySymbol[symbol];
    const base = row?.price || (binanceMap[symbol] ? binanceMap[symbol].base : 1);
    const seed = (symbol + interval).split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
    const rnd = mulberry32(seed);
    const vol = interval === '5m' ? 0.0022 : interval === '15m' ? 0.0038 : interval === '1h' ? 0.007 : interval === '4h' ? 0.014 : 0.03;
    const closes = new Array(limit);
    closes[limit - 1] = base;
    for (let i = limit - 2; i >= 0; i--) {
      closes[i] = closes[i + 1] * (1 + (rnd() - 0.5) * 2 * vol);
    }
    const data = closes.map((c, i) => {
      const o = i === 0 ? c : closes[i - 1] * (1 + (rnd() - 0.5) * vol * 0.4);
      const h = Math.max(o, c) * (1 + rnd() * vol * 0.5);
      const l = Math.min(o, c) * (1 - rnd() * vol * 0.5);
      const v = (1 + rnd() * 4) * base * 5e4;
      return { t: Date.now() - (limit - 1 - i) * 3600e3, o, h, l, c, v };
    });
    klineCache.current[key] = { data, at: Date.now(), source: 'simulated' };
    return { candles: data, source: 'simulated', fetchedAt: Date.now() };
  }

  const refresh = () => {
    klineCache.current = {};
    setReloadKey((k) => k + 1);
  };

  const value = {
    rows: rows || [],
    bySymbol,
    byId,
    global,
    conn,
    feed,
    demo: feed.simulated,
    clock,
    tickers: tickersRef.current,
    binanceInfo,
    getKlines,
    refresh,
    lastWsAt: conn.lastTickAt
  };
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

/* Fear & Greed index with graceful fallback (fallback is flagged). */
export async function fetchFearGreed() {
  try {
    const j = await fetchJson('https://api.alternative.me/fng/?limit=30', 7000);
    if (j?.data?.length) {
      return { series: j.data.map((d) => ({
        value: parseInt(d.value, 10),
        label: d.value_classification,
        t: parseInt(d.timestamp, 10) * 1000
      })), source: 'live' };
    }
  } catch { /* fallback below */ }
  const seed = Math.floor(Date.now() / 3600e3);
  const r = mulberry32(seed);
  const v = 25 + Math.floor(r() * 55);
  const now = Date.now();
  return {
    source: 'simulated',
    series: Array.from({ length: 30 }, (_, i) => ({
      value: Math.max(1, Math.min(99, v + Math.round((r() - 0.5) * 18))),
      label: v > 75 ? 'Extreme Greed' : v > 55 ? 'Greed' : v > 45 ? 'Neutral' : v > 25 ? 'Fear' : 'Extreme Fear',
      t: now - i * 86400e3
    }))
  };
}
