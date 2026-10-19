// One-click ready-made trading strategies.
// Each preset is a pure function over OHLCV arrays producing the latest signal
// plus a reason string. Signals: 'BUY' | 'SELL' | null (hold).

import {
  rsi, sma, ema, macd, bollinger, stochastic, roc, donchian, vwap, stochRsi, cci
} from './indicators.js';

export const INTERVALS = [
  { key: '5m', label: '5m' },
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '4h', label: '4h' },
  { key: '1d', label: '1d' }
];

export const PRESETS = [
  {
    id: 'rsi-reversal',
    name: 'RSI Reversal',
    tag: 'YOUR SIGNATURE',
    icon: 'Activity',
    desc: 'Buy when RSI drops below 30 (oversold), sell when it climbs above 70 (overbought).',
    defaults: { buyBelow: 30, sellAbove: 70, period: 14 },
    color: '#FFC105'
  },
  {
    id: 'golden-cross',
    name: 'Golden Cross',
    icon: 'TrendingUp',
    desc: 'Buy when the fast MA crosses above the slow MA; sell on the death cross below.',
    defaults: { fast: 20, slow: 50 },
    color: '#34d399'
  },
  {
    id: 'macd-momentum',
    name: 'MACD Crossover',
    icon: 'BarChart3',
    desc: 'Buy when MACD line crosses above its signal line; sell on the bearish cross.',
    defaults: { fast: 12, slow: 26, signal: 9 },
    color: '#60a5fa'
  },
  {
    id: 'bollinger-squeeze',
    name: 'Bollinger Squeeze',
    icon: 'Gauge',
    desc: 'Buy when price touches the lower band, sell when it kisses the upper band.',
    defaults: { period: 20, mult: 2 },
    color: '#a78bfa'
  },
  {
    id: 'stochastic-osc',
    name: 'Stochastic Reversal',
    icon: 'Waves',
    desc: 'Buy when %K crosses above %D below 20; sell when it crosses below %D above 80.',
    defaults: { k: 14, d: 3, low: 20, high: 80 },
    color: '#f472b6'
  },
  {
    id: 'momentum-blast',
    name: 'Momentum Blast',
    icon: 'Zap',
    desc: 'Buy when 10-period momentum turns sharply positive; sell when it rolls over negative.',
    defaults: { period: 10, threshold: 3 },
    color: '#fb923c'
  },
  {
    id: 'donchian-breakout',
    name: 'Donchian Breakout',
    icon: 'Rocket',
    desc: 'Buy on a 20-bar high breakout; sell when price breaks below the 20-bar low.',
    defaults: { period: 20 },
    color: '#22d3ee'
  },
  {
    id: 'vwap-pullback',
    name: 'VWAP Pullback',
    icon: 'Compass',
    desc: 'Buy when price pulls back and reclaims the session VWAP; sell below VWAP on weakness.',
    defaults: {},
    color: '#facc15'
  },
  {
    id: 'stoch-rsi',
    name: 'Stochastic RSI',
    icon: 'Activity',
    desc: 'Buy when StochRSI %K crosses above %D from oversold (<20); sell when %K crosses below %D from overbought (>80).',
    defaults: { rsiPeriod: 14, stochPeriod: 14, smoothK: 3, smoothD: 3, low: 20, high: 80 },
    color: '#10b981'
  },
  {
    id: 'cci-reversal',
    name: 'CCI Reversal',
    icon: 'Layers',
    desc: 'Buy when CCI crosses back above -100 from oversold; sell when CCI falls below +100 from overbought.',
    defaults: { period: 20, oversold: -100, overbought: 100 },
    color: '#8b5cf6'
  }
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id);
}

function last(arr, n = 1) {
  return arr[arr.length - n];
}
function prev(arr, n = 2) {
  return arr[arr.length - n];
}
const nonNull = (v) => v != null;

export function evaluateStrategy(presetId, k, params, ticker) {
  const { open, high, low, close, volume } = k || {};
  if (!close || close.length < 30) return { signal: null, reason: 'Not enough candle data yet', state: 'neutral' };

  const c = close;
  const lastPrice = ticker?.price ?? c[c.length - 1];
  let sig = null;
  let reason = '';
  let state = 'neutral'; // bullish | bearish | neutral

  switch (presetId) {
    case 'rsi-reversal': {
      const p = params?.period || 14;
      const r = rsi(c, p);
      const cur = last(r), prevV = last(r, 2);
      if (cur == null) break;
      const lo = params?.buyBelow ?? 30;
      const hi = params?.sellAbove ?? 70;
      if (prevV != null && cur > lo && prevV <= lo) { sig = 'BUY'; reason = `RSI(${p}) crossed back above ${lo} from oversold (${prevV?.toFixed(1)} → ${cur.toFixed(1)})`; }
      else if (prevV != null && cur < hi && prevV >= hi) { sig = 'SELL'; reason = `RSI(${p}) fell back below ${hi} from overbought (${prevV?.toFixed(1)} → ${cur.toFixed(1)})`; }
      else if (cur <= lo) { state = 'bullish'; reason = `RSI(${p}) at ${cur.toFixed(1)} — below ${lo}, watching for reversal`; }
      else if (cur >= hi) { state = 'bearish'; reason = `RSI(${p}) at ${cur.toFixed(1)} — above ${hi}, watching for rollover`; }
      else reason = `RSI(${p}) at ${cur.toFixed(1)} — between ${lo} and ${hi}`;
      break;
    }
    case 'golden-cross': {
      const fast = sma(c, params?.fast || 20);
      const slow = sma(c, params?.slow || 50);
      const f = last(fast), s = last(slow), fp = prev(fast), sp = prev(slow);
      if (f == null || s == null) { reason = 'Warming up MA window'; break; }
      if (fp != null && sp != null) {
        if (fp <= sp && f > s) { sig = 'BUY'; reason = `Golden cross — MA${params?.fast || 20} (${f.toFixed(4)}) crossed above MA${params?.slow || 50} (${s.toFixed(4)})`; }
        else if (fp >= sp && f < s) { sig = 'SELL'; reason = `Death cross — MA${params?.fast || 20} (${f.toFixed(4)}) fell below MA${params?.slow || 50} (${s.toFixed(4)})`; }
      }
      state = f > s ? 'bullish' : 'bearish';
      if (!sig) reason = f > s ? `Uptrend — MA${params?.fast || 20} above MA${params?.slow || 50}` : `Downtrend — MA${params?.fast || 20} below MA${params?.slow || 50}`;
      break;
    }
    case 'macd-momentum': {
      const m = macd(c, params?.fast || 12, params?.slow || 26, params?.signal || 9);
      const line = last(m.line), sg = last(m.signal), lp = prev(m.line), sp = prev(m.signal);
      if (line == null || sg == null) { reason = 'Warming up MACD window'; break; }
      if (lp != null && sp != null) {
        if (lp <= sp && line > sg) { sig = 'BUY'; reason = `MACD line (${line.toFixed(6)}) crossed above signal (${sg.toFixed(6)})`; }
        else if (lp >= sp && line < sg) { sig = 'SELL'; reason = `MACD line (${line.toFixed(6)}) crossed below signal (${sg.toFixed(6)})`; }
      }
      state = line > sg ? 'bullish' : 'bearish';
      if (!sig) reason = `MACD ${line > sg ? 'above' : 'below'} signal — ${line > sg ? 'momentum up' : 'momentum down'}`;
      break;
    }
    case 'bollinger-squeeze': {
      const b = bollinger(c, params?.period || 20, params?.mult || 2);
      const u = last(b.upper), l = last(b.lower), mid = last(b.mid), p = lastPrice;
      const up = prev(b.upper), lo = prev(b.lower), pp = prev(c);
      if (u == null) { reason = 'Warming up Bollinger window'; break; }
      if (pp != null && lo != null && up != null) {
        if (pp <= lo && p > l) { sig = 'BUY'; reason = `Price reclaimed the lower band (${l.toFixed(6)})`; }
        else if (pp >= up && p < u) { sig = 'SELL'; reason = `Price rejected off the upper band (${u.toFixed(6)})`; }
      }
      if (!sig) {
        const bw = mid && u ? ((u - l) / mid) * 100 : 0;
        state = p > mid ? 'bullish' : 'bearish';
        reason = `Price ${p > mid ? 'above' : 'below'} mid band — bandwidth ${bw.toFixed(2)}%`;
      }
      break;
    }
    case 'stochastic-osc': {
      const s = stochastic(high, low, c, params?.k || 14, params?.d || 3);
      const kk = last(s.k), dd = last(s.d), kp = prev(s.k), dp = prev(s.d);
      if (kk == null) { reason = 'Warming up Stochastic window'; break; }
      if (kp != null && dp != null) {
        if (kp <= dp && kk > dd && kk < (params?.low ?? 20) + 15) { sig = 'BUY'; reason = `%K (${kk.toFixed(1)}) crossed above %D (${dd.toFixed(1)}) in oversold zone`; }
        else if (kp >= dp && kk < dd && kk > (params?.high ?? 80) - 15) { sig = 'SELL'; reason = `%K (${kk.toFixed(1)}) crossed below %D (${dd.toFixed(1)}) in overbought zone`; }
      }
      state = kk > dd ? 'bullish' : 'bearish';
      if (!sig) reason = `Stoch %K ${kk.toFixed(1)} / %D ${dd.toFixed(1)}`;
      break;
    }
    case 'momentum-blast': {
      const p = params?.period || 10;
      const r = roc(c, p);
      const cur = last(r), prevV = prev(r), thr = params?.threshold ?? 3;
      if (cur == null) { reason = 'Warming up momentum window'; break; }
      if (prevV != null && cur > thr && prevV <= thr) { sig = 'BUY'; reason = `Momentum(${p}) surged to +${cur.toFixed(2)}% — blast off`; }
      else if (prevV != null && cur < -thr && prevV >= -thr) { sig = 'SELL'; reason = `Momentum(${p}) collapsed to ${cur.toFixed(2)}% — exit`; }
      state = cur > 0 ? 'bullish' : 'bearish';
      if (!sig) reason = `Momentum(${p}) at ${cur > 0 ? '+' : ''}${cur.toFixed(2)}%`;
      break;
    }
    case 'donchian-breakout': {
      const period = params?.period || 20;
      const d = donchian(high, low, period);
      // Compare against the PRIOR bar's channel: a channel that includes the
      // current bar can never be broken out of on that same bar.
      const upLevel = prev(d.up), dnLevel = prev(d.dn);
      const p = lastPrice, pp = prev(c);
      if (upLevel == null || dnLevel == null) { reason = 'Warming up Donchian window'; break; }
      if (pp != null) {
        if (pp <= upLevel && p > upLevel) { sig = 'BUY'; reason = `Broke out above the ${period}-bar high ${upLevel.toFixed(6)}`; }
        else if (pp >= dnLevel && p < dnLevel) { sig = 'SELL'; reason = `Broke below the ${period}-bar low ${dnLevel.toFixed(6)}`; }
      }
      state = p > upLevel ? 'bullish' : p < dnLevel ? 'bearish' : 'neutral';
      if (!sig) reason = `Range ${dnLevel.toFixed(6)} – ${upLevel.toFixed(6)}`;
      break;
    }
    case 'vwap-pullback': {
      const v = vwap(high, low, c, volume);
      const cur = last(v), pv = prev(v), p = lastPrice;
      if (cur == null) { reason = 'Warming up VWAP'; break; }
      if (pv != null) {
        if (pv > cur && p > cur) { sig = 'BUY'; reason = `Price reclaimed VWAP (${cur.toFixed(6)}) after a pullback`; }
        else if (pv <= cur && p < cur) { sig = 'SELL'; reason = `Price lost VWAP (${cur.toFixed(6)})`; }
      }
      state = p > cur ? 'bullish' : 'bearish';
      if (!sig) reason = p > cur ? 'Trading above VWAP' : 'Trading below VWAP';
      break;
    }
    case 'stoch-rsi': {
      const sr = stochRsi(
        c,
        params?.rsiPeriod || 14,
        params?.stochPeriod || 14,
        params?.smoothK || 3,
        params?.smoothD || 3
      );
      const kk = last(sr.k), dd = last(sr.d), kp = prev(sr.k), dp = prev(sr.d);
      if (kk == null || dd == null) { reason = 'Warming up StochRSI window'; break; }
      const lo = params?.low ?? 20;
      const hi = params?.high ?? 80;
      if (kp != null && dp != null) {
        if (kp <= dp && kk > dd && kk < lo + 15) {
          sig = 'BUY';
          reason = `StochRSI %K (${kk.toFixed(1)}) crossed above %D (${dd.toFixed(1)}) in oversold zone`;
        } else if (kp >= dp && kk < dd && kk > hi - 15) {
          sig = 'SELL';
          reason = `StochRSI %K (${kk.toFixed(1)}) crossed below %D (${dd.toFixed(1)}) in overbought zone`;
        }
      }
      state = kk > dd ? 'bullish' : 'bearish';
      if (!sig) reason = `StochRSI %K ${kk.toFixed(1)} / %D ${dd.toFixed(1)}`;
      break;
    }
    case 'cci-reversal': {
      const p = params?.period || 20;
      const cciVals = cci(high, low, c, p);
      const cur = last(cciVals), pv = prev(cciVals);
      if (cur == null) { reason = 'Warming up CCI window'; break; }
      const os = params?.oversold ?? -100;
      const ob = params?.overbought ?? 100;
      if (pv != null) {
        if (pv <= os && cur > os) {
          sig = 'BUY';
          reason = `CCI(${p}) crossed back above ${os} (${pv.toFixed(1)} → ${cur.toFixed(1)})`;
        } else if (pv >= ob && cur < ob) {
          sig = 'SELL';
          reason = `CCI(${p}) fell back below ${ob} (${pv.toFixed(1)} → ${cur.toFixed(1)})`;
        }
      }
      state = cur > 0 ? 'bullish' : 'bearish';
      if (!sig) reason = `CCI(${p}) at ${cur.toFixed(1)} (neutral)`;
      break;
    }
    default:
      reason = 'Unknown preset';
  }

  return { signal: sig, reason, state, price: lastPrice };
}

// Default readable interval label used in signal history
export function intervalLabel(key) {
  return (INTERVALS.find((i) => i.key === key) || { label: key }).label;
}
