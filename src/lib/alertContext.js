/* Builds the per-symbol evaluation context the alert engine reads.
 * Pure functions — no I/O, fully unit tested.
 *
 * Two integrity rules matter here:
 *  1. Indicator rules (RSI / MA / MACD / breakout / volume) stay UNTRIGGERED
 *     when candle history is missing. We never invent a value to make an alert
 *     fire.
 *  2. `volume` and `volumeAvg` are ALWAYS taken from the same source (candles).
 *     Mixing a 24h USD volume with a per-bar base-asset volume would compare
 *     different units and produce nonsense spikes.
 */

import { sma, rsi, macd } from './indicators.js';

const RSI_PERIOD = 14;
const VOLUME_LOOKBACK = 20;
const BREAKOUT_DEFAULT = 20;

const clean = (v) => (v == null || Number.isNaN(v) || !Number.isFinite(v) ? null : v);
const last = (arr) => (Array.isArray(arr) && arr.length ? clean(arr[arr.length - 1]) : null);
const back = (arr, n) => (Array.isArray(arr) && arr.length > n ? clean(arr[arr.length - 1 - n]) : null);

/** Rule types that cannot be evaluated from a live ticker alone. */
export const CANDLE_RULES = new Set([
  'rsi_above', 'rsi_below', 'ma_cross', 'macd_cross', 'breakout', 'volume_spike'
]);

export function needsCandles(rules = []) {
  return (rules || []).some((r) => r?.enabled !== false && CANDLE_RULES.has(r?.type));
}

/** Distinct symbols that need candle history, given the active rule set. */
export function symbolsNeedingCandles(rules = []) {
  return [...new Set((rules || [])
    .filter((r) => r?.enabled !== false && CANDLE_RULES.has(r?.type))
    .map((r) => r?.symbol)
    .filter(Boolean))];
}

function series(candles, key) {
  return (candles || []).map((c) => clean(c?.[key])).filter((v) => v != null);
}

/**
 * @param row      live ticker row for the symbol (price / pct24)
 * @param prevRow  previous ticker snapshot, used for crossover detection
 * @param candles  historical candles, or null/[] when unavailable
 * @param rules    the rules configured for THIS symbol
 */
export function buildContext(row, prevRow, candles, rules = []) {
  const ctx = {};

  const price = clean(row?.price);
  if (price != null) ctx.price = price;
  const prevPrice = clean(prevRow?.price);
  if (prevPrice != null) ctx.prevPrice = prevPrice;
  const pct24 = clean(row?.pct24);
  if (pct24 != null) ctx.pct24 = pct24;

  const has = (candles || []).length > 0;

  if (has) {
    const closes = series(candles, 'c');

    /* ---- RSI ---- */
    if (closes.length > RSI_PERIOD + 1) {
      const s = rsi(closes, RSI_PERIOD);
      const v = last(s);
      const p = back(s, 1);
      if (v != null) ctx.rsi = v;
      if (p != null) ctx.prevRsi = p;
    }

    /* ---- MACD ---- */
    if (closes.length > 34) {
      const m = macd(closes, 12, 26, 9);
      const mv = last(m.line); const sv = last(m.signal);
      const pm = back(m.line, 1); const ps = back(m.signal, 1);
      if (mv != null) ctx.macd = mv;
      if (sv != null) ctx.macdSignal = sv;
      if (pm != null) ctx.prevMacd = pm;
      if (ps != null) ctx.prevMacdSignal = ps;
    }

    /* ---- MA cross, using the periods configured on the rule ---- */
    const maRule = (rules || []).find((r) => r?.type === 'ma_cross');
    const fastP = Number(maRule?.periods?.[0]) || 9;
    const slowP = Number(maRule?.periods?.[1]) || 21;
    if (closes.length > slowP + 1) {
      const f = sma(closes, fastP);
      const s = sma(closes, slowP);
      const fv = last(f); const sv2 = last(s);
      const pf = back(f, 1); const ps2 = back(s, 1);
      if (fv != null) ctx.maFast = fv;
      if (sv2 != null) ctx.maSlow = sv2;
      if (pf != null) ctx.prevMaFast = pf;
      if (ps2 != null) ctx.prevMaSlow = ps2;
    }

    /* ---- Breakout range: prior bars only, never the forming bar ---- */
    const brkRule = (rules || []).find((r) => r?.type === 'breakout');
    const period = Number(brkRule?.periods?.[0]) || BREAKOUT_DEFAULT;
    const highs = series(candles, 'h');
    const lows = series(candles, 'l');
    if (highs.length > period && lows.length > period) {
      const hWin = highs.slice(-period - 1, -1);
      const lWin = lows.slice(-period - 1, -1);
      const h = Math.max(...hWin);
      const l = Math.min(...lWin);
      if (Number.isFinite(h)) ctx.high = h;
      if (Number.isFinite(l)) ctx.low = l;
    }

    /* ---- Volume spike: both sides from candles, same units ---- */
    const vols = series(candles, 'v');
    if (vols.length > VOLUME_LOOKBACK) {
      const current = vols[vols.length - 1];
      const hist = vols.slice(-VOLUME_LOOKBACK - 1, -1);
      const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
      if (avg > 0) {
        ctx.volume = current;
        ctx.volumeAvg = avg;
      }
    }
  }

  return ctx;
}

/** Human-readable live readout for one rule, so the UI can show what it sees. */
export function contextReadout(rule, ctx = {}) {
  switch (rule?.type) {
    case 'rsi_above':
    case 'rsi_below':
      return ctx.rsi == null ? 'RSI unavailable' : `RSI ${ctx.rsi.toFixed(1)}`;
    case 'ma_cross':
      return ctx.maFast == null || ctx.maSlow == null
        ? 'MA unavailable'
        : `MA${rule.periods?.[0] ?? 9} ${ctx.maFast.toFixed(2)} / MA${rule.periods?.[1] ?? 21} ${ctx.maSlow.toFixed(2)}`;
    case 'macd_cross':
      return ctx.macd == null ? 'MACD unavailable' : `MACD ${ctx.macd.toFixed(3)} vs ${ctx.macdSignal?.toFixed(3) ?? '—'}`;
    case 'volume_spike':
      return ctx.volume == null || !ctx.volumeAvg
        ? 'Volume baseline building…'
        : `${(ctx.volume / ctx.volumeAvg).toFixed(2)}× average`;
    case 'breakout':
      return ctx.high == null ? 'Range unavailable' : `Range ${ctx.low?.toFixed(2)} – ${ctx.high.toFixed(2)}`;
    case 'pct_change':
      return ctx.pct24 == null ? '—' : `${ctx.pct24.toFixed(2)}% 24h`;
    case 'portfolio_value_above':
    case 'portfolio_value_below':
      return ctx.portfolioValue == null ? 'Portfolio value unavailable' : `Portfolio $${ctx.portfolioValue.toFixed(2)}`;
    default:
      return ctx.price == null ? '—' : `Price ${ctx.price}`;
  }
}
