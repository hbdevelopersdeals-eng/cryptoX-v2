/* Indicator marketplace.
 *
 * Honest scope: this is a LOCAL registry that ships with the app. "Installing"
 * a preset writes an indicator configuration into your chart — nothing is
 * fetched from a server, and the install counts are illustrative, not live
 * popularity. A server-backed marketplace would need a backend registry, which
 * this client-only build does not have.
 *
 * Every preset must reference an indicator the engine actually supports, so a
 * preset can never point at something that does not exist.
 */

import { buildCustom } from './indicators2.js';

/** Indicator families the engine implements. */
export const INDICATOR_FAMILIES = {
  sma: 'Simple moving average',
  ema: 'Exponential moving average',
  wma: 'Weighted moving average',
  rsi: 'Relative Strength Index',
  macd: 'MACD',
  bollinger: 'Bollinger Bands',
  atr: 'Average True Range',
  adx: 'ADX / DMI',
  stochastic: 'Stochastic oscillator',
  obv: 'On-Balance Volume',
  ichimoku: 'Ichimoku Cloud',
  supertrend: 'Supertrend',
  vwap: 'VWAP',
  donchian: 'Donchian channel',
  roc: 'Rate of change',
  custom: 'Custom (user-built)'
};

export const INDICATOR_CATEGORIES = ['Overlay', 'Momentum', 'Trend', 'Volatility', 'Volume'];

export const INDICATOR_PRESETS = [
  { id: 'ind-sma-50', name: 'SMA 50', family: 'sma', category: 'Overlay', author: 'CryptoX Labs', installs: 2870,
    blurb: 'The 50-period simple average, the common medium-term trend reference.' },
  { id: 'ind-sma-200', name: 'SMA 200', family: 'sma', category: 'Trend', author: 'CryptoX Labs', installs: 3140,
    blurb: 'Long-term trend filter; price above it is the classic bull-market condition.' },
  { id: 'ind-wma-20', name: 'WMA 20', family: 'wma', category: 'Overlay', author: 'CryptoX Labs', installs: 620,
    blurb: 'Weighted average that reacts faster than an SMA of the same length.' },
  { id: 'ind-roc-10', name: 'Rate of change 10', family: 'roc', category: 'Momentum', author: 'CryptoX Labs', installs: 410,
    blurb: 'Percentage change over 10 bars, used as a momentum filter.' },
  { id: 'ind-ema-cross', name: 'EMA 9 / 21 crossover', family: 'ema', category: 'Trend', author: 'CryptoX Labs', installs: 2410,
    blurb: 'Two EMAs with the classic fast/slow pair for trend entries.' },
  { id: 'ind-rsi-14', name: 'RSI 14 (30/70)', family: 'rsi', category: 'Momentum', author: 'CryptoX Labs', installs: 3980,
    blurb: 'The default RSI with oversold 30 and overbought 70 bands.' },
  { id: 'ind-macd-std', name: 'MACD 12/26/9', family: 'macd', category: 'Momentum', author: 'CryptoX Labs', installs: 3120,
    blurb: 'Standard MACD with signal line and histogram.' },
  { id: 'ind-bb-20', name: 'Bollinger Bands 20 / 2σ', family: 'bollinger', category: 'Volatility', author: 'CryptoX Labs', installs: 2050,
    blurb: 'Mean-reversion envelope around a 20-period SMA.' },
  { id: 'ind-atr-14', name: 'ATR 14', family: 'atr', category: 'Volatility', author: 'CryptoX Labs', installs: 1640,
    blurb: 'Volatility read used for stop sizing.' },
  { id: 'ind-adx-14', name: 'ADX 14 with DI±', family: 'adx', category: 'Trend', author: 'CryptoX Labs', installs: 980,
    blurb: 'Trend strength with directional movement.' },
  { id: 'ind-stoch', name: 'Stochastic 14/3', family: 'stochastic', category: 'Momentum', author: 'CryptoX Labs', installs: 1310,
    blurb: 'K/D oscillator for exhaustion timing.' },
  { id: 'ind-obv', name: 'On-Balance Volume', family: 'obv', category: 'Volume', author: 'CryptoX Labs', installs: 760,
    blurb: 'Cumulative volume pressure.' },
  { id: 'ind-ichimoku', name: 'Ichimoku Cloud 9/26/52', family: 'ichimoku', category: 'Trend', author: 'CryptoX Labs', installs: 1180,
    blurb: 'Full cloud with tenkan, kijun and senkou spans.' },
  { id: 'ind-supertrend', name: 'Supertrend 10 / 3×', family: 'supertrend', category: 'Trend', author: 'CryptoX Labs', installs: 1720,
    blurb: 'ATR-based trailing stop that flips with the trend.' },
  { id: 'ind-vwap', name: 'VWAP (session)', family: 'vwap', category: 'Volume', author: 'CryptoX Labs', installs: 890,
    blurb: 'Volume-weighted average price for execution reference.' },
  { id: 'ind-donchian', name: 'Donchian 20', family: 'donchian', category: 'Volatility', author: 'CryptoX Labs', installs: 540,
    blurb: '20-bar high/low channel used by breakout systems.' },
  { id: 'ind-wma-custom', name: 'Custom WMA 9', family: 'custom', category: 'Overlay', author: 'CryptoX Labs', installs: 210,
    params: { ma: 'wma', period: 9 }, blurb: 'A ready-made user-built indicator: weighted MA over 9 bars.' }
];

export const MA_TYPES = ['sma', 'ema', 'wma'];

/**
 * Build a user-created indicator from a moving-average type and period.
 * Validates first, so an unsupported type or a silly period is rejected with a
 * reason instead of producing a broken series.
 */
export function makeCustomIndicator({ ma = 'sma', period = 14, source = [] } = {}) {
  const errors = [];
  if (!MA_TYPES.includes(ma)) errors.push(`Unsupported average "${ma}"`);
  const p = Number(period);
  if (!Number.isInteger(p) || p < 1) errors.push('Period must be a whole number of at least 1');
  if (p > 500) errors.push('Period must be 500 or less');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    spec: { family: 'custom', ma, period: p, label: `${ma.toUpperCase()} ${p}`, builtIn: false },
    series: source.length ? buildCustom(source.map((c) => c.c ?? c), { ma, period: p }) : []
  };
}

export const presetById = (id) => INDICATOR_PRESETS.find((p) => p.id === id) || null;

/** The subset of presets that render as a study pane rather than an overlay. */
export const STUDY_FAMILIES = ['rsi', 'macd', 'atr', 'adx', 'obv', 'stochastic'];
