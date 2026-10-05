import { describe, it, expect } from 'vitest';
import {
  INTENTS, ACTION_INTENTS, intentById, classify, extractEntities, findAsset,
  marketSummary, tokenExplain, technicalAnalysis, fundamentalAnalysis,
  portfolioAnalysis, riskAnalysis, proposeAction, answer, capabilityMap
} from './analyst.js';
import {
  normaliseTitle, titleSimilarity, dedupeStories, scoreSentiment, attributeSource,
  qualityScore, processFeed, NEWS_CAPABILITIES
} from './newsOps.js';

const NOW = Date.UTC(2026, 9, 5);
const rows = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 100000, pct24: 2.5, pct7d: -1.2, mcap: 2e12, vol: 4e10, rsi: 22, ath: 120000, fdv: 2.1e12, circulating: 19e6, total: 21e6, rank: 1 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 4000, pct24: -3.1, pct7d: 4, mcap: 5e11, vol: 2e10, rsi: 78 }
];

describe('intent catalogue', () => {
  it('gives every intent a label, an action flag and a data need', () => {
    INTENTS.forEach((i) => {
      expect(i.label.length).toBeGreaterThan(3);
      expect(typeof i.action).toBe('boolean');
      expect(typeof i.needs).toBe('string');
    });
  });

  it('separates state-changing intents from read-only ones', () => {
    expect(ACTION_INTENTS).toContain('create_alert');
    expect(ACTION_INTENTS).toContain('generate_bot');
    expect(ACTION_INTENTS).not.toContain('market_summary');
    expect(intentById('nope')).toBeNull();
  });

  it('maps every intent to a UI status', () => {
    const map = capabilityMap();
    expect(map).toHaveLength(INTENTS.length);
    map.forEach((m) => expect(['supported', 'no-source', 'action']).toContain(m.status));
    // Whale analysis has no keyless source and must be marked as such.
    expect(map.find((m) => m.id === 'whale_analysis').status).toBe('no-source');
    expect(map.find((m) => m.id === 'create_alert').status).toBe('action');
  });
});

describe('classification', () => {
  it('routes action phrases to action intents', () => {
    expect(classify('alert me when BTC is above 120k').intent).toBe('create_alert');
    expect(classify('build me a grid bot').intent).toBe('generate_bot');
    expect(classify('backtest my strategy').intent).toBe('backtest');
  });

  it('routes analysis phrases to read intents', () => {
    expect(classify('how is the market doing').intent).toBe('market_summary');
    expect(classify('what is ethereum').intent).toBe('token_explain');
    expect(classify('get rsi for BTC').intent).toBe('technical_analysis');
    expect(classify('show me the top coins').intent).toBe('search');
  });

  it('prefers the more specific rule when phrases overlap', () => {
    // "create an alert" also contains "alert" but must not fall through to search.
    expect(classify('create an alert for ETH below 2000').intent).toBe('create_alert');
    // "bot" precedes "strategy" in the rule order.
    expect(classify('build a dca bot for BTC').intent).toBe('generate_bot');
  });

  it('returns no intent for an unparseable query', () => {
    const c = classify('lorem ipsum dolor');
    expect(c.intent).toBeNull();
    expect(c.confidence).toBe(0);
    expect(c.reason).toMatch(/No matching intent/);
  });

  it('handles an empty query without throwing', () => {
    expect(classify('').intent).toBeNull();
    expect(classify(null).intent).toBeNull();
  });
});

describe('entity extraction', () => {
  it('resolves a symbol through its aliases', () => {
    expect(extractEntities('what is bitcoin doing').symbol).toBe('BTC');
    expect(extractEntities('rsi for eth').symbol).toBe('ETH');
    expect(extractEntities('solana trend').symbol).toBe('SOL');
  });

  it('extracts an address and a transaction hash', () => {
    const a = extractEntities('check 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(a.address).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    const tx = extractEntities(`explain 0x${'a'.repeat(64)}`);
    expect(tx.txHash).toHaveLength(66);
  });

  it('scales a threshold suffix', () => {
    expect(extractEntities('alert me above 120k').threshold).toBe(120000);
    expect(extractEntities('alert me above 2m').threshold).toBe(2000000);
    expect(extractEntities('alert at 4500').threshold).toBe(4500);
  });

  it('detects direction', () => {
    expect(extractEntities('alert when BTC drops below 90k').direction).toBe('below');
    expect(extractEntities('alert when BTC breaks above 120k').direction).toBe('above');
  });
});

describe('analyzers', () => {
  it('summarises the market', () => {
    const r = marketSummary(rows, { mcap: 3e12 });
    const lines = r.blocks[0].lines.join(' ');
    expect(lines).toMatch(/2 assets tracked/);
    expect(lines).toMatch(/1 up and 1 down/);
    expect(lines).toMatch(/Top gainer: BTC/);
    expect(lines).toMatch(/Top loser: ETH/);
  });

  it('says so when there is no market data', () => {
    expect(marketSummary([]).blocks[0].lines[0]).toMatch(/No market data/);
  });

  it('explains a token with its distance from ATH', () => {
    const block = tokenExplain(rows[0]).blocks[0];
    expect(block.title).toMatch(/Bitcoin/);
    expect(block.lines.join(' ')).toMatch(/-16\.67%/); // 100000 vs 120000, 2dp
  });

  it('reads RSI bands correctly', () => {
    expect(technicalAnalysis(rows[0]).blocks[0].lines.join(' ')).toMatch(/oversold/);
    expect(technicalAnalysis(rows[1]).blocks[0].lines.join(' ')).toMatch(/overbought/);
  });

  it('reports the FDV to market-cap ratio', () => {
    expect(fundamentalAnalysis(rows[0]).blocks[0].lines.join(' ')).toMatch(/FDV/);
    expect(fundamentalAnalysis(rows[1]).blocks[0].lines.join(' ')).toMatch(/not available/);
  });

  it('analyses a portfolio and its risk', () => {
    const portfolio = {
      positions: [{ symbol: 'BTC', weightPct: 80 }],
      totals: { value: 1000, costBasis: 800, unrealized: 200, realized: 0, roiPct: 25 },
      risk: { hhi: 0.64, top1Pct: 80, weightedVolPct: 55, coveragePct: 100, maxDrawdownPct: 12 }
    };
    expect(portfolioAnalysis(portfolio).blocks[0].lines.join(' ')).toMatch(/ROI 25.00%/);
    const risk = riskAnalysis(portfolio).blocks[0].lines.join(' ');
    expect(risk).toMatch(/highly concentrated/);
    // It must admit correlation is not modelled.
    expect(riskAnalysis(portfolio).blocks[0].evidence).toMatch(/correlation is NOT modelled/i);
  });

  it('handles an empty portfolio gracefully', () => {
    expect(portfolioAnalysis(null).blocks[0].lines[0]).toMatch(/No open positions/);
    expect(riskAnalysis(null).blocks[0].lines[0]).toMatch(/No positions/);
  });
});

describe('action safety', () => {
  it('never executes an action — it only proposes one', () => {
    const p = proposeAction('create_alert', { symbol: 'BTC', direction: 'above', threshold: 120000 });
    expect(p.requiresConfirmation).toBe(true);
    expect(p.safety).toMatch(/nothing is created until you explicitly confirm/i);
    expect(p.summary).toMatch(/BTC/);
    expect(p.payload.threshold).toBe(120000);
  });

  it('returns no proposal for a read-only intent', () => {
    expect(proposeAction('market_summary', {})).toBeNull();
  });

  it('attaches a confirmation gate to every action answer', () => {
    const a = answer('alert me when BTC is above 120k', { rows });
    expect(a.intent).toBe('create_alert');
    expect(a.proposal).not.toBeNull();
    expect(a.proposal.requiresConfirmation).toBe(true);
  });
});

describe('answer assembly', () => {
  it('disclaims being model-generated on every answer', () => {
    const a = answer('how is the market', { rows });
    expect(a.disclaimer).toMatch(/No language model/i);
    expect(a.disclaimer).toMatch(/not investment advice/i);
  });

  it('refuses to guess for an intent with no source', () => {
    const a = answer('show me whale wallets', { rows });
    expect(a.intent).toBe('whale_analysis');
    expect(a.blocks[0].title).toMatch(/Not answerable/);
    expect(a.blocks[0].lines.join(' ')).toMatch(/will not guess|no keyless source|no source/i);
    expect(a.proposal).toBeNull();
  });

  it('returns a capability-boundary block for an unparseable query', () => {
    const a = answer('lorem ipsum', { rows });
    expect(a.intent).toBeNull();
    expect(a.blocks[0].title).toMatch(/Not answerable/);
  });

  it('carries evidence on every computed block', () => {
    ['how is the market', 'what is bitcoin', 'rsi for eth'].forEach((q) => {
      const a = answer(q, { rows, portfolio: null });
      a.blocks.forEach((b) => expect(b.evidence, q).toBeTruthy());
    });
  });
});

/* ------------------------------ news ------------------------------ */

describe('duplicate detection', () => {
  it('normalises a headline to meaningful tokens', () => {
    const t = normaliseTitle('Bitcoin SURGES past $100,000 amid ETF approval');
    expect(t).toContain('bitcoin');
    expect(t).toContain('surges');
    expect(t).not.toContain('the');
    expect(t).not.toContain('amid');
  });

  it('scores identical headlines as 1 and disjoint ones as 0', () => {
    expect(titleSimilarity('Bitcoin surges to a record high', 'Bitcoin surges to a record high')).toBe(1);
    expect(titleSimilarity('Bitcoin surges to a record high', 'Ethereum fees decline sharply')).toBe(0);
  });

  it('collapses a republished wire story and keeps the best-attributed copy', () => {
    const items = [
      { title: 'Bitcoin surges past 100000 on ETF approval', source: 'Wire' },
      { title: 'Bitcoin surges past 100000 on ETF approval', source: 'Outlet', url: 'https://x', createdAt: 1 },
      { title: 'Ethereum fees decline sharply after upgrade', source: 'Wire' }
    ];
    const r = dedupeStories(items);
    expect(r.input).toBe(3);
    expect(r.unique).toBe(2);
    expect(r.removed).toBe(1);
    const cluster = r.clusters.find((c) => c.duplicates === 1);
    // The copy carrying a link and a timestamp wins.
    expect(cluster.lead.url).toBe('https://x');
    expect(cluster.alsoSeenAt).toContain('Wire');
  });

  it('states that paraphrase can still slip through', () => {
    expect(dedupeStories([]).method).toMatch(/human editor/i);
  });

  it('handles an empty feed', () => {
    const r = dedupeStories([]);
    expect(r.unique).toBe(0);
    expect(r.clusters).toEqual([]);
  });
});

describe('sentiment lexicon', () => {
  it('scores positive and negative headlines in opposite directions', () => {
    expect(scoreSentiment('Bitcoin surges to a record high').label).toBe('positive');
    expect(scoreSentiment('Exchange hacked, funds lost in exploit').label).toBe('negative');
    expect(scoreSentiment('Token trading volume was unchanged').label).toBe('neutral');
  });

  it('flips a term behind a negator', () => {
    expect(scoreSentiment('analysts are not bullish').score).toBeLessThan(0);
  });

  it('records which words drove the score', () => {
    const r = scoreSentiment('Bitcoin rally continues with gains');
    expect(r.hits.map((h) => h.word)).toContain('rally');
    expect(r.hits.every((h) => h.polarity === 'positive')).toBe(true);
  });

  it('admits it is a lexicon, not a model', () => {
    expect(scoreSentiment('anything').method).toMatch(/does not understand sarcasm/i);
  });
});

describe('quality heuristics', () => {
  const good = { title: 'Bitcoin ETF sees record inflows', source: 'Reuters', url: 'https://r', createdAt: Math.floor(NOW / 1000) - 3600 };

  it('rewards attribution, a link and a recent timestamp', () => {
    expect(qualityScore(good, { now: NOW }).band).toBe('high');
    expect(qualityScore(good, { now: NOW }).flags).toEqual([]);
  });

  it('penalises missing attribution and a missing link', () => {
    const r = qualityScore({ title: 'Something happened in markets today' }, { now: NOW });
    expect(r.flags.map((f) => f.code)).toContain('unattributed');
    expect(r.flags.map((f) => f.code)).toContain('no-link');
    expect(r.score).toBeLessThan(60);
  });

  it('penalises clickbait and all-caps headlines', () => {
    const bait = qualityScore({ title: 'You won\'t believe this 100x altcoin', source: 'X', url: 'u', createdAt: NOW / 1000 }, { now: NOW });
    expect(bait.flags.map((f) => f.code)).toContain('clickbait');
    const caps = qualityScore({ title: 'BITCOIN IS GOING TO THE MOON RIGHT NOW', source: 'X', url: 'u', createdAt: NOW / 1000 }, { now: NOW });
    expect(caps.flags.map((f) => f.code)).toContain('all-caps');
  });

  it('flags a stale story', () => {
    const old = qualityScore({ ...good, createdAt: Math.floor((NOW - 40 * 86400000) / 1000) }, { now: NOW });
    expect(old.flags.map((f) => f.code)).toContain('stale');
  });

  it('states plainly that it is not fact-checking', () => {
    expect(qualityScore(good, { now: NOW }).method).toMatch(/NOT fact-checking/i);
    expect(qualityScore(good, { now: NOW }).score).toBeLessThanOrEqual(100);
  });
});

describe('source attribution', () => {
  it('names the source when present and marks it when absent', () => {
    expect(attributeSource({ source: { title: 'CoinDesk' } }).name).toBe('CoinDesk');
    expect(attributeSource({ author: 'Alice' }).name).toBe('Alice');
    const none = attributeSource({});
    expect(none.attributed).toBe(false);
    expect(none.name).toBe('Unattributed');
  });
});

describe('feed processing', () => {
  it('enriches, scores and de-duplicates in one pass', () => {
    const feed = [
      { title: 'Bitcoin surges to a record high', source: 'Reuters', url: 'u1', createdAt: Math.floor(NOW / 1000) },
      { title: 'Bitcoin surges to a record high', source: 'Copy' },
      { title: 'Exchange hacked in major exploit', source: 'Blog' }
    ];
    const r = processFeed(feed, { now: NOW });
    expect(r.stats.input).toBe(3);
    expect(r.stats.unique).toBe(2);
    expect(r.stats.duplicatesRemoved).toBe(1);
    expect(r.stats.positive).toBeGreaterThanOrEqual(1);
    expect(r.stats.negative).toBeGreaterThanOrEqual(1);
    r.items.forEach((i) => {
      expect(i.sentiment).toBeTruthy();
      expect(i.quality).toBeTruthy();
      expect(i.source).toBeTruthy();
    });
    expect(r.notes.join(' ')).toMatch(/lexicon-based/i);
  });

  it('handles an empty feed', () => {
    const r = processFeed([]);
    expect(r.items).toEqual([]);
    expect(r.stats.unique).toBe(0);
  });
});

describe('news capability honesty', () => {
  it('marks regulatory, hack and governance coverage unavailable with reasons', () => {
    ['regulatory', 'hacks', 'governance'].forEach((id) => {
      const c = NEWS_CAPABILITIES.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(c.status).toBe('unavailable');
      expect(c.note.length).toBeGreaterThan(20);
    });
  });

  it('labels summaries as computed rather than model-generated', () => {
    const s = NEWS_CAPABILITIES.find((c) => c.id === 'summaries');
    expect(s.note).toMatch(/computed, not model-generated/i);
  });
});
