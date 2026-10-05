/* Market-intelligence supplements: the named theme taxonomy and a new-listings
 * feed. Pure functions — unit tested.
 *
 * SECTOR_BUCKETS in marketIntel.js already matches the themes; THEMES below is
 * the ordered, labelled view of exactly the themes the spec names, so the UI and
 * the tests agree on one list.
 */

import { SECTOR_BUCKETS, num } from './marketIntel.js';

/** The themes the spec names, in display order, mapped to their bucket ids. */
export const THEMES = [
  { id: 'stablecoins', label: 'Stablecoins' },
  { id: 'meme', label: 'Meme coins' },
  { id: 'ai', label: 'AI tokens' },
  { id: 'depin', label: 'DePIN' },
  { id: 'rwa', label: 'RWA' },
  { id: 'layer1', label: 'Layer 1' },
  { id: 'layer2', label: 'Layer 2' },
  { id: 'defi', label: 'DeFi' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'infrastructure', label: 'Infrastructure' }
];

/** Every named theme must resolve to a real bucket, or the tab would be empty. */
export function validateThemes(themes = THEMES, buckets = SECTOR_BUCKETS) {
  const ids = new Set(buckets.map((b) => b.id));
  return themes.filter((t) => !ids.has(t.id)).map((t) => t.id);
}

const dateOf = (row) => {
  const raw = row?.athDate ?? row?.ath_date ?? row?.atlDate ?? row?.atl_date ?? null;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Recently listed coins.
 *
 * HONEST METHOD: the market feed does not publish a listing date, so this is a
 * PROXY — a genuinely new coin must have set its all-time high recently. Coins
 * with no ATH date are excluded rather than assumed new, and the caller must
 * label the result as a proxy.
 */
export function newListings(rows = [], { withinDays = 30, now = Date.now(), limit = 25 } = {}) {
  const cutoff = now - withinDays * 86400000;
  const out = [];
  (rows || []).forEach((r) => {
    const t = dateOf(r);
    if (t == null) return;          // unknown date is NOT "new"
    if (t < cutoff) return;
    const price = num(r?.price ?? r?.current_price);
    const ath = num(r?.ath);
    out.push({
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      price,
      ath,
      athDate: new Date(t).toISOString(),
      // How far below its high it is trading — informative for a fresh listing.
      fromAthPct: ath != null && price != null && ath > 0 ? ((price - ath) / ath) * 100 : null,
      daysSinceAth: Math.floor((now - t) / 86400000),
      mcap: num(r?.mcap ?? r?.market_cap)
    });
  });
  return out
    .sort((a, b) => Date.parse(b.athDate) - Date.parse(a.athDate))
    .slice(0, limit);
}

/** Label the proxy honestly wherever it is surfaced. */
export const NEW_LISTINGS_LABEL =
  'Recently listed (proxy: all-time-high date). The feed publishes no listing date, so this is an approximation — not an official "new listing" list.';

/** Rows matching one named theme. */
export function byTheme(rows = [], themeId) {
  const bucket = SECTOR_BUCKETS.find((b) => b.id === themeId);
  if (!bucket) return [];
  return (rows || []).filter((r) => {
    const cats = r?.categories || r?.category || [];
    const list = Array.isArray(cats) ? cats : [cats];
    return list.some((c) => typeof c === 'string' && bucket.match.some((re) => re.test(c)));
  });
}

/** Aggregate a theme: count, total cap and the leaders. */
export function themeStats(rows = [], themeId, { top = 5 } = {}) {
  const matched = byTheme(rows, themeId);
  const caps = matched.map((r) => num(r?.mcap ?? r?.market_cap) || 0);
  const totalMcap = caps.reduce((a, b) => a + b, 0);
  const leaders = [...matched]
    .sort((a, b) => (num(b?.mcap ?? b?.market_cap) || 0) - (num(a?.mcap ?? a?.market_cap) || 0))
    .slice(0, top)
    .map((r) => ({ id: r.id, symbol: r.symbol, name: r.name, mcap: num(r?.mcap ?? r?.market_cap) }));
  return { themeId, count: matched.length, totalMcap: totalMcap || null, leaders, matched };
}
