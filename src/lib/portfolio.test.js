import { describe, it, expect } from 'vitest';
import {
  normaliseTx, buildLots, positions, annualised, allocation, venueAllocation,
  pnlCalendar, calendarGrid, taxLots, riskMetrics, equityRisk, buildPortfolio
} from './portfolio.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 5); // 5 Jan 2026

const tx = (over) => ({ id: `${over.coinId}-${over.at}-${over.side}`, ...over });

describe('transactions', () => {
  it('normalises and rejects malformed rows', () => {
    expect(normaliseTx({ coinId: 'bitcoin', side: 'buy', amount: '2', price: '10' })).toMatchObject({
      coinId: 'bitcoin', side: 'buy', amount: 2, price: 10, fee: 0
    });
    expect(normaliseTx({ coinId: 'bitcoin', side: 'nonsense', amount: 1 })).toBeNull();
    expect(normaliseTx({ coinId: 'bitcoin', side: 'buy', amount: 0 })).toBeNull();
    expect(normaliseTx(null)).toBeNull();
  });
});

describe('FIFO lots and realized P&L', () => {
  it('realises a gain against the OLDEST lot first', () => {
    const { disposals, realizedByCoin } = buildLots([
      tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, at: T0 }),
      tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 200, at: T0 + DAY }),
      tx({ coinId: 'bitcoin', side: 'sell', amount: 1, price: 300, at: T0 + 2 * DAY })
    ]);
    expect(disposals).toHaveLength(1);
    // FIFO → the 100 lot is consumed, not the 200 lot.
    expect(disposals[0].costBasis).toBe(100);
    expect(disposals[0].proceeds).toBe(300);
    expect(disposals[0].gain).toBe(200);
    expect(realizedByCoin.bitcoin.gain).toBe(200);
  });

  it('splits one sell across several lots when needed', () => {
    const { disposals } = buildLots([
      tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, at: T0 }),
      tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 300, at: T0 + DAY }),
      tx({ coinId: 'bitcoin', side: 'sell', amount: 1.5, price: 400, at: T0 + 2 * DAY })
    ]);
    expect(disposals[0].costBasis).toBe(1 * 100 + 0.5 * 300); // 250
    expect(disposals[0].gain).toBe(600 - 250); // 350
    expect(disposals[0].consumed).toHaveLength(2);
  });

  it('adds buy fees to cost and deducts sell fees from proceeds', () => {
    const { disposals, lotsByCoin } = buildLots([
      tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, fee: 5, at: T0 }),
      tx({ coinId: 'bitcoin', side: 'sell', amount: 1, price: 200, fee: 10, at: T0 + DAY })
    ]);
    // Lot unit cost includes the fee, and the sell fee reduces proceeds.
    expect(lotsByCoin).toEqual({});
    const remaining = buildLots([tx({ coinId: 'bitcoin', side: 'buy', amount: 2, price: 100, fee: 20, at: T0 })]);
    expect(remaining.lotsByCoin.bitcoin[0].unitCost).toBe(100); // fee tracked separately per lot
    expect(disposals[0].proceeds).toBeCloseTo(190, 6);
  });

  it('tracks the holding period for tax terms', () => {
    const { disposals } = buildLots([
      tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, at: T0 }),
      tx({ coinId: 'bitcoin', side: 'sell', amount: 1, price: 200, at: T0 + 400 * DAY })
    ]);
    expect(disposals[0].holdingDays).toBe(400);
    expect(disposals[0].longTerm).toBe(true);
  });

  it('flags an oversell instead of inventing units', () => {
    const { disposals, warnings } = buildLots([
      tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, at: T0 }),
      tx({ coinId: 'bitcoin', side: 'sell', amount: 5, price: 200, at: T0 + DAY })
    ]);
    expect(warnings.some((w) => w.kind === 'oversold')).toBe(true);
    // Only the 1 unit actually held is disposed of.
    expect(disposals[0].amount).toBe(1);
  });

  it('flags a transfer in with no stated basis rather than assuming a price', () => {
    const { warnings, lotsByCoin } = buildLots([
      tx({ coinId: 'bitcoin', side: 'transfer_in', amount: 1, at: T0 })
    ]);
    expect(warnings.some((w) => w.kind === 'transfer_without_basis')).toBe(true);
    expect(lotsByCoin.bitcoin[0].unitCost).toBe(0);
  });

  it('does not realise a gain on a transfer out', () => {
    const { disposals, realizedByCoin } = buildLots([
      tx({ coinId: 'bitcoin', side: 'buy', amount: 2, price: 100, at: T0 }),
      tx({ coinId: 'bitcoin', side: 'transfer_out', amount: 1, at: T0 + DAY })
    ]);
    expect(realizedByCoin.bitcoin).toBeUndefined();
    expect(disposals[0].proceeds).toBeNull();
    expect(disposals[0].gain).toBeNull();
  });

  it('orders transactions by time regardless of input order', () => {
    const { realizedByCoin } = buildLots([
      tx({ coinId: 'bitcoin', side: 'sell', amount: 1, price: 300, at: T0 + 2 * DAY }),
      tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, at: T0 })
    ]);
    expect(realizedByCoin.bitcoin.gain).toBe(200); // bought at 100, not 300
  });
});

describe('positions', () => {
  const history = [
    tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, at: T0 }),
    tx({ coinId: 'ethereum', side: 'buy', amount: 10, price: 10, at: T0 })
  ];

  it('computes cost basis, average entry, unrealized P&L and ROI', () => {
    const { positions: list, totals } = positions(history, { bitcoin: 150, ethereum: 8 });
    const btc = list.find((p) => p.coinId === 'bitcoin');
    expect(btc.amount).toBe(1);
    expect(btc.costBasis).toBe(100);
    expect(btc.avgEntry).toBe(100);
    expect(btc.value).toBe(150);
    expect(btc.unrealized).toBe(50);
    expect(btc.unrealizedPct).toBeCloseTo(50, 6);

    const eth = list.find((p) => p.coinId === 'ethereum');
    expect(eth.unrealized).toBe(-20);
    expect(eth.unrealizedPct).toBeCloseTo(-20, 6);

    expect(totals.value).toBe(230);
    expect(totals.costBasis).toBe(200);
    expect(totals.unrealized).toBe(30);
    expect(totals.roiPct).toBeCloseTo(15, 6);
  });

  it('marks unpriced positions instead of valuing them at zero', () => {
    const { positions: list, totals } = positions(history, { bitcoin: 150 });
    const eth = list.find((p) => p.coinId === 'ethereum');
    expect(eth.priced).toBe(false);
    expect(eth.value).toBeNull();
    expect(eth.unrealized).toBeNull();
    expect(totals.pricedAll).toBe(false);
    expect(totals.value).toBe(150); // only the priced position contributes
  });

  it('includes realized P&L in the total and drops the fully-sold position', () => {
    const { positions: list, totals } = positions([
      ...history,
      tx({ coinId: 'bitcoin', side: 'sell', amount: 1, price: 400, at: T0 + DAY })
    ], { bitcoin: 150, ethereum: 8 });

    // BTC was fully disposed of, so it is no longer an open position.
    expect(list.find((p) => p.coinId === 'bitcoin')).toBeUndefined();
    expect(totals.realized).toBe(300);   // sold 400, basis 100
    expect(totals.unrealized).toBe(-20); // ETH only: 80 value vs 100 basis
    expect(totals.totalPnl).toBe(280);
  });

  it('computes portfolio weights that sum to 100%', () => {
    const { positions: list } = positions(history, { bitcoin: 150, ethereum: 50 });
    const sum = list.reduce((a, p) => a + p.weightPct, 0);
    expect(sum).toBeCloseTo(100, 6);
  });
});

describe('annualised return', () => {
  it('is not annualisable inside a day', () => {
    expect(annualised({ roiPct: 10, days: 0 }).annualisable).toBe(false);
    expect(annualised({ roiPct: 10, days: null }).apy).toBeNull();
  });

  it('scales linearly for APR and compounds for APY', () => {
    const r = annualised({ roiPct: 10, days: 182.5 });
    expect(r.apr).toBeCloseTo(20, 6);
    expect(r.apy).toBeCloseTo((Math.pow(1.1, 2) - 1) * 100, 6); // 21%
  });

  it('returns no APY when a loss exceeds 100%', () => {
    const r = annualised({ roiPct: -120, days: 30 });
    expect(r.apr).toBeCloseTo(-1460, 6);
    expect(r.apy).toBeNull(); // compounding an impossible negative balance
  });
});

describe('allocation', () => {
  const list = [
    { coinId: 'bitcoin', value: 600, costBasis: 500 },
    { coinId: 'ethereum', value: 400, costBasis: 500 }
  ];

  it('groups by an arbitrary key with weights and ROI', () => {
    const { rows, total } = allocation(list, (p) => (p.coinId === 'bitcoin' ? 'Bitcoin' : 'Ethereum'));
    expect(total).toBe(1000);
    expect(rows[0].key).toBe('Bitcoin');
    expect(rows[0].weightPct).toBeCloseTo(60, 6);
    expect(rows[1].roiPct).toBeCloseTo(-20, 6);
  });

  it('allocates custody by LOT, so one coin on two venues is split', () => {
    const { lotsByCoin } = buildLots([
      tx({ coinId: 'dogecoin', side: 'buy', amount: 100, price: 1, at: T0, venue: 'binance' }),
      tx({ coinId: 'dogecoin', side: 'buy', amount: 100, price: 1, at: T0 + DAY, venue: 'kraken' })
    ]);
    const { rows } = venueAllocation(lotsByCoin, { dogecoin: 2 });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.key === 'binance').value).toBe(200);
    expect(rows.find((r) => r.key === 'kraken').value).toBe(200);
    expect(rows.every((r) => r.weightPct === 50)).toBe(true);
  });

  it('labels lots with no venue as Unassigned', () => {
    const { lotsByCoin } = buildLots([tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 10, at: T0 })]);
    expect(venueAllocation(lotsByCoin, { bitcoin: 10 }).rows[0].key).toBe('Unassigned');
  });
});

describe('profit/loss calendar', () => {
  const disposals = [
    { side: 'sell', at: Date.UTC(2026, 2, 10), gain: 100, proceeds: 500, costBasis: 400 },
    { side: 'sell', at: Date.UTC(2026, 2, 10), gain: -40, proceeds: 100, costBasis: 140 },
    { side: 'sell', at: Date.UTC(2026, 2, 12), gain: 25, proceeds: 200, costBasis: 175 },
    { side: 'sell', at: Date.UTC(2026, 3, 1), gain: 999, proceeds: 1, costBasis: -998 }
  ];

  it('aggregates realized P&L per day and per month', () => {
    const { days, monthly } = pnlCalendar(disposals, { year: 2026, month: 2 });
    expect(days['2026-03-10'].gain).toBe(60);
    expect(days['2026-03-10'].count).toBe(2);
    expect(days['2026-03-12'].gain).toBe(25);
    expect(days['2026-04-01']).toBeUndefined(); // filtered out by month
    expect(monthly.gain).toBe(85);
    expect(monthly.count).toBe(3);
  });

  it('skips disposals with no computable gain', () => {
    const { days } = pnlCalendar([{ side: 'sell', at: T0, gain: null }]);
    expect(Object.keys(days)).toHaveLength(0);
  });

  it('lays a month out Monday-first with padding', () => {
    const grid = calendarGrid(2026, 2); // March 2026 starts on a Sunday
    expect(grid.length % 7).toBe(0);
    expect(grid[6].day).toBe(1); // first Monday-first slot index for 1 March
    expect(grid.filter(Boolean)).toHaveLength(31);
  });
});

describe('tax lots', () => {
  it('lists only sells, newest first, with term classification', () => {
    const { disposals } = buildLots([
      tx({ coinId: 'bitcoin', side: 'buy', amount: 2, price: 100, at: T0 }),
      tx({ coinId: 'bitcoin', side: 'sell', amount: 1, price: 150, at: T0 + 10 * DAY }),
      tx({ coinId: 'bitcoin', side: 'sell', amount: 1, price: 400, at: T0 + 400 * DAY })
    ]);
    const lots = taxLots(disposals);
    expect(lots).toHaveLength(2);
    expect(lots[0].term).toBe('long'); // newest first
    expect(lots[1].term).toBe('short');
    expect(lots[0].gain).toBe(300);
  });
});

describe('risk', () => {
  it('computes concentration from the Herfindahl index', () => {
    const one = riskMetrics([{ coinId: 'bitcoin', symbol: 'BTC', value: 100, weightPct: 100 }]);
    expect(one.hhi).toBeCloseTo(1, 6);
    expect(one.effectivePositions).toBeCloseTo(1, 6);
    expect(one.concentrationLabel).toBe('highly concentrated');
    expect(one.top1).toBe('BTC');

    const spread = riskMetrics([
      { coinId: 'a', symbol: 'A', value: 250, weightPct: 25 },
      { coinId: 'b', symbol: 'B', value: 250, weightPct: 25 },
      { coinId: 'c', symbol: 'C', value: 250, weightPct: 25 },
      { coinId: 'd', symbol: 'D', value: 250, weightPct: 25 }
    ]);
    expect(spread.hhi).toBeCloseTo(0.25, 6);
    expect(spread.effectivePositions).toBeCloseTo(4, 6);
    expect(spread.top3Pct).toBeCloseTo(75, 6);
    expect(spread.concentrationLabel).toBe('concentrated');
  });

  it('reports volatility coverage honestly when coins lack history', () => {
    const r = riskMetrics(
      [
        { coinId: 'a', symbol: 'A', value: 100, weightPct: 100 }
      ],
      { returnsByCoin: { b: [0.01, 0.02, 0.03] } }
    );
    expect(r.weightedDailyVolPct).toBeNull();
    expect(r.volCoveragePct).toBe(0);
  });

  it('weights per-coin volatility by position size', () => {
    const r = riskMetrics(
      [
        { coinId: 'a', symbol: 'A', value: 50, weightPct: 50 },
        { coinId: 'b', symbol: 'B', value: 50, weightPct: 50 }
      ],
      { returnsByCoin: { a: [0.01, -0.01, 0.01, -0.01], b: [0.02, -0.02, 0.02, -0.02] } }
    );
    expect(r.weightedDailyVolPct).toBeGreaterThan(0);
    expect(r.volCoveragePct).toBeCloseTo(100, 6);
  });
});

describe('equity curve risk', () => {
  it('finds the maximum drawdown from the running peak', () => {
    const r = equityRisk([
      { t: 1, v: 100 }, { t: 2, v: 150 }, { t: 3, v: 120 }, { t: 4, v: 90 }, { t: 5, v: 130 }
    ]);
    expect(r.maxDrawdownPct).toBeCloseTo(-40, 6); // 150 → 90
    expect(r.peak).toBe(150);
    expect(r.currentDrawdownPct).toBeCloseTo(-13.3333, 3); // 150 → 130
    expect(r.changePct).toBeCloseTo(30, 6); // 100 → 130
  });

  it('reports insufficient history rather than a fake number', () => {
    expect(equityRisk([{ t: 1, v: 100 }]).insufficient).toBe(true);
    expect(equityRisk([]).maxDrawdownPct).toBeNull();
  });
});

describe('buildPortfolio', () => {
  it('assembles every section in one pass', () => {
    const out = buildPortfolio({
      transactions: [
        tx({ coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, at: T0, venue: 'binance' }),
        tx({ coinId: 'ethereum', side: 'buy', amount: 2, price: 50, at: T0, venue: 'kraken' })
      ],
      priceById: { bitcoin: 200, ethereum: 40 },
      metaById: { bitcoin: { symbol: 'BTC', name: 'Bitcoin' }, ethereum: { symbol: 'ETH', name: 'Ethereum' } },
      chainOf: (id) => (id === 'bitcoin' ? 'Bitcoin' : 'Ethereum'),
      venueLabelOf: (v) => v,
      equitySeries: [{ t: 1, v: 100 }, { t: 2, v: 120 }]
    });
    // `totals` must be the PORTFOLIO totals, not the lot/realized totals.
    expect(out.totals.value).toBe(280);
    expect(out.totals.positions).toBe(2);
    expect(out.realizedTotals.realized).toBe(0);
    expect(out.byChain.rows).toHaveLength(2);
    expect(out.byVenue.rows).toHaveLength(2);
    expect(out.tax).toEqual([]);
    expect(out.equity.changePct).toBeCloseTo(20, 6);
    expect(out.risk.top1).toBe('BTC');
  });
});
