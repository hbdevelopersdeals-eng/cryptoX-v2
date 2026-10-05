// Technical indicator math — operates on numeric arrays.

export function sma(arr, period) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= period) sum -= arr[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(arr, period) {
  const out = new Array(arr.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    prev = prev == null ? arr[i] : arr[i] * k + prev * (1 - k);
    if (i >= period - 1) out[i] = prev;
  }
  return out;
}

// Wilder-smoothed RSI, standard 14.
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  // signal: EMA of the macd line (only over non-null region)
  const validIdx = line.findIndex((v) => v != null);
  const out = { line, signal: new Array(closes.length).fill(null), hist: new Array(closes.length).fill(null) };
  if (validIdx === -1) return out;
  const k = 2 / (signal + 1);
  let prev = null;
  for (let i = validIdx; i < closes.length; i++) {
    prev = prev == null ? line[i] : line[i] * k + prev * (1 - k);
    out.signal[i] = prev;
    out.hist[i] = line[i] - prev;
  }
  return out;
}

export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

export function stochastic(highs, lows, closes, k = 14, d = 3) {
  const raw = new Array(closes.length).fill(null);
  for (let i = k - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - k + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    raw[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  }
  // %D = sma of raw over 3
  let sum = 0;
  const pctD = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (raw[i] == null) { pctD[i] = null; continue; }
    sum += raw[i];
    if (i >= d && raw[i - d] != null) sum -= raw[i - d];
    if (raw[i - d + 1] != null) pctD[i] = sum / d;
  }
  return { k: raw, d: pctD };
}

export function roc(closes, period = 10) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const base = closes[i - period];
    out[i] = base === 0 ? 0 : ((closes[i] - base) / base) * 100;
  }
  return out;
}

export function donchian(highs, lows, period = 20) {
  const up = new Array(highs.length).fill(null);
  const dn = new Array(highs.length).fill(null);
  for (let i = period - 1; i < highs.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    up[i] = hh;
    dn[i] = ll;
  }
  return { up, dn };
}

export function vwap(highs, lows, closes, volumes) {
  const out = new Array(closes.length).fill(null);
  let pv = 0, v = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    const vol = volumes[i] ?? 0;
    pv += tp * vol;
    v += vol;
    out[i] = v > 0 ? pv / v : null;
  }
  return out;
}

// Deterministic seeded PRNG for offline demo candles
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
