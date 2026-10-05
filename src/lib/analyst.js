/* CryptoX AI — a DETERMINISTIC analyst, not a language model.
 *
 * WHAT THIS IS: a local intent router plus a set of analytical functions that
 * read the app's own data (market rows, portfolio, derivatives, chain data).
 * Every answer is computed, so it is reproducible and auditable.
 *
 * WHAT THIS IS NOT: an LLM. There is no model call, no key and no generation.
 * It does not write prose it cannot justify, which is why every block carries
 * the evidence it was derived from. Anything it cannot compute, it says it
 * cannot compute rather than inventing an answer.
 *
 * ACTION SAFETY: intents that would change state (create an alert, arm a bot,
 * run a backtest) never execute here. They return a PROPOSAL with
 * `requiresConfirmation: true`, and the caller must obtain explicit consent.
 */

/* ---------------- intent catalogue ---------------- */

export const INTENTS = [
  { id: 'market_summary', label: 'Market summary', action: false, needs: 'market' },
  { id: 'token_explain', label: 'Token explanation', action: false, needs: 'asset' },
  { id: 'technical_analysis', label: 'Technical analysis', action: false, needs: 'asset' },
  { id: 'fundamental_analysis', label: 'Fundamental analysis', action: false, needs: 'asset' },
  { id: 'chart_analysis', label: 'Chart analysis', action: false, needs: 'asset' },
  { id: 'portfolio_analysis', label: 'Portfolio analysis', action: false, needs: 'portfolio' },
  { id: 'risk_analysis', label: 'Risk analysis', action: false, needs: 'portfolio' },
  { id: 'onchain_analysis', label: 'On-chain analysis', action: false, needs: 'address' },
  { id: 'transaction_explain', label: 'Transaction explanation', action: false, needs: 'tx' },
  { id: 'smart_contract_explain', label: 'Smart-contract explanation', action: false, needs: 'address' },
  { id: 'wallet_investigation', label: 'Wallet investigation', action: false, needs: 'address' },
  { id: 'whale_analysis', label: 'Whale analysis', action: false, needs: 'none' },
  { id: 'news_analysis', label: 'News analysis', action: false, needs: 'none' },
  { id: 'research_report', label: 'Research report', action: false, needs: 'market' },
  { id: 'search', label: 'Market search', action: false, needs: 'market' },
  { id: 'create_alert', label: 'Create an alert', action: true, needs: 'asset' },
  { id: 'build_strategy', label: 'Build a strategy', action: true, needs: 'asset' },
  { id: 'generate_bot', label: 'Generate a bot', action: true, needs: 'asset' },
  { id: 'backtest', label: 'Run a backtest', action: true, needs: 'asset' },
  { id: 'api_generator', label: 'Generate an API snippet', action: true, needs: 'none' }
];

export const intentById = (id) => INTENTS.find((i) => i.id === id) || null;
export const ACTION_INTENTS = INTENTS.filter((i) => i.action).map((i) => i.id);

/* ---------------- classification ---------------- */

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Ordered rules — the FIRST match wins, so specific phrases precede general ones. */
export const RULES = [
  { id: 'create_alert', words: ['alert me', 'create an alert', 'set an alert', 'notify me', 'alert when', 'price alert'] },
  { id: 'generate_bot', words: ['bot', 'dca bot', 'grid bot', 'automate', 'trading bot'] },
  { id: 'backtest', words: ['backtest', 'back test', 'walk forward', 'historical test'] },
  { id: 'build_strategy', words: ['strategy', 'build a rule', 'entry and exit', 'screener rule'] },
  { id: 'api_generator', words: ['api', 'endpoint', 'curl', 'rest call', 'integration'] },
  { id: 'wallet_investigation', words: ['investigate wallet', 'wallet investigation', 'who owns', 'trace wallet'] },
  { id: 'transaction_explain', words: ['explain tx', 'explain transaction', 'what does this tx', 'transaction 0x'] },
  { id: 'smart_contract_explain', words: ['contract', 'abi', 'what does this contract', 'source code', 'explain 0x'] },
  { id: 'onchain_analysis', words: ['on-chain', 'onchain', 'chain activity', 'gas', 'blocks'] },
  { id: 'whale_analysis', words: ['whale', 'large holder', 'big wallet', 'smart money'] },
  { id: 'portfolio_analysis', words: ['my portfolio', 'my holdings', 'how are my', 'portfolio perform', 'pnl', 'p&l'] },
  { id: 'risk_analysis', words: ['risk', 'drawdown', 'how risky', 'exposure', 'concentration'] },
  { id: 'news_analysis', words: ['news', 'headline', 'announcement', 'sentiment'] },
  { id: 'research_report', words: ['research', 'report on', 'deep dive', 'thesis'] },
  { id: 'technical_analysis', words: ['rsi', 'macd', 'moving average', 'technical', 'indicator', 'support', 'resistance'] },
  { id: 'chart_analysis', words: ['chart', 'candle', 'trend on the chart', 'pattern'] },
  { id: 'fundamental_analysis', words: ['fundamental', 'supply', 'market cap', 'fdv', 'tokenomics', 'unlock'] },
  { id: 'token_explain', words: ['what is', 'explain', 'tell me about', 'about the token'] },
  { id: 'market_summary', words: ['market summary', 'how is the market', 'market overview', 'summary', 'overview'] },
  { id: 'search', words: ['find', 'search', 'show me', 'list', 'top', 'best'] }
];

/** Known symbols, so "BTC" or "bitcoin" resolves to an asset entity. */
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC', 'BCH', 'TRX', 'UNI', 'ARB', 'OP', 'ATOM', 'NEAR', 'APT', 'TON', 'SUI'];
const SYMBOL_WORDS = ['btc', 'bitcoin', 'eth', 'ethereum', 'sol', 'solana', 'bnb', 'xrp', 'ada', 'cardano', 'doge', 'dogecoin', 'avax', 'avalanche', 'dot', 'polkadot', 'link', 'chainlink', 'ltc', 'litecoin', 'trx', 'tron', 'uni', 'uniswap', 'arb', 'arbitrum', 'op', 'optimism', 'atom', 'cosmos', 'near', 'apt', 'aptos', 'ton', 'sui'];

const ALIAS = {
  bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', eth: 'ETH', solana: 'SOL', sol: 'SOL',
  bnb: 'BNB', xrp: 'XRP', cardano: 'ADA', ada: 'ADA', dogecoin: 'DOGE', doge: 'DOGE',
  avalanche: 'AVAX', avax: 'AVAX', polkadot: 'DOT', dot: 'DOT', chainlink: 'LINK', link: 'LINK',
  litecoin: 'LTC', ltc: 'LTC', tron: 'TRX', trx: 'TRX', uniswap: 'UNI', uni: 'UNI',
  arbitrum: 'ARB', arb: 'ARB', optimism: 'OP', op: 'OP', cosmos: 'ATOM', atom: 'ATOM',
  near: 'NEAR', aptos: 'APT', apt: 'APT', ton: 'TON', sui: 'SUI'
};

const ADDRESS_RE = /0x[0-9a-fA-F]{40}/;
const TX_RE = /0x[0-9a-fA-F]{64}/;
const NUMBER_RE = /\$?\s?([\d][\d,_]*(?:\.\d+)?)\s*(k|m|%)?/i;

/** Pull entities out of a query: symbol, address, tx hash, threshold. */
export function extractEntities(query) {
  const q = norm(query);
  const out = { symbol: null, name: null, address: null, txHash: null, threshold: null, direction: null };

  // Extract addresses from the RAW query, not the lowercased copy: lowercasing
  // discards EIP-55 capitalisation, and this app verifies that checksum, so
  // normalising here would silently strip the ability to spot a tampered address.
  const raw = String(query || '');
  const tx = raw.match(TX_RE) || q.match(TX_RE);
  if (tx) out.txHash = tx[0];

  const addr = raw.match(ADDRESS_RE) || q.match(ADDRESS_RE);
  if (addr) out.address = addr[0];

  // Longest alias first so "bitcoin" wins over "btc" inside a longer phrase.
  const tokens = q.split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of tokens) {
    if (ALIAS[t]) { out.name = t; out.symbol = ALIAS[t]; break; }
  }

  const num = q.match(NUMBER_RE);
  if (num && num[1]) {
    let v = parseFloat(num[1].replace(/[,_]/g, ''));
    if (num[2] === 'k') v *= 1000;
    if (num[2] === 'm') v *= 1e6;
    if (Number.isFinite(v)) out.threshold = v;
  }

  if (/\babove\b|\bover\b|\bgreater\b|\bbreaks?\b|\bup\b/.test(q)) out.direction = 'above';
  if (/\bbelow\b|\bunder\b|\bless\b|\bdrops?\b|\bdown\b/.test(q)) out.direction = 'below';

  return out;
}

export function classify(query) {
  const q = norm(query);
  if (!q) return { intent: null, confidence: 0, entities: extractEntities(''), reason: 'Empty query' };

  const hit = RULES.find((r) => r.words.some((w) => q.includes(w)));
  const entities = extractEntities(q);

  if (!hit) {
    // Fall back to search when we at least recognise an asset.
    if (entities.symbol) return { intent: 'search', confidence: 0.4, entities, reason: 'Recognised an asset but not a task — searching.' };
    return { intent: null, confidence: 0, entities, reason: 'No matching intent. Try naming a coin and a task, e.g. "RSI for BTC".' };
  }
  return { intent: hit.id, confidence: 0.8, entities, reason: `Matched "${hit.id}".` };
}

/* ---------------- analyzers (pure) ---------------- */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const f = (v, d = 2) => (num(v) == null ? '—' : v.toFixed(d));

export function findAsset(rows = [], symbol) {
  if (!symbol) return null;
  return (rows || []).find((r) => String(r.symbol).toUpperCase() === symbol.toUpperCase()) || null;
}

export function marketSummary(rows = [], global = null) {
  const list = (rows || []).filter((r) => num(r.price) != null);
  if (!list.length) return { blocks: [{ title: 'Market summary', lines: ['No market data is loaded yet.'] }] };
  const gainers = [...list].sort((a, b) => (num(b.pct24) ?? 0) - (num(a.pct24) ?? 0));
  const losers = [...gainers].reverse();
  const up = list.filter((r) => (num(r.pct24) ?? 0) > 0).length;
  const totalMcap = list.reduce((a, r) => a + (num(r.mcap) ?? 0), 0);
  return {
    blocks: [{
      title: 'Market summary',
      lines: [
        `${list.length} assets tracked; ${up} up and ${list.length - up} down over 24h.`,
        `Combined market cap of tracked assets: $${(totalMcap / 1e9).toFixed(1)}B.`,
        global?.mcap ? `Global crypto market cap $${(global.mcap / 1e9).toFixed(1)}B.` : null,
        `Top gainer: ${gainers[0].symbol} (${f(gainers[0].pct24)}%).`,
        `Top loser: ${losers[0].symbol} (${f(losers[0].pct24)}%).`
      ].filter(Boolean),
      evidence: 'Live market rows.'
    }]
  };
}

export function tokenExplain(row) {
  if (!row) return { blocks: [{ title: 'Token', lines: ['That asset is not in the loaded market data.'] }] };
  const price = num(row.price);
  const ath = num(row.ath);
  return {
    blocks: [{
      title: `${row.name || row.symbol} (${row.symbol})`,
      lines: [
        `Price ${price == null ? '—' : `$${price}`}, ${f(row.pct24)}% over 24h.`,
        row.mcap ? `Market cap $${(row.mcap / 1e9).toFixed(2)}B.` : null,
        row.vol ? `24h volume $${(row.vol / 1e9).toFixed(2)}B.` : null,
        ath && price ? `${f(((price - ath) / ath) * 100)}% from its all-time high of $${ath}.` : null
      ].filter(Boolean),
      evidence: 'Asset metadata and live quote.'
    }]
  };
}

export function technicalAnalysis(row) {
  if (!row) return { blocks: [{ title: 'Technical analysis', lines: ['No asset data.'] }] };
  const lines = [];
  if (num(row.rsi) != null) {
    const r = row.rsi;
    lines.push(`RSI ${f(r, 1)} — ${r < 30 ? 'oversold' : r > 70 ? 'overbought' : 'neutral'}.`);
  }
  if (num(row.pct24) != null) lines.push(`24h change ${f(row.pct24)}%.`);
  if (num(row.pct7d) != null) lines.push(`7d change ${f(row.pct7d)}%.`);
  if (!lines.length) lines.push('Not enough indicator data for this asset right now.');
  return { blocks: [{ title: `Technical read · ${row.symbol}`, lines, evidence: 'Live indicator series.' }] };
}

export function fundamentalAnalysis(row) {
  if (!row) return { blocks: [{ title: 'Fundamental analysis', lines: ['No asset data.'] }] };
  const lines = [];
  if (row.mcap && row.fdv) lines.push(`FDV $${(row.fdv / 1e9).toFixed(2)}B vs market cap $${(row.mcap / 1e9).toFixed(2)}B (ratio ${f(row.fdv / row.mcap)}).`);
  if (row.circulating != null && row.total != null) lines.push(`Circulating ${(row.circulating / 1e6).toFixed(1)}M of ${(row.total / 1e6).toFixed(1)}M issued.`);
  if (row.rank) lines.push(`Market-cap rank #${row.rank}.`);
  if (!lines.length) lines.push('Supply and valuation fields are not available for this asset in the current feed.');
  return { blocks: [{ title: `Fundamentals · ${row.symbol}`, lines, evidence: 'Supply and valuation fields from the market feed.' }] };
}

export function portfolioAnalysis(portfolio) {
  if (!portfolio || !portfolio.positions?.length) {
    return { blocks: [{ title: 'Portfolio analysis', lines: ['No open positions are recorded. Add transactions on the Portfolio page.'] }] };
  }
  const t = portfolio.totals;
  return {
    blocks: [{
      title: 'Portfolio analysis',
      lines: [
        `Value $${f(t.value)}, cost basis $${f(t.costBasis)}.`,
        `Unrealized ${t.unrealized >= 0 ? '+' : ''}$${f(t.unrealized)} · realized ${t.realized >= 0 ? '+' : ''}$${f(t.realized)}.`,
        `ROI ${f(t.roiPct)}%.`,
        `${portfolio.positions.length} open position(s); largest ${portfolio.positions[0].symbol} at ${f(portfolio.positions[0].weightPct, 1)}% of the book.`
      ],
      evidence: 'Your transaction ledger, FIFO cost basis.'
    }]
  };
}

export function riskAnalysis(portfolio) {
  const risk = portfolio?.risk;
  if (!portfolio || !portfolio.positions?.length) {
    return { blocks: [{ title: 'Risk analysis', lines: ['No positions to assess.'] }] };
  }
  const lines = [];
  if (risk?.hhi != null) lines.push(`Concentration (HHI) ${risk.hhi} — ${risk.hhi > 0.35 ? 'highly concentrated' : risk.hhi > 0.2 ? 'moderately concentrated' : 'well diversified'}.`);
  if (risk?.top1Pct != null) lines.push(`Largest position ${f(risk.top1Pct, 1)}% of the book.`);
  if (risk?.weightedVolPct != null) lines.push(`Weighted volatility ${f(risk.weightedVolPct)}%.`);
  if (risk?.coveragePct != null) lines.push(`Volatility coverage ${f(risk.coveragePct)}% of holdings.`);
  if (risk?.maxDrawdownPct != null) lines.push(`Equity max drawdown ${f(risk.maxDrawdownPct)}%.`);
  if (!lines.length) lines.push('Not enough history to compute risk metrics yet.');
  return { blocks: [{ title: 'Risk analysis', lines, evidence: 'Positions plus return series; correlation is NOT modelled, so true risk is higher.' }] };
}

/** Intents with no available source must say so plainly. */
const NO_SOURCE = {
  whale_analysis: 'Whale identification needs a labelled holder index (e.g. an entity database). No keyless source is wired, so this cannot be answered — rather than guessing from trade sizes.',
  news_analysis: 'Article-level news analysis needs a news API. The app carries exchange/project status updates and a generated market pulse, but not general news coverage.',
  onchain_analysis: 'On-chain analysis is available for a specific address or contract through the Blockchain Explorer. Ask about an address to get balance, transfers and contract detail.',
  transaction_explain: 'Paste a transaction hash and the Blockchain Explorer will decode it. The assistant does not guess transaction contents.',
  wallet_investigation: 'Paste an address and the Blockchain Explorer will report balance, contract status and transfers. Labelling who owns it needs an entity database we do not have.',
  smart_contract_explain: 'Paste a contract address: the Explorer probes ERC-165 and standard selectors to describe the interface. Verified source code needs an explorer API key.',
  research_report: 'Research reports are composed from the sections above — ask for a market summary and a token read separately, and treat any narrative as analysis of public data, not investment advice.',
  api_generator: 'There is no public API for this app yet, so there is nothing to generate against.'
};

/* ---------------- action proposals (never executed here) ---------------- */

export function proposeAction(intent, entities, row) {
  if (!ACTION_INTENTS.includes(intent)) return null;
  const symbol = entities?.symbol || row?.symbol || null;

  const base = {
    requiresConfirmation: true,
    // Nothing in this module executes. The caller must show this and get consent.
    safety: 'Proposed only. Nothing is created until you explicitly confirm.'
  };

  switch (intent) {
    case 'create_alert':
      return {
        ...base,
        kind: 'alert',
        summary: `Price alert on ${symbol || 'an asset'} ${entities.direction || 'above'} ${entities.threshold ?? '$<value>'}`,
        payload: { symbol, direction: entities.direction || 'above', threshold: entities.threshold }
      };
    case 'generate_bot':
      return { ...base, kind: 'bot', summary: `A paper ${symbol || ''} bot (DCA, Grid, TWAP… chosen on the Bots page)`, payload: { symbol } };
    case 'build_strategy':
      return { ...base, kind: 'strategy', summary: `A custom strategy with entry/exit rules on ${symbol || 'an asset'}`, payload: { symbol } };
    case 'backtest':
      return { ...base, kind: 'backtest', summary: `Backtest a signal series on ${symbol || 'an asset'}`, payload: { symbol } };
    default:
      return { ...base, kind: 'unknown', summary: 'Unrecognised action', payload: {} };
  }
}

/* ---------------- top-level answer ---------------- */

/**
 * Answer a query from local data. Pure — no network, no model.
 * Returns blocks plus the provenance of every number.
 */
export function answer(query, ctx = {}) {
  const cls = classify(query);
  const { rows = [], global = null, portfolio = null } = ctx;
  const row = findAsset(rows, cls.entities.symbol);

  let out;
  switch (cls.intent) {
    case 'market_summary': out = marketSummary(rows, global); break;
    case 'token_explain': out = tokenExplain(row); break;
    case 'technical_analysis':
    case 'chart_analysis': out = technicalAnalysis(row); break;
    case 'fundamental_analysis': out = fundamentalAnalysis(row); break;
    case 'portfolio_analysis': out = portfolioAnalysis(portfolio); break;
    case 'risk_analysis': out = riskAnalysis(portfolio); break;
    case 'search':
      out = {
        blocks: [{
          title: cls.entities.symbol ? `Match · ${cls.entities.symbol}` : 'Search',
          lines: row
            ? [`${row.name} (${row.symbol}) at $${row.price}, ${f(row.pct24)}% 24h.`]
            : ['No matching asset in the loaded set.'],
          evidence: 'Live market rows.'
        }]
      };
      break;
    default:
      out = {
        blocks: [{
          title: 'Not answerable from local data',
          lines: [NO_SOURCE[cls.intent] || cls.reason || 'That request does not map to anything this assistant can compute.'],
          evidence: 'Capability boundary.'
        }]
      };
  }

  return {
    query,
    intent: cls.intent,
    confidence: cls.confidence,
    entities: cls.entities,
    blocks: out.blocks,
    proposal: proposeAction(cls.intent, cls.entities, row),
    // Stated on every answer, because users will assume otherwise.
    disclaimer: 'Computed locally from this app\u2019s own data. No language model is involved. This is not investment advice.'
  };
}

/** Coverage map for the UI, so the assistant's limits are visible up front. */
export function capabilityMap() {
  const withSource = new Set(['market_summary', 'token_explain', 'technical_analysis', 'chart_analysis', 'fundamental_analysis', 'portfolio_analysis', 'risk_analysis', 'search']);
  return INTENTS.map((i) => ({
    ...i,
    status: i.action ? 'action' : withSource.has(i.id) ? 'supported' : 'no-source'
  }));
}
