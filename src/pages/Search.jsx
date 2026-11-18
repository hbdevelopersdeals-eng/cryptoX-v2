import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search as SearchIcon, CornerDownLeft, Command } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { PRESETS } from '../lib/strategies.js';
import { SUPPORTED_VENUES } from '../lib/sources.js';
import { COURSES } from '../lib/academy.js';
import {
  buildIndex, search as runSearch, groupResults, highlight, coverage, suggestions,
  SEARCH_TYPES
} from '../lib/universalSearch.js';
import { Card, SectionTitle, EmptyState } from '../components/ui.jsx';

/* Human labels for the venue ids the adapters actually implement. The list is
   derived from SUPPORTED_VENUES at runtime, so an adapter that is removed stops
   appearing in search instead of pointing at a page that no longer quotes it. */
const VENUE_LABELS = {
  binance: 'Binance',
  kraken: 'Kraken',
  coinbase: 'Coinbase',
  okx: 'OKX',
  bybit: 'Bybit',
  kucoin: 'KuCoin',
  bitget: 'Bitget',
  gateio: 'Gate.io',
  htx: 'HTX',
  mexc: 'MEXC',
  bitfinex: 'Bitfinex',
  gemini: 'Gemini'
};

/** Destinations that are pages rather than entities, so they belong in search. */
const APP_DESTINATIONS = [
  { id: 'exchange', name: 'Paper exchange', sublabel: 'Place simulated orders', href: '/exchange' },
  { id: 'charting', name: 'Pro charting', sublabel: 'Indicators, drawings, layouts', href: '/charting' },
  { id: 'alerts', name: 'Price alerts', sublabel: 'Threshold and indicator alerts', href: '/alerts' },
  { id: 'portfolio', name: 'Portfolio', sublabel: 'Holdings, PnL, allocation', href: '/portfolio' },
  { id: 'defi', name: 'DeFi & NFT', sublabel: 'Pools, lending, NFT floor', href: '/defi' },
  { id: 'explorer', name: 'Block explorer', sublabel: 'Blocks, transactions, addresses', href: '/explorer' },
  { id: 'wallet-lab', name: 'Wallet lab', sublabel: 'Read-only wallet inspection', href: '/wallet-lab' },
  { id: 'bots', name: 'Trading bots', sublabel: 'DCA, grid, TWAP presets', href: '/bots' },
  { id: 'assistant', name: 'CryptoX AI', sublabel: 'Ask about a coin or a chart', href: '/assistant' },
  { id: 'news', name: 'News', sublabel: 'Headlines and summaries', href: '/news' }
];

export default function SearchPage() {
  const { rows } = useMarket() || { rows: [] };
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  /* Focus on mount: this page exists to be typed into. */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const index = useMemo(() => {
    const coins = (rows || []).map((r) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      sublabel: r.rank ? `#${r.rank} · ${r.source === 'simulated' ? 'simulated' : 'live'}` : '',
      href: `/coin/${r.id}`,
      popularity: Number(r.mcap) || 0
    }));

    const strategies = (PRESETS || []).map((p) => ({
      id: p.id,
      name: p.name,
      sublabel: p.blurb || p.description || 'Strategy preset',
      href: '/strategies'
    }));

    const exchanges = (SUPPORTED_VENUES || []).map((id) => ({
      id,
      name: VENUE_LABELS[id] || id,
      sublabel: 'Venue adapter',
      href: '/aggregator'
    }));

    const charts = APP_DESTINATIONS.map((d) => ({
      id: d.id,
      name: d.name,
      sublabel: d.sublabel,
      href: d.href
    }));

    const lessons = COURSES.map((c) => ({
      id: c.id,
      name: c.title,
      sublabel: `${c.level} · ${c.minutes} min`,
      keywords: [c.track, ...c.lessons.map((l) => l.title)],
      href: '/academy'
    }));

    return buildIndex({
      coin: coins,
      exchange: exchanges,
      strategy: strategies,
      chart: charts,
      /* "course" is not its own entity type; lessons are surfaced as strategy-like
         reading results under the chart bucket is wrong, so they are indexed as
         posts — the type that means "content you read". */
      post: lessons
    });
  }, [rows]);

  const result = useMemo(() => (query.trim() ? runSearch(index, query, { limit: 24 }) : null), [index, query]);
  const groups = useMemo(() => (result ? groupResults(result.results) : []), [result]);
  const flat = result?.results || [];
  const defaultRows = useMemo(() => (query.trim() ? [] : suggestions(index, 8)), [index, query]);
  const cov = useMemo(() => coverage(index), [index]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const open = (href) => {
    if (!href) return;
    if (href.startsWith('http')) window.location.assign(href);
    else navigate(href);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      open(flat[active].href);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  const indexedTypes = cov.filter((c) => c.indexed).length;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Search"
        sub="One box across every entity CryptoX knows about. Arrow keys move, Enter opens, Escape clears."
      />

      <Card className="!p-3">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/60">
          <SearchIcon size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search coins, exchanges, strategies and destinations"
            aria-describedby="search-help"
            placeholder="Search coins, exchanges, strategies, pages…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2"
              aria-label="Clear search"
            >
              Esc
            </button>
          ) : (
            <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:flex" aria-hidden="true">
              <Command size={12} /> K
            </span>
          )}
        </div>
        <p id="search-help" className="mt-2 px-1 text-[11px] text-muted-foreground">
          Indexed {index.total.toLocaleString('en-US')} records across {indexedTypes} of {SEARCH_TYPES.length} categories.
          Empty categories report zero rather than being hidden.
        </p>
      </Card>

      {!query.trim() ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Try one of these</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {defaultRows.map((s) => (
              <Link
                key={`${s.type}-${s.id}`}
                to={s.href || '#'}
                className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm hover:border-primary/40"
              >
                <span className="truncate">{s.label}</span>
                <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{s.typeLabel}</span>
              </Link>
            ))}
          </div>
          {!defaultRows.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              The index is empty — market data has not loaded yet. Search becomes useful the moment the first quote arrives.
            </p>
          ) : null}
        </Card>
      ) : null}

      {query.trim() && result ? (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold" aria-live="polite">
              {result.total === 0 ? 'No matches' : `${result.total} match${result.total === 1 ? '' : 'es'} for “${result.query}”`}
            </h2>
            {result.truncated ? <span className="text-[11px] text-muted-foreground">showing {flat.length}</span> : null}
          </div>

          {result.total === 0 ? (
            <EmptyState
              icon={<SearchIcon size={28} className="text-muted-foreground" aria-hidden="true" />}
              title="Nothing in the index matches that"
              sub="Search covers what this deployment can actually see: live coins, implemented venue adapters, strategy presets, courses and app pages. It is not a web search."
            />
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.type}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                  <ul className="space-y-1">
                    {g.items.map((item) => {
                      const isActive = flat[active]?.id === item.id && flat[active]?.type === item.type;
                      return (
                        <li key={`${item.type}-${item.id}`}>
                          <Link
                            to={item.href || '#'}
                            onMouseEnter={() => setActive(flat.findIndex((f) => f.id === item.id && f.type === item.type))}
                            className={
                              'flex items-center justify-between rounded-lg px-3 py-2 text-sm ' +
                              (isActive ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60')
                            }
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {highlight(item.label, result.query).map((seg, i) => (
                                  <React.Fragment key={i}>
                                    {seg.match ? <mark className="rounded bg-primary/20 px-0.5 text-inherit">{seg.text}</mark> : seg.text}
                                  </React.Fragment>
                                ))}
                              </span>
                              {item.sublabel ? <span className="block truncate text-[11px] text-muted-foreground">{item.sublabel}</span> : null}
                            </span>
                            {isActive ? <CornerDownLeft size={13} className="ml-2 shrink-0" aria-hidden="true" /> : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Index coverage</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {cov.map((c) => (
            <div key={c.id} className="rounded-lg border border-border px-2.5 py-2">
              <p className="truncate text-[11px] text-muted-foreground">{c.label}</p>
              <p className={'num text-sm font-semibold ' + (c.indexed ? '' : 'text-muted-foreground')}>{c.count.toLocaleString('en-US')}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Categories at zero are not wired to a data source in this build: wallets, addresses, transactions, blocks, NFTs,
          DeFi protocols, news, users and saved charts need an authenticated indexer. They are listed so the gap is visible
          instead of implied.
        </p>
      </Card>
    </div>
  );
}
