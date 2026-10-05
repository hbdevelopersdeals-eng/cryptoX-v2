import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Landmark, Waves, Coins, ShieldAlert, Image as ImageIcon, Wallet, Loader2,
  RefreshCw, Info, AlertTriangle, Search
} from 'lucide-react';
import {
  fetchProtocols, fetchChains, fetchPools, fetchStablecoins,
  topProtocols, categoryBreakdown, chainBreakdown, concentration,
  topYields, yieldQuality, peggedAssets, defiRisk, DEFI_CAPABILITIES
} from '../lib/defi.js';
import {
  fetchNftMarkets, topCollections, byPlatform, valuePortfolio, nftAnalytics, NFT_CAPABILITIES
} from '../lib/nftMarket.js';
import { EVM_RPC } from '../lib/wallets.js';
import { readNftBalance } from '../lib/nft.js';
import { Card } from '../components/ui.jsx';
import { cls, fmtUsd, fmtCompact, timeAgo } from '../lib/format.js';

const TABS = [
  { id: 'overview', label: 'DeFi overview', icon: Landmark },
  { id: 'yields', label: 'Pools & yields', icon: Waves },
  { id: 'stables', label: 'Stablecoins', icon: Coins },
  { id: 'risk', label: 'Risk', icon: ShieldAlert },
  { id: 'nft', label: 'NFT collections', icon: ImageIcon },
  { id: 'nftfolio', label: 'NFT portfolio', icon: Wallet }
];

const CAP_BADGE = {
  supported: 'bg-up/15 text-up',
  partial: 'bg-primary/15 text-primary',
  unavailable: 'bg-down/15 text-down'
};

const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);

function CapabilityList({ items, title }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-xs font-semibold">{title}</p>
      <div className="space-y-1.5">
        {items.map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[11px] font-semibold">{c.label}</span>
              <p className="text-[10px] text-muted-foreground">{c.note}</p>
            </div>
            <span className={cls('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold', CAP_BADGE[c.status])}>{c.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DeFiNftPage() {
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [protocols, setProtocols] = useState([]);
  const [chains, setChains] = useState([]);
  const [pools, setPools] = useState([]);
  const [stables, setStables] = useState([]);
  const [collections, setCollections] = useState([]);
  const [at, setAt] = useState(null);

  /* yield filters */
  const [minTvl, setMinTvl] = useState(1_000_000);
  const [stableOnly, setStableOnly] = useState(false);

  /* nft portfolio lookup */
  const [chain, setChain] = useState(Object.keys(EVM_RPC)[0]);
  const [contract, setContract] = useState('');
  const [owner, setOwner] = useState('');
  const [lookup, setLookup] = useState(null);
  const [looking, setLooking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [p, c, y, s, n] = await Promise.all([
      fetchProtocols(), fetchChains(), fetchPools(), fetchStablecoins(), fetchNftMarkets({ perPage: 60 })
    ]);
    setProtocols(p.ok ? p.data : []);
    setChains(c.ok ? c.data : []);
    setPools(y.ok ? y.data : []);
    setStables(s.ok ? s.data : []);
    setCollections(n.ok ? n.data : []);
    // Surface the first genuine failure rather than rendering empty panels.
    const firstErr = [p, c, y, s, n].find((r) => !r.ok);
    if (firstErr) setErr(firstErr.error);
    setAt(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const overview = useMemo(() => ({
    top: topProtocols(protocols, { limit: 15 }),
    cats: categoryBreakdown(protocols).slice(0, 8),
    chainRows: chainBreakdown(chains).slice(0, 10),
    conc: concentration(protocols.map((p) => ({ tvl: p.tvl })))
  }), [protocols, chains]);

  const yields = useMemo(() => topYields(pools, { limit: 25, minTvl, stableOnly }), [pools, minTvl, stableOnly]);
  const pegs = useMemo(() => peggedAssets(stables), [stables]);
  const risk = useMemo(() => defiRisk({ protocols, pools, stables }), [protocols, pools, stables]);
  const nftTop = useMemo(() => topCollections(collections, { limit: 24 }), [collections]);
  const nftPlatforms = useMemo(() => byPlatform(collections), [collections]);
  const nftStats = useMemo(() => nftAnalytics(collections), [collections]);

  const runLookup = async () => {
    setLooking(true);
    setLookup(null);
    try {
      const bal = await readNftBalance(chain, contract.trim(), owner.trim());
      if (bal.error) { setLookup({ error: bal.error, standard: bal.standard }); return; }
      // Value the holding at the collection's floor if the feed knows it.
      const match = collections.find((c) => String(c.contract_address || '').toLowerCase() === contract.trim().toLowerCase());
      const valued = valuePortfolio([{ contract: contract.trim(), balance: Number(bal.balance) }], match ? [match] : []);
      setLookup({ ...bal, ...valued, matched: Boolean(match) });
    } catch (e) {
      setLookup({ error: e?.message || 'Lookup failed' });
    } finally {
      setLooking(false);
    }
  };

  const maxCat = Math.max(1, ...overview.cats.map((c) => c.tvl));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">DeFi &amp; NFT</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Protocol TVL, pool yields, stablecoin pegs and NFT collections from public keyless sources — with the
            capabilities that need a paid key or an indexer declared rather than faked.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {at ? <span className="text-[11px] text-muted-foreground">updated {timeAgo(at)}</span> : null}
          <button onClick={load} className="btn-ghost !h-8 !px-2.5 !text-[11px]">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
          </button>
        </div>
      </div>

      {err ? (
        <p className="flex items-start gap-2 rounded-xl border border-down/40 bg-down/5 p-3 text-[11px] text-down">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{err}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cls('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold',
                tab === t.id ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-accent')}
            >
              <Icon size={12} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ---------------- overview ---------------- */}
      {tab === 'overview' ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Protocols tracked', overview.top.length ? protocols.length : 0],
              ['Chains', chains.length],
              ['Total TVL', fmtCompact(chains.reduce((a, c) => a + (c.tvl || 0), 0))],
              ['Top-1 share', pct(overview.conc.top1SharePct, 1)]
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-border p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</p>
                <p className="num mt-0.5 text-sm font-semibold">{v}</p>
              </div>
            ))}
          </div>

          <Card className="!p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Top protocols by TVL</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Protocol</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 text-right font-medium">TVL</th>
                    <th className="px-4 py-2 text-right font-medium">1d</th>
                    <th className="px-4 py-2 text-right font-medium">Chains</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.top.map((p, i) => (
                    <tr key={p.id || p.name} className="border-t border-border/60">
                      <td className="num px-4 py-1.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-1.5 font-semibold">{p.name}</td>
                      <td className="px-4 py-1.5 text-[11px] text-muted-foreground">{p.category}</td>
                      <td className="num px-4 py-1.5 text-right text-xs">{fmtUsd(p.tvl, 0)}</td>
                      <td className={cls('num px-4 py-1.5 text-right text-xs', (p.change1d ?? 0) >= 0 ? 'text-up' : 'text-down')}>{pct(p.change1d)}</td>
                      <td className="num px-4 py-1.5 text-right text-xs text-muted-foreground">{p.chainCount}</td>
                    </tr>
                  ))}
                  {!overview.top.length ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">Waiting for protocol data…</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="!p-4">
            <p className="mb-3 text-sm font-semibold">TVL by category</p>
            <div className="space-y-2">
              {overview.cats.map((c) => (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span>{c.category}</span>
                    <span className="num text-muted-foreground">{fmtCompact(c.tvl)} · {(c.sharePct ?? 0).toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (c.tvl / maxCat) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {/* ---------------- yields ---------------- */}
      {tab === 'yields' ? (
        <>
          <Card className="!p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Minimum pool TVL (USD)</p>
                <input
                  type="number"
                  value={minTvl}
                  step="100000"
                  onChange={(e) => setMinTvl(Math.max(0, Number(e.target.value)))}
                  className="input-dark !h-8 num !w-36 !text-[11px]"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[11px]">
                <input type="checkbox" checked={stableOnly} onChange={(e) => setStableOnly(e.target.checked)} />
                Stablecoin pools only
              </label>
              <p className="text-[11px] text-muted-foreground">
                {yields.eligible} of {yields.scanned} pools eligible · excluded{' '}
                {yields.excluded.lowTvl} thin, {yields.excluded.noApy} with no APY
              </p>
            </div>
          </Card>

          <Card className="!p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Highest yields</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                A high APY on a thin pool is usually a farm about to be drained, which is why a minimum TVL applies and
                every exclusion is counted.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Pool</th>
                    <th className="px-4 py-2 font-medium">Chain</th>
                    <th className="px-4 py-2 text-right font-medium">TVL</th>
                    <th className="px-4 py-2 text-right font-medium">APY</th>
                    <th className="px-4 py-2 text-right font-medium">Reward share</th>
                    <th className="px-4 py-2 font-medium">Yield quality</th>
                  </tr>
                </thead>
                <tbody>
                  {yields.pools.map((p) => {
                    const q = yieldQuality(p);
                    return (
                      <tr key={p.pool} className="border-t border-border/60">
                        <td className="px-4 py-1.5">
                          <span className="text-xs font-semibold">{p.symbol}</span>
                          <span className="ml-1.5 text-[10px] text-muted-foreground">{p.project}</span>
                        </td>
                        <td className="px-4 py-1.5 text-[11px] text-muted-foreground">{p.chain}</td>
                        <td className="num px-4 py-1.5 text-right text-xs">{fmtCompact(p.tvl)}</td>
                        <td className={cls('num px-4 py-1.5 text-right text-xs font-semibold', (p.apy ?? 0) >= 100 ? 'text-down' : 'text-up')}>
                          {p.apy == null ? '—' : `${p.apy.toFixed(2)}%`}
                        </td>
                        <td className="num px-4 py-1.5 text-right text-xs">{p.rewardSharePct == null ? '—' : `${p.rewardSharePct.toFixed(0)}%`}</td>
                        <td className="px-4 py-1.5">
                          <span className={cls('rounded px-1.5 py-0.5 text-[10px] font-semibold',
                            q === 'organic' ? 'bg-up/15 text-up' : q === 'mixed' ? 'bg-primary/15 text-primary' : 'bg-down/15 text-down')}>
                            {q}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!yields.pools.length ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">No pools match the filter.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}

      {/* ---------------- stablecoins ---------------- */}
      {tab === 'stables' ? (
        <Card className="!p-0">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Stablecoins &amp; peg health</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Deviation from $1.00 is computed explicitly — a de-peg is the single most important DeFi risk signal.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Stablecoin</th>
                  <th className="px-4 py-2 font-medium">Mechanism</th>
                  <th className="px-4 py-2 text-right font-medium">Circulating</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  <th className="px-4 py-2 text-right font-medium">Peg deviation</th>
                  <th className="px-4 py-2 text-right font-medium">24h supply</th>
                </tr>
              </thead>
              <tbody>
                {pegs.slice(0, 30).map((s) => (
                  <tr key={s.id || s.symbol} className="border-t border-border/60">
                    <td className="px-4 py-1.5 text-xs font-semibold">{s.symbol}<span className="ml-1.5 font-normal text-muted-foreground">{s.name}</span></td>
                    <td className="px-4 py-1.5 text-[11px] text-muted-foreground">{s.pegMechanism || '—'}</td>
                    <td className="num px-4 py-1.5 text-right text-xs">{s.circulating == null ? '—' : fmtCompact(s.circulating)}</td>
                    <td className="num px-4 py-1.5 text-right text-xs">{s.price == null ? '—' : `$${s.price.toFixed(4)}`}</td>
                    <td className={cls('num px-4 py-1.5 text-right text-xs font-semibold', s.offPeg ? 'text-down' : 'text-up')}>
                      {s.pegDeviationPct == null ? '—' : pct(s.pegDeviationPct, 3)}
                    </td>
                    <td className={cls('num px-4 py-1.5 text-right text-xs', (s.change24hPct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{pct(s.change24hPct)}</td>
                  </tr>
                ))}
                {!pegs.length ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">Waiting for stablecoin data…</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* ---------------- risk ---------------- */}
      {tab === 'risk' ? (
        <>
          <Card className="!p-4">
            <p className="mb-3 text-sm font-semibold">DeFi risk findings</p>
            <div className="space-y-2">
              {risk.findings.map((f) => (
                <div key={f.code} className={cls('rounded-lg border p-3',
                  f.severity === 'high' ? 'border-down/40 bg-down/5' : f.severity === 'medium' ? 'border-primary/40 bg-primary/5' : 'border-border')}>
                  <div className="flex items-center gap-2">
                    <span className={cls('rounded px-1.5 py-0.5 text-[10px] font-semibold',
                      f.severity === 'high' ? 'bg-down/15 text-down' : f.severity === 'medium' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                      {f.severity}
                    </span>
                    <span className="text-[11px] font-semibold">{f.code}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{f.detail}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
              <Info size={13} className="mt-0.5 shrink-0 text-primary" /> <span>{risk.disclaimer}</span>
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CapabilityList items={DEFI_CAPABILITIES} title="DeFi capabilities" />
            <CapabilityList items={NFT_CAPABILITIES} title="NFT capabilities" />
          </div>
        </>
      ) : null}

      {/* ---------------- NFT collections ---------------- */}
      {tab === 'nft' ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Collections', nftStats.collections],
              ['Total market cap', nftStats.totalMcap == null ? '—' : fmtCompact(nftStats.totalMcap)],
              ['24h volume', nftStats.totalVolume24h == null ? '—' : fmtCompact(nftStats.totalVolume24h)],
              ['Median floor', nftStats.medianFloor == null ? '—' : fmtUsd(nftStats.medianFloor, 2)]
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-border p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</p>
                <p className="num mt-0.5 text-sm font-semibold">{v}</p>
              </div>
            ))}
          </div>

          <Card className="!p-4">
            <p className="mb-2 text-sm font-semibold">By chain</p>
            <div className="space-y-2">
              {nftPlatforms.map((p) => (
                <div key={p.platform}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="capitalize">{p.platform}</span>
                    <span className="num text-muted-foreground">{p.collections} collections · {(p.sharePct ?? 0).toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, p.sharePct ?? 0)}%` }} />
                  </div>
                </div>
              ))}
              {!nftPlatforms.length ? <p className="text-[11px] text-muted-foreground">Waiting for collection data…</p> : null}
            </div>
          </Card>

          <Card className="!p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Top collections by market cap</p>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {nftTop.map((c) => (
                <div key={c.id} className="flex gap-3 rounded-xl border border-border p-3">
                  {c.image ? <img src={c.image} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : null}
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{c.name}</p>
                    <p className="text-[10px] capitalize text-muted-foreground">{c.platform}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[10px]">
                      <span>Floor <b className="num">{c.floor == null ? '—' : fmtUsd(c.floor, 2)}</b></span>
                      <span>24h <b className="num">{c.volume24h == null ? '—' : fmtCompact(c.volume24h)}</b></span>
                      <span className={cls('num', (c.change24h ?? 0) >= 0 ? 'text-up' : 'text-down')}>{pct(c.change24h)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {!nftTop.length ? (
                <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
                  No collection data — the NFT feed shares the app&apos;s CoinGecko quota, so a rate limit is likely.
                </p>
              ) : null}
            </div>
          </Card>
        </>
      ) : null}

      {/* ---------------- NFT portfolio ---------------- */}
      {tab === 'nftfolio' ? (
        <Card className="!p-4">
          <p className="mb-2 text-sm font-semibold">Value a held collection</p>
          <p className="mb-3 text-[11px] text-muted-foreground">
            The owned count is read on-chain with <span className="num">balanceOf</span>; the price is the live floor from
            the market feed. Floor × quantity is a <b>lower bound</b> — any token above floor is worth more, and a
            collection with no live floor is excluded rather than guessed.
          </p>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <p className="mb-0.5 text-[10px] text-muted-foreground">Chain</p>
              <select value={chain} onChange={(e) => setChain(e.target.value)} className="input-dark !h-8 !text-[11px]">
                {Object.keys(EVM_RPC).map((c) => <option key={c} value={c}>{EVM_RPC[c].name}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-0.5 text-[10px] text-muted-foreground">Collection contract</p>
              <input value={contract} onChange={(e) => setContract(e.target.value)} placeholder="0x…" className="input-dark !h-8 num !text-[11px]" />
            </div>
            <div>
              <p className="mb-0.5 text-[10px] text-muted-foreground">Owner</p>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="0x…" className="input-dark !h-8 num !text-[11px]" />
            </div>
          </div>

          <button onClick={runLookup} disabled={looking || !contract || !owner} className="btn-primary mt-3 !h-8 px-3 !text-[11px] disabled:opacity-50">
            {looking ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Value holding
          </button>

          {lookup ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/25 p-3 text-[11px]">
              {lookup.error ? (
                <p className="text-down">{lookup.error}</p>
              ) : (
                <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">Standard</span><b>{lookup.standard}</b></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tokens owned</span><b className="num">{String(lookup.balance)}</b></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Floor price</span><b className="num">{lookup.rows?.[0]?.floor == null ? 'not in feed' : fmtUsd(lookup.rows[0].floor, 2)}</b></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Floor value</span><b className="num">{lookup.floorValue ? fmtUsd(lookup.floorValue, 2) : '—'}</b></div>
                  {lookup.note ? <p className="col-span-full mt-1 text-[10px] text-muted-foreground">{lookup.note}</p> : null}
                </div>
              )}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
