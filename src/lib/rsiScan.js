import { rsi } from './indicators.js';

/* RSI strategy helpers — kept pure so they are easy to test.
 * Signal rules (the user's own strategy):
 *   RSI < 30  → BUY  (oversold)
 *   RSI > 70  → SELL (overbought)
 *   in between → HOLD (neutral)
 */

export const RSI_PERIOD = 14;
export const OVERSOLD = 30;
export const OVERBOUGHT = 70;

// Coins whose RSI carries no trading meaning.
export const STABLE_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'PYUSD', 'USDS', 'USD1']);

export function classifyRsi(value, oversold = OVERSOLD, overbought = OVERBOUGHT) {
  if (value == null || Number.isNaN(value)) return { signal: 'NA', label: 'No data', tone: 'muted' };
  if (value < oversold) return { signal: 'BUY', label: 'Oversold — buy zone', tone: 'up' };
  if (value > overbought) return { signal: 'SELL', label: 'Overbought — sell zone', tone: 'down' };
  return { signal: 'HOLD', label: 'Neutral', tone: 'muted' };
}

/** RSI for the most recent bar, or null when there is not enough history. */
export function rsiFromCloses(closes, period = RSI_PERIOD) {
  if (!Array.isArray(closes) || closes.length < period + 2) return null;
  const series = rsi(closes, period);
  const last = series[series.length - 1];
  return last == null || Number.isNaN(last) ? null : last;
}

/** Swap the final close for the live price so the readout moves tick by tick. */
export function closesWithLive(candles, livePrice) {
  const closes = Array.isArray(candles) ? candles.map((c) => c.c) : [];
  if (!closes.length) return closes;
  if (typeof livePrice === 'number' && livePrice > 0) closes[closes.length - 1] = livePrice;
  return closes;
}

/** Distance from the current RSI to the relevant trigger, in RSI points. */
export function distanceToTrigger(value, oversold = OVERSOLD, overbought = OVERBOUGHT) {
  if (value == null || Number.isNaN(value)) return null;
  if (value < oversold) return { side: 'BUY', points: Number((oversold - value).toFixed(1)) };
  if (value > overbought) return { side: 'SELL', points: Number((value - overbought).toFixed(1)) };
  const toBuy = oversold - value;
  const toSell = value - overbought;
  return Math.abs(toBuy) <= Math.abs(toSell)
    ? { side: 'BUY', points: Number(Math.abs(toBuy).toFixed(1)) }
    : { side: 'SELL', points: Number(Math.abs(toSell).toFixed(1)) };
}

export function scanStats(items = []) {
  const stats = { buy: 0, sell: 0, hold: 0, na: 0, total: items.length };
  items.forEach((item) => {
    const sig = item?.signal || 'NA';
    if (sig === 'BUY') stats.buy += 1;
    else if (sig === 'SELL') stats.sell += 1;
    else if (sig === 'HOLD') stats.hold += 1;
    else stats.na += 1;
  });
  return stats;
}

/** Split a list into fixed-size slices (used for bounded-concurrency scanning). */
export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}
