import { describe, it, expect } from 'vitest';
import {
  BOT_TYPES, DEFAULT_RISK, applyRiskControls, runBotTick, trackEquity,
  mean, stdev, zScore, donchian, roc, atr, closesOf, evaluateConditions,
  CONDITION_FIELDS, CONDITION_OPS, MARKETPLACE, RISK_BADGE
} from './bots.js';

/** Flat-ish candles with an optional final override. */
const candles = (n = 60, base = 100, step = 0, last = null, vol = 10) =>
  Array.from({ length: n }, (_, i) => {
    const c = i === n - 1 && last != null ? last : base + i * step;
    return { o: c, c, h: c + 1, l: c - 1, v: vol };
  });

const bot = (type, params = {}, state = {}, extra = {}) => ({ type, params, state, ...extra });

describe('indicator helpers', () => {
  it('computes mean and stdev', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdev([2, 4, 6])).toBeCloseTo(2, 6);
    expect(stdev([5])).toBeNull();
  });

  it('computes a z-score against the trailing window', () => {
    const z = zScore([1, 2, 3, 4, 5, 100], 5);
    expect(z).toBeGreaterThan(1.5); // 100 is far outside 1..5
    expect(zScore([1, 2], 5)).toBeNull();
  });

  it('excludes the current bar from a Donchian channel', () => {
    // The last bar is a huge spike; the channel must NOT include it, otherwise
    // a breakout could never trigger.
    const c = candles(30, 100, 0, 500);
    const ch = donchian(c, 20);
    expect(ch.high).toBe(101);   // prior highs are base+1
    expect(ch.low).toBe(99);
    expect(ch.high).toBeLessThan(500);
    expect(donchian(candles(5), 20)).toBeNull();
  });

  it('computes ROC and ATR', () => {
    expect(roc([100, 110], 1)).toBeCloseTo(10, 6);
    expect(roc([100], 5)).toBeNull();
    const a = atr(candles(30, 100, 1), 14);
    expect(a).toBeGreaterThan(0);
  });

  it('extracts closes', () => {
    expect(closesOf([{ c: 1 }, { c: 2 }])).toEqual([1, 2]);
  });
});

describe('risk controls', () => {
  const ctx = { equity: 1000, price: 100, cash: 1000, positionValue: 0, positionQty: 0 };

  it('caps an order at maxOrderQuote and says why', () => {
    const r = applyRiskControls([{ side: 'buy', qty: 100, price: 100 }], ctx, { maxOrderQuote: 500 });
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].qty).toBe(5);          // 500 / 100
    expect(r.orders[0].scaleReason).toMatch(/maxOrderQuote/);
    expect(r.blocked).toEqual([]);
  });

  it('caps a position at maxPositionPct', () => {
    const r = applyRiskControls([{ side: 'buy', qty: 5, price: 100 }], { ...ctx, positionValue: 200 }, { maxPositionPct: 30, maxOrderQuote: 1e9 });
    // 30% of 1000 = 300; already 200 → room 100 → 1 unit
    expect(r.orders[0].qty).toBe(1);
    expect(r.orders[0].scaleReason).toMatch(/maxPositionPct/);
  });

  it('blocks a buy once the position cap is fully used', () => {
    const r = applyRiskControls([{ side: 'buy', qty: 1, price: 100 }], { ...ctx, positionValue: 400 }, { maxPositionPct: 30, maxOrderQuote: 1e9 });
    expect(r.orders).toHaveLength(0);
    expect(r.blocked[0].code).toBe('max-position');
  });

  it('blocks an oversell rather than inventing units', () => {
    const r = applyRiskControls([{ side: 'sell', qty: 5, price: 100 }], { ...ctx, positionQty: 2 }, { maxOrderQuote: 1e9 });
    expect(r.orders).toHaveLength(0);
    expect(r.blocked[0].code).toBe('oversell');
  });

  it('never lets combined buys exceed cash — later orders are trimmed', () => {
    const r = applyRiskControls(
      [{ side: 'buy', qty: 6, price: 100 }, { side: 'buy', qty: 6, price: 100 }],
      { ...ctx, cash: 800 },
      { maxOrderQuote: 1e9, maxPositionPct: 100 }
    );
    const spend = r.orders.reduce((a, o) => a + o.qty * o.price, 0);
    expect(spend).toBeLessThanOrEqual(800);
    // The first leg takes 600, so the second is trimmed to the 200 remaining.
    expect(r.orders).toHaveLength(2);
    expect(r.orders[1].qty).toBe(2);
    expect(r.orders[1].scaleReason).toMatch(/available cash/);
  });

  it('blocks an outright buy when cash is already fully committed', () => {
    const r = applyRiskControls(
      [{ side: 'buy', qty: 8, price: 100 }, { side: 'buy', qty: 1, price: 100 }],
      { ...ctx, cash: 800 },
      { maxOrderQuote: 1e9, maxPositionPct: 100 }
    );
    expect(r.orders).toHaveLength(1);
    expect(r.blocked.some((b) => b.code === 'insufficient-cash')).toBe(true);
  });

  it('halts on max drawdown before any order is considered', () => {
    // Equity has fallen 30% from the peak; the limit is 20%.
    const r = applyRiskControls([{ side: 'buy', qty: 1, price: 100 }], { ...ctx, equity: 700 }, { maxDrawdownPct: 20 }, { peakEquity: 1000 });
    expect(r.halted).toBe(true);
    expect(r.orders).toEqual([]);
    expect(r.blocked[0].code).toBe('max-drawdown');
  });

  it('halts on daily loss and on trade count', () => {
    const loss = applyRiskControls([], { ...ctx, equity: 800 }, { dailyLossPct: 10 }, { dayStartEquity: 1000 });
    expect(loss.halted).toBe(true);
    expect(loss.blocked[0].code).toBe('daily-loss');

    const count = applyRiskControls([], ctx, { maxTradesPerDay: 5 }, { tradesToday: 5 });
    expect(count.halted).toBe(true);
    expect(count.blocked[0].code).toBe('trade-count');
  });

  it('rejects a zero-size order explicitly', () => {
    const r = applyRiskControls([{ side: 'buy', qty: 0, price: 100 }], ctx, {});
    expect(r.blocked[0].code).toBe('bad-size');
  });

  it('tracks the equity peak', () => {
    expect(trackEquity({}, 100).peakEquity).toBe(100);
    expect(trackEquity({ peakEquity: 100 }, 80).peakEquity).toBe(100);
    expect(trackEquity({ peakEquity: 100 }, 150).peakEquity).toBe(150);
  });
});

describe('DCA bot', () => {
  const ctx = (barIndex) => ({ price: 100, barIndex });

  it('buys on schedule and not before', () => {
    const first = BOT_TYPES.dca.step({ bot: bot('dca', { amountQuote: 200, everyBars: 10 }, {}), ...ctx(0) });
    expect(first.orders).toHaveLength(1);
    expect(first.orders[0].qty).toBe(2); // 200/100
    expect(first.state.buysDone).toBe(1);

    const tooSoon = BOT_TYPES.dca.step({ bot: bot('dca', { amountQuote: 200, everyBars: 10 }, { lastBuyBar: 0 }), ...ctx(4) });
    expect(tooSoon.orders).toHaveLength(0);
    expect(tooSoon.notes[0]).toMatch(/Next buy in 6 bars/);

    const due = BOT_TYPES.dca.step({ bot: bot('dca', { amountQuote: 200, everyBars: 10 }, { lastBuyBar: 0 }), ...ctx(10) });
    expect(due.orders).toHaveLength(1);
  });
});

describe('Grid bot', () => {
  const params = { lower: 100, upper: 200, levels: 5, orderQuote: 100 };

  it('refuses to trade outside the range', () => {
    const r = BOT_TYPES.grid.step({ bot: bot('grid', params, {}), price: 50 });
    expect(r.orders).toHaveLength(0);
    expect(r.notes[0]).toMatch(/outside the grid/);
  });

  it('buys when price is at or below a level', () => {
    const r = BOT_TYPES.grid.step({ bot: bot('grid', params, {}), price: 100 });
    expect(r.orders.length).toBeGreaterThan(0);
    expect(r.orders.every((o) => o.side === 'buy')).toBe(true);
    expect(r.state.heldLevels.length).toBe(r.orders.length);
  });

  it('requires a valid range', () => {
    const r = BOT_TYPES.grid.step({ bot: bot('grid', { lower: 200, upper: 100, levels: 5 }, {}), price: 150 });
    expect(r.notes[0]).toMatch(/upper bound above the lower/);
  });
});

describe('TWAP and VWAP', () => {
  it('TWAP emits equal slices then stops', () => {
    const b = { type: 'twap', params: { totalQty: 10, slices: 5, everyBars: 1, side: 'buy' }, state: {} };
    let state = {};
    const sizes = [];
    for (let i = 0; i < 6; i += 1) {
      const r = BOT_TYPES.twap.step({ bot: { ...b, state }, price: 100, barIndex: i });
      if (r.orders.length) sizes.push(r.orders[0].qty);
      state = { ...state, ...(r.state || {}) };
    }
    expect(sizes).toEqual([2, 2, 2, 2, 2]); // 10 / 5
    const afterDone = BOT_TYPES.twap.step({ bot: { ...b, state }, price: 100, barIndex: 9 });
    expect(afterDone.orders).toHaveLength(0);
    expect(afterDone.notes[0]).toMatch(/complete/);
  });

  it('VWAP weights tranches by volume', () => {
    const noVol = candles(30, 100, 0);
    const r = BOT_TYPES.vwap.step({ bot: bot('vwap', { totalQty: 100, side: 'buy' }, {}), price: 100, candles: noVol, barIndex: 0 });
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].qty).toBeGreaterThan(0);
    expect(r.orders[0].qty).toBeLessThanOrEqual(100);
    expect(r.orders[0].reason).toMatch(/VWAP tranche/);

    const thin = BOT_TYPES.vwap.step({ bot: bot('vwap', { totalQty: 100 }, {}), price: 100, candles: candles(10), barIndex: 0 });
    expect(thin.notes[0]).toMatch(/20\+ bars/);
  });
});

describe('Arbitrage bot', () => {
  it('ignores a gap that fees eat', () => {
    const r = BOT_TYPES.arbitrage.step({
      bot: bot('arbitrage', { minNetPct: 0.3, tradeQuote: 500 }, {}),
      venues: [{ venue: 'a', price: 100 }, { venue: 'b', price: 100.1 }]
    });
    expect(r.orders).toHaveLength(0);
    expect(r.notes[0]).toMatch(/below/);
  });

  it('buys the cheapest and sells the dearest when the net gap clears the threshold', () => {
    const r = BOT_TYPES.arbitrage.step({
      bot: bot('arbitrage', { minNetPct: 0.3, tradeQuote: 1000 }, {}),
      venues: [{ venue: 'cheap', price: 100 }, { venue: 'mid', price: 101 }, { venue: 'dear', price: 102 }]
    });
    expect(r.orders).toHaveLength(2);
    const buy = r.orders.find((o) => o.side === 'buy');
    const sell = r.orders.find((o) => o.side === 'sell');
    expect(buy.venue).toBe('cheap');
    expect(sell.venue).toBe('dear');
    // 2% gross − 0.2% fees = 1.8% net, which clears 0.3%
    expect(r.notes[0]).toMatch(/1\.8/);
  });

  it('needs two venues', () => {
    const r = BOT_TYPES.arbitrage.step({ bot: bot('arbitrage', {}, {}), venues: [{ venue: 'a', price: 1 }] });
    expect(r.notes[0]).toMatch(/two venues/);
  });
});

describe('Rebalancing bot', () => {
  const holdings = [
    { symbol: 'BTC', value: 700, price: 100, targetWeight: 0.5 },
    { symbol: 'ETH', value: 300, price: 100, targetWeight: 0.5 }
  ];

  it('sells the overweight leg and buys the underweight one', () => {
    const r = BOT_TYPES.rebalance.step({ bot: bot('rebalance', { driftPct: 5 }, {}), holdings, price: 100 });
    const btc = r.orders.find((o) => o.reason.startsWith('BTC'));
    const eth = r.orders.find((o) => o.reason.startsWith('ETH'));
    expect(btc.side).toBe('sell'); // 70% vs 50%
    expect(eth.side).toBe('buy');  // 30% vs 50%
    expect(btc.qty).toBeCloseTo(2, 6); // (70-50)% of 1000 = 200 → 2 units
  });

  it('does nothing inside the tolerance band', () => {
    const r = BOT_TYPES.rebalance.step({
      bot: bot('rebalance', { driftPct: 5 }, {}),
      holdings: [{ symbol: 'BTC', value: 510, price: 100, targetWeight: 0.5 }, { symbol: 'ETH', value: 490, price: 100, targetWeight: 0.5 }],
      price: 100
    });
    expect(r.orders).toHaveLength(0);
    expect(r.notes[0]).toMatch(/within tolerance/);
  });
});

describe('Market-making bot', () => {
  it('quotes a bid below and an ask above the mid', () => {
    const r = BOT_TYPES.market_making.step({ bot: bot('market_making', { spreadBps: 25, orderQuote: 200, skewBps: 0 }, {}), price: 100, positionValue: 0, equity: 1000 });
    const bid = r.orders.find((o) => o.side === 'buy');
    const ask = r.orders.find((o) => o.side === 'sell');
    expect(bid.price).toBeLessThan(100);
    expect(ask.price).toBeGreaterThan(100);
    expect(bid.price).toBeCloseTo(99.75, 4);
    expect(ask.price).toBeCloseTo(100.25, 4);
  });

  it('skews both quotes down when holding inventory', () => {
    const flat = BOT_TYPES.market_making.step({ bot: bot('market_making', { spreadBps: 25, skewBps: 100 }, {}), price: 100, positionValue: 0, equity: 1000 });
    const long = BOT_TYPES.market_making.step({ bot: bot('market_making', { spreadBps: 25, skewBps: 100 }, {}), price: 100, positionValue: 500, equity: 1000 });
    const flatAsk = flat.orders.find((o) => o.side === 'sell').price;
    const longAsk = long.orders.find((o) => o.side === 'sell').price;
    expect(longAsk).toBeLessThan(flatAsk); // leans towards selling
  });
});

describe('Momentum bot', () => {
  const up = candles(80, 100, 1);
  const down = candles(80, 300, -1);

  it('enters long on a rising series', () => {
    const r = BOT_TYPES.momentum.step({ bot: bot('momentum', { fast: 5, slow: 20, rocPeriod: 5, orderQuote: 100 }, {}), candles: up, price: 180 });
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].side).toBe('buy');
    expect(r.state.inPosition).toBe(true);
  });

  it('exits when the trend flips', () => {
    const r = BOT_TYPES.momentum.step({ bot: bot('momentum', { fast: 5, slow: 20, rocPeriod: 5 }, { inPosition: true, positionQty: 3 }), candles: down, price: 220 });
    expect(r.orders[0].side).toBe('sell');
    expect(r.state.inPosition).toBe(false);
  });

  it('holds when already long and still trending', () => {
    const r = BOT_TYPES.momentum.step({ bot: bot('momentum', { fast: 5, slow: 20, rocPeriod: 5 }, { inPosition: true }), candles: up, price: 180 });
    expect(r.orders).toHaveLength(0);
  });
});

describe('Mean-reversion bot', () => {
  // A window needs real dispersion: a perfectly flat series has zero variance,
  // so a z-score is genuinely undefined and the bot must stay silent.
  const oscillating = (n) => Array.from({ length: n }, (_, i) => {
    const c = i % 2 === 0 ? 99 : 101;
    return { o: c, c, h: c + 1, l: c - 1, v: 10 };
  });

  const stretched = [...oscillating(21), { o: 70, c: 70, h: 71, l: 69, v: 10 }];
  const reverted = [...oscillating(21), { o: 100, c: 100, h: 101, l: 99, v: 10 }];

  it('buys a negative z-score beyond the entry threshold', () => {
    const r = BOT_TYPES.mean_reversion.step({ bot: bot('mean_reversion', { period: 20, zEntry: 2, zExit: 0, orderQuote: 100 }, {}), candles: stretched, price: 70 });
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].side).toBe('buy');
    expect(r.state.inPosition).toBe(true);
  });

  it('exits once the z-score reverts to the mean', () => {
    const r = BOT_TYPES.mean_reversion.step({ bot: bot('mean_reversion', { period: 20, zEntry: 2, zExit: 0 }, { inPosition: true, positionQty: 1 }), candles: reverted, price: 100 });
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].side).toBe('sell');
  });

  it('stays silent on a flat series rather than inventing a z-score', () => {
    const r = BOT_TYPES.mean_reversion.step({ bot: bot('mean_reversion', { period: 20 }, {}), candles: candles(25, 100, 0), price: 100 });
    expect(r.orders).toHaveLength(0);
    expect(r.notes[0]).toMatch(/Not enough history/);
  });

  it('waits when history is too short', () => {
    const r = BOT_TYPES.mean_reversion.step({ bot: bot('mean_reversion', { period: 20 }, {}), candles: candles(5), price: 100 });
    expect(r.notes[0]).toMatch(/Not enough history/);
  });
});

describe('Breakout bot', () => {
  it('enters when price clears the PRIOR range high', () => {
    // Flat history at 100 (highs 101), last close 150 → genuine breakout.
    const c = [...candles(30, 100, 0), { o: 150, c: 150, h: 151, l: 149, v: 10 }];
    const r = BOT_TYPES.breakout.step({ bot: bot('breakout', { period: 20, orderQuote: 100 }, {}), candles: c, price: 150 });
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].side).toBe('buy');
    expect(r.state.inPosition).toBe(true);
  });

  it('does not fire while price sits inside the range', () => {
    const r = BOT_TYPES.breakout.step({ bot: bot('breakout', { period: 20 }, {}), candles: candles(30, 100, 0), price: 100 });
    expect(r.orders).toHaveLength(0);
    expect(r.notes[0]).toMatch(/Range/);
  });

  it('exits on a breakdown below the prior low', () => {
    const c = [...candles(30, 100, 0), { o: 50, c: 50, h: 51, l: 49, v: 10 }];
    const r = BOT_TYPES.breakout.step({ bot: bot('breakout', { period: 20 }, { inPosition: true, positionQty: 2 }), candles: c, price: 50 });
    expect(r.orders[0].side).toBe('sell');
  });
});

describe('Copy bot', () => {
  it('scales mirrored orders to the allocation and caps per trade', () => {
    const r = BOT_TYPES.copy.step({
      bot: bot('copy', { allocationPct: 10, maxPerTradePct: 2 }, {}),
      sourceTrades: [{ side: 'buy', price: 100, weight: 1, source: 'whale.eth' }],
      equity: 10000,
      price: 100
    });
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].qty).toBe(2); // capped at 2% of 10000 = 200 → 2 units
    expect(r.orders[0].reason).toMatch(/whale\.eth/);
  });

  it('waits when the source is quiet', () => {
    const r = BOT_TYPES.copy.step({ bot: bot('copy', {}, {}), sourceTrades: [], equity: 1000, price: 100 });
    expect(r.notes[0]).toMatch(/Waiting for source/);
  });
});

describe('custom strategies', () => {
  it('ANDs conditions together', () => {
    const ctx = { closes: [...Array(30).fill(100), 60], candles: candles(31), price: 60 };
    const both = evaluateConditions([{ field: 'price', op: 'lt', value: 100 }, { field: 'rsi', op: 'lt', value: 50 }], ctx);
    expect(both.allTrue).toBe(true);
    expect(both.summary).toMatch(/AND/);

    const oneFails = evaluateConditions([{ field: 'price', op: 'gt', value: 100 }, { field: 'rsi', op: 'lt', value: 50 }], ctx);
    expect(oneFails.allTrue).toBe(false);
  });

  it('reports an unavailable indicator instead of assuming a match', () => {
    const r = evaluateConditions([{ field: 'rsi', op: 'lt', value: 30 }], { closes: [1, 2], candles: [], price: 1 });
    expect(r.allTrue).toBe(false);
    expect(r.results[0].detail).toMatch(/unavailable/);
  });

  it('runs entry and exit rules against real candle history', () => {
    // The bot derives indicators from CANDLES, not from any pre-computed series.
    const falling = candles(40, 200, -3);   // monotonic decline → RSI 0
    const rising = candles(40, 100, 3);     // monotonic rise → RSI 100

    const entry = BOT_TYPES.custom.step({
      bot: bot('custom', {}, {}, { entry: [{ field: 'rsi', op: 'lt', value: 30 }], exit: [] }),
      candles: falling, price: 90
    });
    expect(entry.orders).toHaveLength(1);
    expect(entry.orders[0].side).toBe('buy');

    const noEntry = BOT_TYPES.custom.step({
      bot: bot('custom', {}, {}, { entry: [{ field: 'rsi', op: 'lt', value: 30 }], exit: [] }),
      candles: rising, price: 220
    });
    expect(noEntry.orders).toHaveLength(0);

    const exit = BOT_TYPES.custom.step({
      bot: bot('custom', {}, { inPosition: true, positionQty: 1 }, { entry: [], exit: [{ field: 'rsi', op: 'gt', value: 70 }] }),
      candles: rising, price: 220
    });
    expect(exit.orders).toHaveLength(1);
    expect(exit.orders[0].side).toBe('sell');
  });

  it('exposes fields and operators for the builder UI', () => {
    expect(CONDITION_FIELDS.length).toBeGreaterThan(4);
    expect(CONDITION_OPS.map((o) => o.id)).toContain('lt');
  });
});

describe('runBotTick orchestration', () => {
  it('runs a bot and applies risk controls on top', () => {
    const r = runBotTick(bot('dca', { amountQuote: 100000, everyBars: 1 }, {}), { price: 100, barIndex: 0, equity: 1000, cash: 1000, positionValue: 0, positionQty: 0 });
    // Wanted 1000 units; risk must cap it.
    expect(r.orders.length).toBeLessThanOrEqual(1);
    expect(r.notes.some((n) => /Blocked|cap/i.test(n)) || r.orders[0].qty < 1000).toBe(true);
  });

  it('tracks the paper position across ticks', () => {
    const r1 = runBotTick(bot('twap', { totalQty: 4, slices: 2, everyBars: 1, side: 'buy' }, {}), { price: 100, barIndex: 0, equity: 100000, cash: 100000, positionValue: 0, positionQty: 0 });
    expect(r1.state.positionQty).toBe(2);
    const r2 = runBotTick(bot('twap', { totalQty: 4, slices: 2, everyBars: 1, side: 'buy' }, r1.state), { price: 100, barIndex: 1, equity: 100000, cash: 100000, positionValue: 0, positionQty: 2 });
    expect(r2.state.positionQty).toBe(4);
  });

  it('reports an unknown bot type instead of throwing', () => {
    const r = runBotTick({ type: 'nope', params: {}, state: {} }, { price: 1 });
    expect(r.orders).toEqual([]);
    expect(r.notes[0]).toMatch(/Unknown bot type/);
  });
});

describe('strategy marketplace', () => {
  it('lists installable strategies with real metadata', () => {
    expect(MARKETPLACE.length).toBeGreaterThanOrEqual(8);
    MARKETPLACE.forEach((m) => {
      expect(m.id).toMatch(/^mk-/);
      expect(BOT_TYPES[m.botType], `${m.id} botType`).toBeDefined();
      expect(RISK_BADGE[m.risk], `${m.id} risk`).toBeDefined();
      expect(m.blurb.length).toBeGreaterThan(20);
      expect(typeof m.subscribers).toBe('number');
    });
  });

  it('marks every marketplace preset risk clearly', () => {
    expect(MARKETPLACE.some((m) => m.risk === 'low')).toBe(true);
    expect(MARKETPLACE.some((m) => m.risk === 'high')).toBe(true);
  });

  it('validates every bot type has params, a blurb and a group', () => {
    Object.values(BOT_TYPES).forEach((b) => {
      expect(Array.isArray(b.params)).toBe(true);
      expect(b.blurb.length).toBeGreaterThan(20);
      expect(b.group).toBeTruthy();
      expect(typeof b.step).toBe('function');
    });
  });
});

describe('default risk limits', () => {
  it('is a complete, conservative set', () => {
    expect(DEFAULT_RISK.maxPositionPct).toBeLessThanOrEqual(50);
    expect(DEFAULT_RISK.maxDrawdownPct).toBeLessThanOrEqual(30);
    ['maxPositionPct', 'maxOrderQuote', 'maxDrawdownPct', 'dailyLossPct', 'maxTradesPerDay'].forEach((k) => {
      expect(typeof DEFAULT_RISK[k]).toBe('number');
    });
  });
});
