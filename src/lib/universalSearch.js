/* Universal search (Section 31).
 *
 * One box that finds any entity the platform knows about: coins, tokens,
 * exchanges, pairs, wallets, addresses, transactions, blocks, NFTs, DeFi
 * protocols, news, users, posts, strategies and saved charts.
 *
 * Two design decisions worth stating, because both are visible in the UI:
 *
 *   1. SEARCH IS OVER AN INDEX THE CALLER BUILDS. There is no crawler and no
 *      hidden remote query here: whatever collection you pass in is exactly
 *      what can be found. The Search page builds its index from the live coin
 *      list plus the user's own records, which means an empty category is an
 *      empty category rather than a silent failure. `coverage()` reports that
 *      per type so the UI can say "0 of 15 categories indexed" instead of
 *      implying it searched the world.
 *
 *   2. MATCHING IS DETERMINISTIC. Exact symbol beats prefix beats substring
 *      beats a fuzzy subsequence, and the tie-breakers are fixed. Ranking that
 *      changes between identical queries makes a search box feel broken; that
 *      is a UX requirement, not a stylistic preference.
 *
 * No HTML is produced anywhere: `highlight` returns segments, so the React
 * layer renders text nodes and never needs dangerouslySetInnerHTML.
 */

/** Every entity type the product can index, in display order. */
export const SEARCH_TYPES = [
  { id: 'coin', label: 'Coins', weight: 30, icon: 'coins' },
  { id: 'token', label: 'Tokens', weight: 26, icon: 'token' },
  { id: 'exchange', label: 'Exchanges', weight: 24, icon: 'exchange' },
  { id: 'pair', label: 'Trading pairs', weight: 22, icon: 'pair' },
  { id: 'wallet', label: 'Wallets', weight: 18, icon: 'wallet' },
  { id: 'address', label: 'Addresses', weight: 16, icon: 'address' },
  { id: 'transaction', label: 'Transactions', weight: 14, icon: 'transaction' },
  { id: 'block', label: 'Blocks', weight: 12, icon: 'block' },
  { id: 'nft', label: 'NFTs', weight: 12, icon: 'nft' },
  { id: 'protocol', label: 'DeFi protocols', weight: 12, icon: 'protocol' },
  { id: 'news', label: 'News', weight: 10, icon: 'news' },
  { id: 'user', label: 'Users', weight: 8, icon: 'user' },
  { id: 'post', label: 'Posts', weight: 6, icon: 'post' },
  { id: 'strategy', label: 'Strategies', weight: 10, icon: 'strategy' },
  { id: 'chart', label: 'Charts', weight: 8, icon: 'chart' }
];

export const TYPE_BY_ID = Object.fromEntries(SEARCH_TYPES.map((t) => [t.id, t]));

/** Cap on documents per type, to keep a pathological collection from freezing input. */
export const MAX_PER_TYPE = 5000;

const normalise = (value) => String(value ?? '').trim().toLowerCase();

const tokens = (value) =>
  normalise(value)
    .split(/[\s\-_/.:,()]+/)
    .filter(Boolean);

/** Sequence match: every character of `needle` appears in order in `hay`. */
function subsequence(needle, hay) {
  if (!needle) return false;
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j += 1) {
    if (hay[j] === needle[i]) i += 1;
  }
  return i === needle.length;
}

/**
 * Normalise one caller-supplied entity into an index document.
 * Unknown extra fields are ignored; `keywords` is the escape hatch for aliases,
 * old tickers and contract addresses.
 */
export function toDoc(type, entity = {}) {
  if (!TYPE_BY_ID[type]) return null;
  const id = entity.id ?? entity.symbol ?? entity.slug ?? entity.name;
  if (id == null) return null;
  const name = entity.name ?? entity.label ?? entity.title ?? entity.symbol ?? String(id);
  const symbol = entity.symbol ?? entity.ticker ?? '';
  const aliases = [entity.alias, ...(Array.isArray(entity.aliases) ? entity.aliases : [])]
    .filter(Boolean)
    .map(normalise);
  const keywords = (Array.isArray(entity.keywords) ? entity.keywords : []).map(normalise);

  return {
    type,
    id: String(id),
    label: String(name),
    sublabel: entity.sublabel ?? entity.description ?? entity.network ?? entity.chain ?? '',
    symbol: String(symbol),
    href: entity.href ?? null,
    popularity: Number.isFinite(entity.popularity) ? entity.popularity : 0,
    /* Search haystacks are precomputed: 15 types × thousands of rows is too
       much string work to repeat on every keystroke. */
    _name: normalise(name),
    _symbol: normalise(symbol),
    _aliases: aliases,
    _keywords: keywords,
    _all: [normalise(name), normalise(symbol), ...aliases, ...keywords].join(' ')
  };
}

/**
 * Build the searchable index.
 * `collections` is an object keyed by type id, each an array of entities.
 * Returns a flat document list plus per-type counts so the caller can render
 * honest coverage ("Indexed: 250 coins, 6 exchanges, 0 NFTs").
 */
export function buildIndex(collections = {}) {
  const docs = [];
  const counts = {};
  for (const type of SEARCH_TYPES) {
    const rows = Array.isArray(collections[type.id]) ? collections[type.id].slice(0, MAX_PER_TYPE) : [];
    let added = 0;
    for (const row of rows) {
      const doc = toDoc(type.id, row);
      if (doc) {
        docs.push(doc);
        added += 1;
      }
    }
    counts[type.id] = added;
  }
  return { docs, counts, total: docs.length };
}

/** Per-type coverage, including the types with nothing in them. */
export function coverage(index = {}) {
  const counts = index.counts || {};
  return SEARCH_TYPES.map((t) => ({
    ...t,
    count: counts[t.id] || 0,
    indexed: (counts[t.id] || 0) > 0
  }));
}

/**
 * Score one document against the query tokens.
 * Returns 0 when any token fails to match, which makes multi-token queries AND
 * rather than OR (typing "sol defi" should not return every SOL market).
 */
function scoreDoc(doc, queryTokens, phrase) {
  let total = 0;

  if (phrase && doc._symbol === phrase) total += 1000;
  else if (phrase && doc._name === phrase) total += 900;

  for (const token of queryTokens) {
    let best = 0;

    if (doc._symbol === token) best = 600;
    else if (doc._name === token) best = 560;
    else if (doc._symbol.startsWith(token)) best = 420;
    else if (doc._name.startsWith(token)) best = 400;
    else if (doc._aliases.some((a) => a === token)) best = 380;
    else if (doc._keywords.some((k) => k === token)) best = 340;
    else if (doc._name.includes(token)) best = 260;
    else if (doc._symbol.includes(token)) best = 240;
    else if (doc._all.includes(token)) best = 200;
    else if (token.length >= 3 && subsequence(token, doc._name)) best = 90;
    else if (token.length >= 4 && doc._aliases.some((a) => subsequence(token, a))) best = 70;

    if (best === 0) return 0; // AND semantics
    total += best;
  }

  const typeWeight = TYPE_BY_ID[doc.type]?.weight ?? 0;
  /* Popularity is logarithmic and capped at 120 so a market cap cannot drown
     an exact ticker match. */
  const pop = doc.popularity > 0 ? Math.min(120, Math.log10(1 + doc.popularity) * 20) : 0;

  return total + typeWeight * 2 + pop;
}

/**
 * Run a search.
 * Empty query returns nothing rather than everything: a search page that dumps
 * the whole database on focus is a loading spinner with extra steps.
 */
export function search(index, query, { types = null, limit = 20 } = {}) {
  const raw = String(query ?? '').trim();
  if (!raw) return { query: raw, results: [], truncated: false };

  const allowed = types && types.length ? new Set(types) : null;
  const queryTokens = tokens(raw);
  const phrase = normalise(raw);

  const scored = [];
  for (const doc of index.docs || []) {
    if (allowed && !allowed.has(doc.type)) continue;
    const score = scoreDoc(doc, queryTokens, phrase);
    if (score > 0) scored.push({ doc, score });
  }

  scored.sort((a, b) => b.score - a.score || a.doc.label.localeCompare(b.doc.label) || a.doc.id.localeCompare(b.doc.id));

  const results = scored.slice(0, limit).map(({ doc, score }) => ({
    type: doc.type,
    typeLabel: TYPE_BY_ID[doc.type]?.label ?? doc.type,
    id: doc.id,
    label: doc.label,
    sublabel: doc.sublabel,
    href: doc.href,
    score
  }));

  return { query: raw, results, truncated: scored.length > results.length, total: scored.length };
}

/** Group results by type for a sectioned results list. */
export function groupResults(results = []) {
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r.type)) groups.set(r.type, []);
    groups.get(r.type).push(r);
  }
  return [...groups.entries()]
    .map(([type, items]) => ({ type, label: TYPE_BY_ID[type]?.label ?? type, items }))
    .sort((a, b) => (TYPE_BY_ID[b.type]?.weight ?? 0) - (TYPE_BY_ID[a.type]?.weight ?? 0));
}

/**
 * Which parts of a label matched, as text segments.
 * The React layer maps these to <mark> elements; no markup is generated here.
 */
export function highlight(text, query) {
  const value = String(text ?? '');
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [{ text: value, match: false }];

  const lower = value.toLowerCase();
  const segments = [];
  let cursor = 0;

  const pushMatch = (start, end) => {
    if (start > cursor) segments.push({ text: value.slice(cursor, start), match: false });
    segments.push({ text: value.slice(start, end), match: true });
    cursor = end;
  };

  /* Whole-query hit first: "bitcoin" in "Bitcoin" is one highlight, not six. */
  const idx = lower.indexOf(q);
  if (idx !== -1) {
    pushMatch(idx, idx + q.length);
    if (cursor < value.length) segments.push({ text: value.slice(cursor), match: false });
    return segments;
  }

  for (const token of tokens(q)) {
    let from = cursor;
    let found = lower.indexOf(token, from);
    while (found !== -1) {
      pushMatch(found, found + token.length);
      from = cursor;
      found = lower.indexOf(token, from);
    }
  }

  /* A subsequence fallback was tried here and reverted: marking the b, t and c
     of "Bitcoin" shreds the label into nine text nodes, which reads as broken
     text and breaks text queries against the row. The honest fix for a fuzzy
     match is to show WHAT matched — the symbol — not to sprinkle marks. */
  if (cursor < value.length) segments.push({ text: value.slice(cursor), match: false });
  return segments.length ? segments : [{ text: value, match: false }];
}

/** The most useful default list before the user types: one popular row per type. */
export function suggestions(index, limit = 8) {
  const seen = new Set();
  return (index.docs || [])
    .slice()
    .sort((a, b) => b.popularity - a.popularity)
    .filter((d) => {
      if (seen.has(d.type)) return false;
      seen.add(d.type);
      return true;
    })
    .slice(0, limit)
    .map((d) => ({ type: d.type, typeLabel: TYPE_BY_ID[d.type]?.label ?? d.type, id: d.id, label: d.label, sublabel: d.sublabel, href: d.href }));
}
