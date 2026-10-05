/* News processing: duplicate detection, source attribution, sentiment and
 * quality heuristics. Pure functions — unit tested.
 *
 * HONEST SCOPE
 *   duplicate detection — real: token-set similarity over normalised titles.
 *   sentiment           — a LEXICON, not a model. It reads explicit keywords,
 *                         so it misses sarcasm, negation and nuance. Labelled as
 *                         lexicon-based wherever it is shown.
 *   quality             — HEURISTICS over metadata (attribution, timestamp,
 *                         clickbait markers). This is NOT fact-checking and
 *                         cannot tell whether a claim is true.
 */

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'is', 'are', 'as', 'its', 'it', 'this', 'that', 'will', 'has', 'have', 'be', 'after', 'over', 'amid']);

/** Normalise a headline to comparable tokens. */
export function normaliseTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && w.length > 2);
}

/** Jaccard similarity of two token sets, 0–1. */
export function titleSimilarity(a, b) {
  const A = new Set(normaliseTitle(a));
  const B = new Set(normaliseTitle(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter += 1; });
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/**
 * Cluster near-duplicate stories and keep the best-attributed one from each
 * cluster, so a single wire story republished five times reads as one item.
 */
export function dedupeStories(items = [], { threshold = 0.6, now = Date.now() } = {}) {
  const list = (items || []).filter((i) => i && i.title);
  const clusters = [];
  const assigned = new Set();

  list.forEach((item, idx) => {
    if (assigned.has(idx)) return;
    const cluster = [item];
    assigned.add(idx);
    list.forEach((other, j) => {
      if (j <= idx || assigned.has(j)) return;
      if (titleSimilarity(item.title, other.title) >= threshold) {
        cluster.push(other);
        assigned.add(j);
      }
    });
    // Prefer the item with the most metadata; ties go to the newest.
    const best = [...cluster].sort((a, b) => {
      const score = (x) => (x.url ? 1 : 0) + (x.source ? 1 : 0) + (x.createdAt ? 1 : 0);
      return score(b) - score(a) || (b.createdAt || 0) - (a.createdAt || 0);
    })[0];
    clusters.push({
      lead: best,
      duplicates: cluster.length - 1,
      alsoSeenAt: cluster.filter((c) => c !== best).map((c) => c.source).filter(Boolean),
      titles: cluster.map((c) => c.title)
    });
  });

  return {
    clusters,
    input: list.length,
    unique: clusters.length,
    removed: list.length - clusters.length,
    method: 'Token-set similarity over normalised headlines; a human editor would still catch paraphrase the tokens miss.'
  };
}

/* ---------------- sentiment (lexicon) ---------------- */

export const SENTIMENT_LEXICON = {
  positive: ['surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'gain', 'gains', 'bullish', 'record', 'high', 'adoption', 'approval', 'approved', 'partnership', 'upgrade', 'inflow', 'inflows', 'breakout', 'milestone', 'launch', 'support', 'boost', 'wins', 'recover', 'recovery', 'accumulate'],
  negative: ['crash', 'crashes', 'plunge', 'plunges', 'dump', 'dumps', 'bearish', 'hack', 'hacked', 'exploit', 'breach', 'lawsuit', 'sue', 'ban', 'bans', 'outflow', 'outflows', 'liquidation', 'liquidations', 'delist', 'delisted', 'fraud', 'scam', 'halt', 'halted', 'downgrade', 'warning', 'risk', 'slump', 'fall', 'falls', 'drop', 'drops', 'selloff', 'losses']
};

/**
 * Lexicon sentiment. `score` is the net count of positive minus negative terms;
 * `label` is the sign. Negation is handled crudely ("not bullish" flips only if
 * the negator immediately precedes the term) and the limitation is stated.
 */
export function scoreSentiment(text) {
  const words = String(text || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const hits = [];
  let score = 0;

  words.forEach((w, i) => {
    const prev = words[i - 1];
    const negated = prev === 'not' || prev === 'no' || prev === 'never' || prev === 'without';
    if (SENTIMENT_LEXICON.positive.includes(w)) {
      score += negated ? -1 : 1;
      hits.push({ word: w, polarity: negated ? 'negative' : 'positive' });
    } else if (SENTIMENT_LEXICON.negative.includes(w)) {
      score += negated ? 1 : -1;
      hits.push({ word: w, polarity: negated ? 'positive' : 'negative' });
    }
  });

  return {
    score,
    label: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral',
    hits,
    method: 'Keyword lexicon — it does not understand sarcasm, nuance or context.'
  };
}

/** Source attribution, normalised for grouping. */
export function attributeSource(item) {
  const raw = item?.source?.title || item?.source?.name || item?.author || item?.source || null;
  if (!raw) return { name: 'Unattributed', url: item?.source?.url || null, attributed: false };
  return { name: String(raw), url: item?.source?.url || null, attributed: true };
}

/* ---------------- quality heuristics ---------------- */

const CLICKBAIT = ['you won\'t believe', 'shocking', 'must see', 'insane', 'this one trick', 'guaranteed', '100x', 'next 1000x', 'don\'t miss', 'urgent'];

/**
 * Metadata quality score, 0–100. This assesses PRESENTATION and provenance, not
 * truth — a well-formatted false story still scores well, and that is stated.
 */
export function qualityScore(item, { now = Date.now() } = {}) {
  const flags = [];
  let score = 50;

  const src = attributeSource(item);
  if (src.attributed) score += 15; else flags.push({ code: 'unattributed', detail: 'No named source' });

  if (item?.url) score += 10; else flags.push({ code: 'no-link', detail: 'No link to the original' });

  const t = item?.createdAt ? Number(item.createdAt) * (String(item.createdAt).length <= 10 ? 1000 : 1) : null;
  if (t) {
    const ageDays = (now - t) / 86400000;
    if (ageDays <= 2) score += 15;
    else if (ageDays <= 14) score += 8;
    else { score -= 5; flags.push({ code: 'stale', detail: `Published ${Math.floor(ageDays)} days ago` }); }
  } else {
    flags.push({ code: 'no-timestamp', detail: 'No publication time' });
  }

  const title = String(item?.title || '');
  const upper = title.replace(/[^A-Za-z]/g, '');
  if (upper && upper === upper.toUpperCase() && upper.length > 12) {
    score -= 10;
    flags.push({ code: 'all-caps', detail: 'Headline is entirely upper-case' });
  }
  const bait = CLICKBAIT.find((c) => title.toLowerCase().includes(c));
  if (bait) {
    score -= 20;
    flags.push({ code: 'clickbait', detail: `Contains "${bait}"` });
  }
  if (title.length > 0 && title.length < 25) {
    score -= 5;
    flags.push({ code: 'thin-headline', detail: 'Unusually short headline' });
  }

  const clamped = Math.max(0, Math.min(100, score));
  return {
    score: clamped,
    band: clamped >= 75 ? 'high' : clamped >= 50 ? 'medium' : 'low',
    flags,
    method: 'Metadata heuristics only — attribution, timestamp and presentation. This is NOT fact-checking.'
  };
}

/** Annotate a feed: attribute, score, sentiment, then collapse duplicates. */
export function processFeed(items = [], opts = {}) {
  const enriched = (items || []).map((i) => ({
    ...i,
    source: attributeSource(i),
    sentiment: scoreSentiment(`${i?.title || ''} ${i?.description || ''}`),
    quality: qualityScore(i, opts)
  }));
  const deduped = dedupeStories(enriched, opts);
  return {
    items: deduped.clusters.map((c) => ({ ...c.lead, duplicates: c.duplicates, alsoSeenAt: c.alsoSeenAt })),
    stats: {
      input: deduped.input,
      unique: deduped.unique,
      duplicatesRemoved: deduped.removed,
      positive: enriched.filter((i) => i.sentiment.label === 'positive').length,
      negative: enriched.filter((i) => i.sentiment.label === 'negative').length,
      neutral: enriched.filter((i) => i.sentiment.label === 'neutral').length,
      lowQuality: enriched.filter((i) => i.quality.band === 'low').length
    },
    notes: [deduped.method, 'Sentiment is lexicon-based. Quality scoring is heuristic, not fact-checking.']
  };
}

/** Capabilities this layer cannot provide, each with its reason. */
export const NEWS_CAPABILITIES = [
  { id: 'aggregation', label: 'Crypto news aggregation', status: 'partial', note: 'Exchange and project status updates are carried; general news coverage needs a news API key.' },
  { id: 'announcements', label: 'Official announcements', status: 'supported', note: 'Live project/exchange status updates with attribution.' },
  { id: 'regulatory', label: 'Regulatory / ETF / unlock news', status: 'unavailable', note: 'Needs a licensed news feed or a calendar API; no keyless source.' },
  { id: 'hacks', label: 'Hack / exploit alerts', status: 'unavailable', note: 'Needs a security incident feed; none is wired.' },
  { id: 'governance', label: 'Governance proposals', status: 'unavailable', note: 'Needs per-DAO indexers (Snapshot, Tally); no keyless aggregation.' },
  { id: 'research', label: 'Research reports', status: 'partial', note: 'Derived analysis is available from live data; third-party research needs a subscription.' },
  { id: 'summaries', label: 'AI summaries', status: 'partial', note: 'Market pulse is COMPUTED, not model-generated — and is labelled that way.' },
  { id: 'attribution', label: 'Source attribution', status: 'supported', note: 'Each item keeps its named source and link.' },
  { id: 'dedupe', label: 'Duplicate-story detection', status: 'supported', note: 'Token-set similarity over normalised headlines.' },
  { id: 'quality', label: 'Content-quality controls', status: 'supported', note: 'Metadata heuristics. Not fact-checking.' },
  { id: 'sentiment', label: 'Sentiment analysis', status: 'supported', note: 'Keyword lexicon, not a model.' }
];
