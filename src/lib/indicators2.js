/* Additional indicators for the professional charting suite.
 * Pure functions on numeric arrays — unit tested. */

import { sma } from './indicators.js';

export function wma(arr = [], period = 14) {
  const out = new Array(arr.length).fill(null);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < arr.length; i++) {
    let sum = 0;
    for (let k = 0; k < period; k++) sum += arr[i - k] * (period - k);
    out[i] = sum / denom;
  }
  return out;
}

/** Average True Range (Wilder smoothing). */
export function atr(highs = [], lows = [], closes = [], period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;
  const tr = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  out[period] = sum / period;
  for (let i = period + 1; i < n; i++) out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  return out;
}

/** ADX with +DI / -DI. */
export function adx(highs = [], lows = [], closes = [], period = 14) {
  const n = closes.length;
  const result = { adx: new Array(n).fill(null), plusDI: new Array(n).fill(null), minusDI: new Array(n).fill(null) };
  if (n < period * 2 + 1) return result;
  const tr = new Array(n).fill(0);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const smooth = (arr) => {
    const out = new Array(n).fill(null);
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += arr[i];
    out[period] = sum;
    for (let i = period + 1; i < n; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    return out;
  };
  const trS = smooth(tr);
  const pS = smooth(plusDM);
  const mS = smooth(minusDM);
  const dx = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (!trS[i]) continue;
    const pdi = (pS[i] / trS[i]) * 100;
    const mdi = (mS[i] / trS[i]) * 100;
    result.plusDI[i] = pdi;
    result.minusDI[i] = mdi;
    const sum = pdi + mdi;
    dx[i] = sum ? (Math.abs(pdi - mdi) / sum) * 100 : 0;
  }
  const firstDx = dx.findIndex((v) => v != null);
  if (firstDx === -1) return result;
  for (let i = firstDx + period - 1; i < n; i++) {
    if (dx[i] == null) continue;
    const prev = result.adx[i - 1];
    result.adx[i] = prev == null ? dx[i] : (prev * (period - 1) + dx[i]) / period;
  }
  return result;
}

/** On-balance volume. */
export function obv(closes = [], volumes = []) {
  const out = new Array(closes.length).fill(null);
  if (!closes.length) return out;
  let running = 0;
  out[0] = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) running += volumes[i] || 0;
    else if (closes[i] < closes[i - 1]) running -= volumes[i] || 0;
    out[i] = running;
  }
  return out;
}

const mid = (h, l) => (h + l) / 2;
const highest = (arr, i, p) => Math.max(...arr.slice(Math.max(0, i - p + 1), i + 1));
const lowest = (arr, i, p) => Math.min(...arr.slice(Math.max(0, i - p + 1), i + 1));

/** Ichimoku Kinko Hyo. */
export function ichimoku(highs = [], lows = [], closes = [], { tenkan: t = 9, kijun: k = 26, senkou: s = 52 } = {}) {
  const n = closes.length;
  const tenkanLine = new Array(n).fill(null);
  const kijunLine = new Array(n).fill(null);
  const senkouA = new Array(n).fill(null);
  const senkouB = new Array(n).fill(null);
  const chikou = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i >= t - 1) tenkanLine[i] = (highest(highs, i, t) + lowest(lows, i, t)) / 2;
    if (i >= k - 1) kijunLine[i] = (highest(highs, i, k) + lowest(lows, i, k)) / 2;
    if (i >= s - 1) senkouB[i] = (highest(highs, i, s) + lowest(lows, i, s)) / 2;
    if (tenkanLine[i] != null && kijunLine[i] != null) senkouA[i] = (tenkanLine[i] + kijunLine[i]) / 2;
    if (i + k < n) chikou[i] = closes[i];
  }
  return { tenkan: tenkanLine, kijun: kijunLine, senkouA, senkouB, chikou };
}

/** Supertrend: ATR-based trailing stop that flips direction. */
export function supertrend(highs = [], lows = [], closes = [], { period = 10, multiplier = 3 } = {}) {
  const n = closes.length;
  const line = new Array(n).fill(null);
  const direction = new Array(n).fill(null); // 1 = up (long), -1 = down (short)
  const atrVals = atr(highs, lows, closes, period);
  let prevUpper = null;
  let prevLower = null;
  let dir = 1;
  for (let i = 0; i < n; i++) {
    const a = atrVals[i];
    if (a == null) continue;
    const hl2 = (highs[i] + lows[i]) / 2;
    let upper = hl2 + multiplier * a;
    let lower = hl2 - multiplier * a;
    if (prevUpper != null) upper = closes[i - 1] > prevUpper ? Math.min(upper, prevUpper) : upper;
    if (prevLower != null) lower = closes[i - 1] < prevLower ? Math.max(lower, prevLower) : lower;
    if (closes[i] > (prevUpper ?? upper)) dir = 1;
    else if (closes[i] < (prevLower ?? lower)) dir = -1;
    line[i] = dir === 1 ? lower : upper;
    direction[i] = dir;
    prevUpper = upper;
    prevLower = lower;
  }
  return { line, direction };
}

/** Simple confidence/quality helper used by the chart legend. */
export function indicatorReady(series = []) {
  return series.some((v) => v != null);
}

/** Custom indicator builder: SMA/EMA/WMA applied to a chosen source series. */
export function buildCustom(source = [], { ma = 'sma', period = 14 } = {}) {
  if (ma === 'wma') return wma(source, period);
  if (ma === 'ema') {
    const out = new Array(source.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < source.length; i++) {
      if (i < period - 1) continue;
      prev = prev == null ? source.slice(0, period).reduce((a, b) => a + b, 0) / period : source[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }
  return sma(source, period);
}
