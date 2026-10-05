/* Public market-data venue adapters.
 *
 * Every adapter returns the SAME normalized shape, so downstream code never
 * deals with venue-specific fields again:
 *   { venue, assetId, nativeSymbol, price, changePct, volumeQuote, ts }
 *
 * Only public endpoints are used (no API keys). If a venue blocks browser
 * access, its result is reported as an error and the venue is marked down —
 * we never fabricate a price to fill the gap.
 */

import { ASSETS, VENUES, VENUE_IDS, assetById, assetBySymbol, venueSymbolFor } from './assets.js';

const DEFAULT_TIMEOUT = 9000;

async function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT) {
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

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function quote(venue, assetId, nativeSymbol, price, changePct, volumeQuote, ts = Date.now(), extra = {}) {
  const p = num(price);
  if (!p || p <= 0) return null;
  const asset = assetById(assetId);
  return {
    venue,
    assetId,
    symbol: asset?.symbol || null,
    nativeSymbol,
    price: p,
    changePct: num(changePct),
    volumeQuote: num(volumeQuote),
    ts,
    ...extra
  };
}

/* ---------------- Kraken symbol normalisation ---------------- */

const KRAKEN_ALIAS = { XBT: 'BTC' };

/** 'XXBTZUSD' / 'SOLUSD' -> 'BTCUSD' / 'SOLUSD' */
export function krakenKeyToPair(key) {
  const k = String(key || '').toUpperCase();
  let base = null;
  let quote = null;
  const withSeparator = k.match(/^X([A-Z0-9]{2,4})Z([A-Z]{3})$/);
  if (withSeparator) {
    base = withSeparator[1];
    quote = withSeparator[2];
  } else {
    const plain = k.match(/^([A-Z0-9]{2,5})(USD|USDT|USDC|EUR)$/);
    if (plain) {
      base = plain[1];
      quote = plain[2];
    }
  }
  if (!base) return null;
  base = KRAKEN_ALIAS[base] || base;
  return `${base}${quote}`;
}

/** Stored venue symbol ('XBT/USD') -> same pair key ('BTCUSD') for comparison. */
export function krakenSymbolToPair(symbol) {
  const [base, quote] = String(symbol || '').toUpperCase().split('/');
  if (!base || !quote) return null;
  return `${KRAKEN_ALIAS[base] || base}${quote}`;
}

/* ---------------- adapters ---------------- */

const ADAPTERS = {
  async binance() {
    const symbols = ASSETS.map((a) => a.venues.binance).filter(Boolean);
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data)) throw new Error('unexpected payload');
    const map = new Map(ASSETS.filter((a) => a.venues.binance).map((a) => [a.venues.binance, a.id]));
    return data
      .map((d) => quote('binance', map.get(d.symbol), d.symbol, d.lastPrice, d.priceChangePercent, d.quoteVolume))
      .filter(Boolean);
  },

  async coinbase() {
    // Single call: USD exchange rates for many assets at once.
    const data = await fetchJson('https://api.coinbase.com/v2/exchange-rates?currency=USD');
    const rates = data?.data?.rates || {};
    return ASSETS.map((a) => {
      const native = a.venues.coinbase;
      const sym = native?.split('-')[0];
      const rate = num(rates[sym]);
      if (!rate) return null;
      return quote('coinbase', a.id, native, 1 / rate, null, null);
    }).filter(Boolean);
  },

  async kraken() {
    const pairs = ASSETS.map((a) => a.venues.kraken?.replace('/', '')).filter(Boolean);
    const data = await fetchJson(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`);
    const result = data?.result || {};
    const lookup = new Map();
    ASSETS.forEach((a) => {
      const key = krakenSymbolToPair(a.venues.kraken);
      if (key) lookup.set(key, a.id);
    });
    return Object.entries(result)
      .map(([key, row]) => {
        const assetId = lookup.get(krakenKeyToPair(key));
        if (!assetId) return null;
        const last = num(row?.c?.[0]);
        const open = num(row?.o);
        const change = last != null && open ? ((last - open) / open) * 100 : null;
        const volBase = num(row?.v?.[1]);
        return quote('kraken', assetId, key, last, change, volBase && last ? volBase * last : null);
      })
      .filter(Boolean);
  },

  async okx() {
    const data = await fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
    const rows = data?.data || [];
    const map = new Map(ASSETS.filter((a) => a.venues.okx).map((a) => [a.venues.okx, a.id]));
    return rows
      .filter((r) => map.has(r.instId))
      .map((r) => {
        const last = num(r.last);
        const open = num(r.open24h);
        const change = last != null && open ? ((last - open) / open) * 100 : null;
        return quote('okx', map.get(r.instId), r.instId, last, change, r.volCcy24h, num(r.ts) || Date.now());
      })
      .filter(Boolean);
  },

  async bybit() {
    const data = await fetchJson('https://api.bybit.com/v5/market/tickers?category=spot');
    const rows = data?.result?.list || [];
    const map = new Map(ASSETS.filter((a) => a.venues.bybit).map((a) => [a.venues.bybit, a.id]));
    return rows
      .filter((r) => map.has(r.symbol))
      .map((r) => {
        const last = num(r.lastPrice);
        const prev = num(r.prevPrice24h);
        const change = last != null && prev ? ((last - prev) / prev) * 100 : null;
        return quote('bybit', map.get(r.symbol), r.symbol, last, change, r.turnover24h);
      })
      .filter(Boolean);
  },

  async kucoin() {
    const data = await fetchJson('https://api.kucoin.com/api/v1/market/allTickers');
    const rows = data?.data?.ticker || [];
    const map = new Map(ASSETS.filter((a) => a.venues.kucoin).map((a) => [a.venues.kucoin, a.id]));
    return rows
      .filter((r) => map.has(r.symbol))
      .map((r) => {
        const change = num(r.changeRate);
        return quote('kucoin', map.get(r.symbol), r.symbol, r.last, change == null ? null : change * 100, r.volValue, num(r.time));
      })
      .filter(Boolean);
  },

  async bitget() {
    const data = await fetchJson('https://api.bitget.com/api/v2/spot/market/tickers');
    const rows = data?.data || [];
    return mapBySymbol(rows, 'bitget', (r) => venueSymbolFor(assetBySymbol(r.symbol?.replace('USDT', '')), 'bitget') === r.symbol)
      .map((r) => {
        const asset = assetBySymbol(r.symbol?.replace('USDT', ''));
        const change = num(r.change24h);
        return quote('bitget', asset?.id, r.symbol, r.lastPr, change == null ? null : change * 100, r.quoteVolume, num(r.ts));
      })
      .filter(Boolean);
  },

  async gate() {
    const rows = (await fetchJson('https://api.gateio.ws/api/v4/spot/tickers')) || [];
    return mapBySymbol(rows, 'gate', (r) => r.currency_pair)
      .map((r) => {
        const asset = assetBySymbol(String(r.currency_pair).split('_')[0]);
        return quote('gate', asset?.id, r.currency_pair, r.last, r.change_percentage, r.quote_volume);
      })
      .filter(Boolean);
  },

  async mexc() {
    const rows = (await fetchJson('https://api.mexc.com/api/v3/ticker/24hr')) || [];
    return mapBySymbol(rows, 'mexc', (r) => r.symbol)
      .map((r) => {
        const asset = assetBySymbol(String(r.symbol).replace('USDT', ''));
        return quote('mexc', asset?.id, r.symbol, r.lastPrice, r.priceChangePercent, r.quoteVolume);
      })
      .filter(Boolean);
  },

  async htx() {
    const data = await fetchJson('https://api.huobi.pro/market/tickers');
    const rows = data?.data || [];
    return mapBySymbol(rows, 'htx', (r) => String(r.symbol || '').toUpperCase())
      .map((r) => {
        const asset = assetBySymbol(String(r.symbol).toUpperCase().replace('USDT', ''));
        const last = num(r.close);
        const open = num(r.open);
        const change = last != null && open ? ((last - open) / open) * 100 : null;
        return quote('htx', asset?.id, String(r.symbol).toUpperCase(), last, change, r.amount, num(r.ts));
      })
      .filter(Boolean);
  },

  async cryptocom() {
    const data = await fetchJson('https://api.crypto.com/exchange/v1/public/get-tickers');
    const rows = data?.result?.data || [];
    return mapBySymbol(rows, 'cryptocom', (r) => r.i)
      .map((r) => {
        const asset = assetBySymbol(String(r.i).split('_')[0]);
        const last = num(r.a) ?? num(r.b);
        const change = num(r.c);
        return quote('cryptocom', asset?.id, r.i, last, change == null ? null : (Math.abs(change) < 1 ? change * 100 : change), r.vv);
      })
      .filter(Boolean);
  },

  async gemini() {
    const rows = (await fetchJson('https://api.gemini.com/v1/pricefeed')) || [];
    return mapBySymbol(rows, 'gemini', (r) => r.pair)
      .map((r) => {
        const asset = assetBySymbol(String(r.pair).replace('USD', ''));
        const change = num(r.percentChange24h);
        return quote('gemini', asset?.id, r.pair, r.price, change == null ? null : (Math.abs(change) < 1 ? change * 100 : change));
      })
      .filter(Boolean);
  },

  async bitfinex() {
    const symbols = ASSETS.map((a) => venueSymbolFor(a, 'bitfinex')).filter(Boolean);
    const rows = await fetchJson(`https://api-pub.bitfinex.com/v2/tickers?symbols=${symbols.join(',')}`);
    if (!Array.isArray(rows)) throw new Error('unexpected payload');
    return rows
      .map((row) => {
        const [sym, , , , , , changeRel, last] = row;
        const asset = ASSETS.find((a) => venueSymbolFor(a, 'bitfinex') === sym);
        const change = num(changeRel);
        return quote('bitfinex', asset?.id, sym, last, change == null ? null : change * 100);
      })
      .filter(Boolean);
  },

  async deribit() {
    // Derivative index (not a spot pair) — used as an independent reference source.
    const out = [];
    for (const [assetSymbol, indexName] of [['BTC', 'btc_usd'], ['ETH', 'eth_usd']]) {
      const data = await fetchJson(`https://www.deribit.com/api/v2/public/get_index_price?index_name=${index_name}`);
      const asset = assetBySymbol(assetSymbol);
      const q = quote('deribit', asset?.id, indexName, data?.result?.index_price, null);
      if (q) out.push(q);
    }
    return out;
  },

  async dexscreener() {
    const tokens = ASSETS.filter((a) => a.contract).map((a) => a.contract);
    if (!tokens.length) return [];
    const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${tokens.join(',')}`);
    const pairs = data?.pairs || [];
    const best = new Map();
    pairs.forEach((p) => {
      const addr = p?.baseToken?.address;
      const asset = ASSETS.find((a) => a.contract && a.contract.toLowerCase() === String(addr).toLowerCase());
      if (!asset) return;
      const liquidity = num(p?.liquidity?.usd) || 0;
      const current = best.get(asset.id);
      const change = num(p?.priceChange?.h24);
      if (!current || liquidity > current.liquidity) {
        best.set(asset.id, { liquidity, price: num(p.priceUsd), change, symbol: p?.baseToken?.symbol, dex: p?.dexId });
      }
    });
    return [...best.entries()]
      .map(([assetId, v]) => quote(
        'dexscreener', assetId, v.symbol || assetId, v.price, v.change, null, Date.now(),
        // Real on-chain pool liquidity in USD (DexScreener), kept separate from CEX volume.
        { liquidityUsd: v.liquidity || null, dex: v.dex || null }
      ))
      .filter(Boolean);
  }
};

/** Keep only rows whose symbol matches a tracked asset on that venue. */
function mapBySymbol(rows, venueId, keyFn) {
  return rows.filter((r) => {
    const raw = keyFn(r);
    if (!raw) return false;
    const candidates = venueId === 'htx' ? [raw, String(raw).toUpperCase()] : [raw];
    return candidates.some((sym) => Boolean(matchAsset(venueId, sym)));
  });
}

function matchAsset(venueId, nativeSymbol) {
  for (const asset of ASSETS) {
    const expected = venueSymbolFor(asset, venueId);
    if (!expected) continue;
    if (expected === nativeSymbol) return asset;
    if (String(expected).toUpperCase() === String(nativeSymbol).toUpperCase()) return asset;
  }
  return null;
}

export const SUPPORTED_VENUES = Object.keys(ADAPTERS);

/** Run one venue adapter and capture health metadata. */
export async function fetchVenue(venueId) {
  const venue = VENUES.find((v) => v.id === venueId);
  const started = Date.now();
  const base = { venueId, name: venue?.name || venueId, tier: venue?.tier || 2, kind: venue?.kind || 'cex' };
  if (!ADAPTERS[venueId]) {
    return { ...base, status: 'error', latencyMs: 0, quotes: [], error: 'no adapter', lastAt: Date.now() };
  }
  try {
    const quotes = await ADAPTERS[venueId]();
    const latencyMs = Date.now() - started;
    if (!quotes.length) {
      return { ...base, status: 'degraded', latencyMs, quotes: [], error: 'no matching symbols in response', lastAt: Date.now() };
    }
    return { ...base, status: 'live', latencyMs, quotes, error: null, lastAt: Date.now() };
  } catch (err) {
    return {
      ...base,
      status: 'down',
      latencyMs: Date.now() - started,
      quotes: [],
      error: err?.name === 'AbortError' ? 'timed out' : err?.message || 'request failed',
      lastAt: Date.now()
    };
  }
}

/** Fetch every venue in parallel (allSettled: one failure never blocks others). */
export async function fetchAllVenues(venueIds = VENUE_IDS) {
  const results = await Promise.allSettled(venueIds.map((id) => fetchVenue(id)));
  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { venueId: venueIds[i], name: venueIds[i], tier: 2, kind: 'cex', status: 'down', latencyMs: 0, quotes: [], error: String(r.reason), lastAt: Date.now() }
  );
}
