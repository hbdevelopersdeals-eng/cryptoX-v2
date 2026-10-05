import React, { useEffect, useState } from 'react';
import {
  Boxes, ArrowLeftRight, Search, FileCode2, Radio, Server, Loader2, AlertTriangle,
  Info, RefreshCw, Check, Ban
} from 'lucide-react';
import { useAddressBook } from '../lib/prefs.jsx';
import { EVM_RPC } from '../lib/wallets.js';
import { suggestFees } from '../lib/evmRead.js';
import {
  btcBlocks, btcBlock, btcTx, btcAddress, btcAddressTxs, btcMempool, btcFees, btcTipHeight,
  evmBlock, evmTx, evmAddress, detectInterfaces, detectAbi, evmTransfers, evmPendingCount,
  solValidators, ethValidators, EXPLORER_GAPS
} from '../lib/explorer.js';
import { LABEL_KINDS } from '../lib/labels.js';
import { Card } from '../components/ui.jsx';

const TABS = [
  { id: 'blocks', label: 'Blocks', icon: Boxes },
  { id: 'txs', label: 'Transactions', icon: ArrowLeftRight },
  { id: 'address', label: 'Addresses', icon: Search },
  { id: 'contracts', label: 'Contracts & Tokens', icon: FileCode2 },
  { id: 'mempool', label: 'Mempool & Gas', icon: Radio },
  { id: 'validators', label: 'Validators', icon: Server }
];

const EVM_CHAINS = Object.keys(EVM_RPC);

const short = (s, n = 14) => (s && s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-8)}` : s || '—');
const sats = (v) => (v == null ? '—' : `${(v / 1e8).toFixed(8)} BTC`);
const wei = (v) => (v == null ? '—' : `${(Number(v) / 1e18).toFixed(6)} ETH`);

export default function ExplorerPage() {
  const [tab, setTab] = useState('blocks');
  const [book] = useAddressBook();

  const [evmChain, setEvmChain] = useState('ethereum');
  const [btcBlocksList, setBtcBlocksList] = useState(null);
  const [btcTip, setBtcTip] = useState(null);
  const [busy, setBusy] = useState(false);

  /* lookup state */
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState(null);
  const [lookupErr, setLookupErr] = useState(null);

  /* contract state */
  const [contractAddr, setContractAddr] = useState('');
  const [contract, setContract] = useState(null);
  const [contractBusy, setContractBusy] = useState(false);

  /* mempool / gas */
  const [mp, setMp] = useState(null);
  const [fees, setFees] = useState(null);
  const [pending, setPending] = useState(null);
  const [mpBusy, setMpBusy] = useState(false);

  /* validators */
  const [sol, setSol] = useState(null);
  const [beacon, setBeacon] = useState(null);
  const [valBusy, setValBusy] = useState(false);

  const loadBtcBlocks = async () => {
    setBusy(true);
    const [b, tip] = await Promise.all([btcBlocks(), btcTipHeight()]);
    setBtcBlocksList(b.ok ? b.blocks.slice(0, 12) : { error: b.error });
    setBtcTip(tip.ok ? tip.height : null);
    setBusy(false);
  };

  useEffect(() => { if (tab === 'blocks' && !btcBlocksList) loadBtcBlocks(); /* eslint-disable-line */ }, [tab]);

  const doLookup = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setLookupErr(null);
    setLookup(null);

    if (tab === 'blocks') {
      const r = /^0x[0-9a-fA-F]{64}$/.test(q) || /^\d+$/.test(q)
        ? await evmBlock(evmChain, q)
        : await btcBlock(q);
      if (!r.ok) setLookupErr(r.error);
      else setLookup({ kind: 'block', ...r });
    } else if (tab === 'txs') {
      const r = /^0x/.test(q) ? await evmTx(evmChain, q) : await btcTx(q);
      if (!r.ok) setLookupErr(r.error);
      else setLookup({ kind: 'tx', ...r });
    } else if (tab === 'address') {
      const isEvm = /^0x[0-9a-fA-F]{40}$/.test(q);
      if (isEvm) {
        const r = await evmAddress(evmChain, q, { addressBook: book });
        if (!r.ok) setLookupErr(r.error);
        else {
          const t = await evmTransfers(evmChain, { address: q, limit: 15 });
          setLookup({ kind: 'address', ...r, transfers: t.ok ? t.logs : [], transferError: t.ok ? null : t.error });
        }
      } else {
        const [r, txs] = await Promise.all([btcAddress(q), btcAddressTxs(q)]);
        if (!r.ok) setLookupErr(r.error);
        else setLookup({ kind: 'address', btc: r, txs: txs.ok ? txs.txs : [] });
      }
    }
    setBusy(false);
  };

  const inspectContract = async () => {
    const a = contractAddr.trim();
    setContractBusy(true);
    setContract(null);
    const [iface, abi, addr] = await Promise.all([
      detectInterfaces(evmChain, a),
      detectAbi(evmChain, a),
      evmAddress(evmChain, a, { addressBook: book })
    ]);
    setContract({ iface, abi, addr });
    setContractBusy(false);
  };

  const loadMempool = async () => {
    setMpBusy(true);
    const [m, f, p] = await Promise.all([btcMempool(), btcFees(), evmPendingCount(evmChain)]);
    setMp(m);
    setFees(f);
    setPending(p);
    setMpBusy(false);
  };

  const loadValidators = async () => {
    setValBusy(true);
    const [s, b] = await Promise.all([solValidators(20), ethValidators(15)]);
    setSol(s);
    setBeacon(b);
    setValBusy(false);
  };

  const labelKind = lookup?.label?.kind ? LABEL_KINDS[lookup.label.kind] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Blockchain Explorer</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Blocks, transactions, addresses, tokens, contracts, transfers, gas, validators and the mempool — read from
            public keyless endpoints. Real data only; anything needing an indexer is declared, not approximated.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={evmChain} onChange={(e) => setEvmChain(e.target.value)} className="input-dark !h-9 !w-auto !text-xs" aria-label="EVM chain">
            {EVM_CHAINS.map((c) => <option key={c} value={c}>{EVM_RPC[c].name}</option>)}
          </select>
          {tab === 'blocks' ? (
            <button onClick={loadBtcBlocks} disabled={busy} className="btn-ghost !h-9 !px-3 !text-xs">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setLookup(null); setLookupErr(null); setQuery(''); }}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${on ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ---------------- Blocks ---------------- */}
      {tab === 'blocks' ? (
        <>
          <Card className="!p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[18rem] flex-1">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Block height (Bitcoin) or number / 0x hash ({EVM_RPC[evmChain].name})
                </p>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doLookup(); }}
                  placeholder="e.g. 969479  or  0x…"
                  className="input-dark !h-10 font-mono !text-xs"
                />
              </div>
              <button onClick={doLookup} disabled={busy || !query.trim()} className="btn-primary !h-10 px-4 !text-xs">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Look up
              </button>
            </div>
            {lookupErr ? <p className="mt-2 text-[11px] text-down">{lookupErr}</p> : null}
          </Card>

          {lookup?.kind === 'block' ? (
            lookup.block ? (
              <Card className="!p-4">
                <p className="text-sm font-semibold">EVM block #{lookup.block.number?.toString()}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                  {[
                    ['Hash', short(lookup.block.hash, 18)],
                    ['Timestamp', lookup.block.timestamp ? new Date(Number(lookup.block.timestamp) * 1000).toLocaleString() : '—'],
                    ['Transactions', lookup.block.txCount],
                    ['Gas used', lookup.block.gasUsed?.toString()],
                    ['Gas limit', lookup.block.gasLimit?.toString()],
                    ['Base fee', lookup.block.baseFeePerGas ? `${(Number(lookup.block.baseFeePerGas) / 1e9).toFixed(4)} gwei` : '—'],
                    ['Miner', short(lookup.block.miner, 12)],
                    ['Size', lookup.block.size ? `${lookup.block.size} bytes` : '—']
                  ].map(([k, v]) => (
                    <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="num mt-0.5 font-semibold">{String(v)}</dd></div>
                  ))}
                </dl>
              </Card>
            ) : (
              <Card className="!p-4">
                <p className="text-sm font-semibold">Bitcoin block #{lookup.block.height}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                  {[
                    ['Hash', short(lookup.hash, 18)],
                    ['Transactions', lookup.block.tx_count],
                    ['Size', `${lookup.block.size} bytes`],
                    ['Weight', lookup.block.weight]
                  ].map(([k, v]) => (
                    <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="num mt-0.5 font-semibold">{String(v)}</dd></div>
                  ))}
                </dl>
                {lookup.txs?.length ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">First {lookup.txs.length} transactions</p>
                    <div className="space-y-1">
                      {lookup.txs.map((t) => (
                        <p key={t.txid} className="truncate font-mono text-[10px] text-muted-foreground">{t.txid}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
            )
          ) : null}

          <Card className="!p-0">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Latest Bitcoin blocks</p>
              {btcTip ? <p className="num text-[11px] text-muted-foreground">tip height {btcTip}</p> : null}
            </div>
            {!btcBlocksList ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</p>
            ) : btcBlocksList.error ? (
              <p className="px-4 py-6 text-center text-xs text-down">{btcBlocksList.error}</p>
            ) : (
              <div className="divide-y divide-border/60">
                {btcBlocksList.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                    <span className="num font-semibold">#{b.height}</span>
                    <span className="hidden font-mono text-[10px] text-muted-foreground sm:block">{short(b.id, 20)}</span>
                    <span className="num text-muted-foreground">{b.tx_count} txs</span>
                    <span className="text-muted-foreground">{new Date(b.timestamp * 1000).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}

      {/* ---------------- Transactions ---------------- */}
      {tab === 'txs' ? (
        <>
          <Card className="!p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[18rem] flex-1">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Transaction id — 64 hex chars (Bitcoin) or 0x… ({EVM_RPC[evmChain].name})
                </p>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doLookup(); }}
                  placeholder="Paste a transaction id"
                  className="input-dark !h-10 font-mono !text-xs"
                />
              </div>
              <button onClick={doLookup} disabled={busy || !query.trim()} className="btn-primary !h-10 px-4 !text-xs">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Look up
              </button>
            </div>
            {lookupErr ? <p className="mt-2 text-[11px] text-down">{lookupErr}</p> : null}
          </Card>

          {lookup?.kind === 'tx' && lookup.tx?.hash ? (
            <>
              <Card className="!p-4">
                <p className="text-sm font-semibold">EVM transaction</p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{lookup.tx.hash}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
                  {[
                    ['From', short(lookup.tx.from, 10)],
                    ['To', lookup.tx.to ? short(lookup.tx.to, 10) : 'contract creation'],
                    ['Value', wei(lookup.tx.value)],
                    ['Nonce', lookup.tx.nonce?.toString()],
                    ['Block', lookup.tx.blockNumber?.toString() || 'pending'],
                    ['Gas limit', lookup.tx.gas?.toString()],
                    ['Function selector', lookup.tx.selector || '—'],
                    ['Status', lookup.receipt?.status === 1n ? 'success' : lookup.receipt ? 'reverted' : 'pending']
                  ].map(([k, v]) => (
                    <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="num mt-0.5 font-semibold">{String(v)}</dd></div>
                  ))}
                </dl>
                {lookup.receipt ? (
                  <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
                    Gas used <b className="text-foreground">{lookup.receipt.gasUsed?.toString()}</b> ·{' '}
                    effective price <b className="text-foreground">{lookup.receipt.effectiveGasPrice ? `${(Number(lookup.receipt.effectiveGasPrice) / 1e9).toFixed(3)} gwei` : '—'}</b> ·{' '}
                    {lookup.receipt.logCount} log{lookup.receipt.logCount === 1 ? '' : 's'} emitted
                    {lookup.receipt.contractAddress ? ` · deployed ${short(lookup.receipt.contractAddress, 10)}` : ''}
                  </p>
                ) : null}
              </Card>
            </>
          ) : null}

          {lookup?.kind === 'tx' && lookup.tx?.txid ? (
            <Card className="!p-4">
              <p className="text-sm font-semibold">Bitcoin transaction</p>
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{lookup.tx.txid}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                {[
                  ['Status', lookup.status?.confirmed ? `confirmed in block ${lookup.status.block_height}` : 'unconfirmed (mempool)'],
                  ['Size', `${lookup.tx.size} bytes`],
                  ['Weight', lookup.tx.weight],
                  ['Fee', lookup.tx.fee != null ? `${lookup.tx.fee} sats` : '—'],
                  ['Inputs', lookup.tx.vin?.length ?? '—'],
                  ['Outputs', lookup.tx.vout?.length ?? '—'],
                  ['Total out', sats((lookup.tx.vout || []).reduce((a, o) => a + (o.value || 0), 0))],
                  ['Fee rate', lookup.tx.weight ? `${(lookup.tx.fee / (lookup.tx.weight / 4)).toFixed(2)} sat/vB` : '—']
                ].map(([k, v]) => (
                  <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="num mt-0.5 font-semibold">{String(v)}</dd></div>
                ))}
              </dl>
            </Card>
          ) : null}
        </>
      ) : null}

      {/* ---------------- Addresses ---------------- */}
      {tab === 'address' ? (
        <>
          <Card className="!p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[18rem] flex-1">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  0x address ({EVM_RPC[evmChain].name}) or a Bitcoin address
                </p>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doLookup(); }}
                  placeholder="Paste an address"
                  className="input-dark !h-10 font-mono !text-xs"
                />
              </div>
              <button onClick={doLookup} disabled={busy || !query.trim()} className="btn-primary !h-10 px-4 !text-xs">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Look up
              </button>
            </div>
            {lookupErr ? <p className="mt-2 text-[11px] text-down">{lookupErr}</p> : null}
          </Card>

          {lookup?.kind === 'address' && lookup.address ? (
            <>
              <Card className="!p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{lookup.label.label || 'Unlabelled address'}</p>
                  {labelKind ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${labelKind.cls}`}>{labelKind.label}</span> : null}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {lookup.isContract ? `Contract · ${lookup.codeSize} bytes` : 'Wallet (EOA)'}
                  </span>
                  {lookup.label.source ? <span className="text-[10px] text-muted-foreground">via {lookup.label.source}</span> : null}
                </div>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{lookup.address}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                  {[
                    ['Balance', wei(lookup.balanceWei)],
                    ['Nonce', lookup.nonce?.toString()],
                    ['Token', lookup.token?.symbol || '—'],
                    ['Token supply', lookup.token?.formattedSupply != null ? lookup.token.formattedSupply.toLocaleString() : '—']
                  ].map(([k, v]) => (
                    <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="num mt-0.5 font-semibold">{String(v)}</dd></div>
                  ))}
                </dl>
                {lookup.impersonation ? (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] text-destructive">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {lookup.impersonation.message}
                  </p>
                ) : null}
              </Card>

              <Card className="!p-0">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold">Transfers</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Decoded from ERC-20/721 Transfer logs, newest first. Public RPC caps log ranges, so the most recent
                    2,000 blocks are scanned.
                  </p>
                </div>
                {!lookup.transfers?.length ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                    {lookup.transferError ? `Could not read logs: ${lookup.transferError}` : 'No transfers in the scanned range.'}
                  </p>
                ) : (
                  <div className="divide-y divide-border/60">
                    {lookup.transfers.map((t) => (
                      <div key={`${t.txHash}-${t.logIndex}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                        <span className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            t.from.toLowerCase() === lookup.address.toLowerCase() ? 'bg-down/15 text-down' : 'bg-up/15 text-up'
                          }`}>
                            {t.from.toLowerCase() === lookup.address.toLowerCase() ? 'OUT' : 'IN'}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">{short(t.token, 8)}</span>
                        </span>
                        <span className="num text-muted-foreground">
                          {t.tokenId != null ? `token #${t.tokenId}` : t.rawValue != null ? `raw ${t.rawValue}` : '—'}
                        </span>
                        <span className="num text-muted-foreground">block {t.blockNumber.toString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          ) : null}

          {lookup?.kind === 'address' && lookup.btc ? (
            <>
              <Card className="!p-4">
                <p className="text-sm font-semibold">Bitcoin address</p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{lookup.btc.address}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                  {[
                    ['Balance', sats(lookup.btc.balanceSats)],
                    ['Pending', sats(lookup.btc.pendingSats)],
                    ['Transactions', lookup.btc.txCount],
                    ['Total received', sats(lookup.btc.fundedSats)],
                    ['Total sent', sats(lookup.btc.spentSats)],
                    ['Fees paid', `${lookup.btc.feesSats} sats`],
                    ['Mempool txs', lookup.btc.mempoolTxCount]
                  ].map(([k, v]) => (
                    <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="num mt-0.5 font-semibold">{String(v)}</dd></div>
                  ))}
                </dl>
              </Card>
              {lookup.txs?.length ? (
                <Card className="!p-0">
                  <div className="border-b border-border px-4 py-3"><p className="text-sm font-semibold">Recent transactions</p></div>
                  <div className="divide-y divide-border/60">
                    {lookup.txs.map((t) => (
                      <div key={t.txid} className="px-4 py-2.5">
                        <p className="truncate font-mono text-[10px] text-muted-foreground">{t.txid}</p>
                        <p className="num mt-0.5 text-[11px]">
                          {t.status?.confirmed ? `block ${t.status.block_height}` : 'unconfirmed'} · fee {t.fee} sats
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {/* ---------------- Contracts & tokens ---------------- */}
      {tab === 'contracts' ? (
        <>
          <Card className="!p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[18rem] flex-1">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Contract address on {EVM_RPC[evmChain].name}
                </p>
                <input
                  value={contractAddr}
                  onChange={(e) => setContractAddr(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') inspectContract(); }}
                  placeholder="0x…"
                  className="input-dark !h-10 font-mono !text-xs"
                />
              </div>
              <button onClick={inspectContract} disabled={contractBusy || !contractAddr.trim()} className="btn-primary !h-10 px-4 !text-xs">
                {contractBusy ? <Loader2 size={14} className="animate-spin" /> : <FileCode2 size={14} />} Inspect
              </button>
            </div>
          </Card>

          {contract ? (
            <>
              <Card className="!p-4">
                <p className="text-sm font-semibold">{contract.addr.label?.label || 'Contract'}</p>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Interface (ERC-165)</p>
                    {contract.iface.supported?.length ? (
                      <ul className="mt-1 space-y-0.5">
                        {contract.iface.labels.map((l) => (
                          <li key={l} className="flex items-center gap-1.5 text-xs"><Check size={11} className="text-up" /> {l}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {contract.iface.erc165Responded ? 'No standard interface declared' : 'ERC-165 not implemented'}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Token surface</p>
                    <p className="text-xs">
                      {contract.addr.token?.isErc20
                        ? `${contract.addr.token.symbol || '?'} · ${contract.addr.token.decimals} decimals · supply ${contract.addr.token.formattedSupply?.toLocaleString() ?? '—'}`
                        : 'Not an ERC-20'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Code size</p>
                    <p className="num text-xs">{contract.addr.isContract ? `${contract.addr.codeSize} bytes` : 'No code — not a contract'}</p>
                  </div>
                </div>
                {contract.addr.impersonation ? (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] text-destructive">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {contract.addr.impersonation.message}
                  </p>
                ) : null}
              </Card>

              <Card className="!p-0">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold">Detected ABI</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{contract.abi.note}</p>
                </div>
                <div className="p-4">
                  <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Responded to probe ({contract.abi.confirmed.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {contract.abi.confirmed.length ? contract.abi.confirmed.map((c) => (
                      <span key={c} className="rounded bg-up/15 px-2 py-0.5 text-[11px] font-medium text-up">{c}()</span>
                    )) : <span className="text-xs text-muted-foreground">Nothing responded.</span>}
                  </div>
                  {contract.abi.details?.some((d) => !d.responded) ? (
                    <>
                      <p className="mb-2 mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Did not respond</p>
                      <div className="flex flex-wrap gap-1.5">
                        {contract.abi.details.filter((d) => !d.responded).map((d) => (
                          <span key={d.name} className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{d.name}()</span>
                        ))}
                      </div>
                    </>
                  ) : null}
                  <details className="mt-4">
                    <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-muted-foreground">JSON ABI ({contract.abi.abi.abi.length} entries)</summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[10px] leading-relaxed">
{JSON.stringify(contract.abi.abi.abi, null, 2)}
                    </pre>
                  </details>
                </div>
              </Card>
            </>
          ) : null}

          <Card className="!p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><Ban size={15} className="text-down" /> Not available in this build</p>
            <div className="mt-2 space-y-2">
              {EXPLORER_GAPS.map((g) => (
                <div key={g.id} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  <p className="text-[11px] text-muted-foreground"><b className="text-foreground">{g.label}</b> — {g.reason}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {/* ---------------- Mempool & gas ---------------- */}
      {tab === 'mempool' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Bitcoin mempool plus live fee estimates, and EVM pending + fees.</p>
            <button onClick={loadMempool} disabled={mpBusy} className="btn-primary !h-9 px-3 !text-xs">
              {mpBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
            </button>
          </div>

          {mp?.ok ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ['Pending transactions', mp.count?.toLocaleString()],
                ['Mempool size', `${(mp.vsize / 1e6).toFixed(2)} MvB`],
                ['Total fees waiting', `${(mp.total_fee / 1e8).toFixed(4)} BTC`]
              ].map(([k, v]) => (
                <Card key={k} className="!p-4">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p>
                  <p className="num mt-1 text-lg font-bold">{v}</p>
                </Card>
              ))}
            </div>
          ) : mp?.error ? (
            <Card className="!p-4"><p className="text-xs text-down">{mp.error}</p></Card>
          ) : null}

          {fees?.ok ? (
            <Card className="!p-0">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Bitcoin fee estimates</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">sat/vB by target confirmation time</p>
              </div>
              <div className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-5">
                {['1', '3', '6', '12', '144'].map((t) => (
                  <div key={t}>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t === '144' ? '~1 day' : `${t} block${t === '1' ? '' : 's'}`}</p>
                    <p className="num mt-1 text-sm font-bold">{fees.estimates?.[t] != null ? fees.estimates[t].toFixed(1) : '—'}</p>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="!p-4">
            <p className="text-sm font-semibold">{EVM_RPC[evmChain].name} pending &amp; fees</p>
            {pending?.ok ? (
              <p className="num mt-2 text-xs">Pending transactions in the candidate block: <b className="text-foreground">{pending.pending}</b></p>
            ) : pending?.error ? (
              <p className="mt-2 text-xs text-muted-foreground">Pending block unavailable: {pending.error}</p>
            ) : null}
            <button
              onClick={async () => { setMpBusy(true); setFees((f) => f); const r = await suggestFees(evmChain); setPending((p) => p); setMp((m) => m); setFees(r); setMpBusy(false); }}
              className="btn-ghost mt-3 !h-8 !px-2.5 !text-[11px]"
            >
              Fetch EVM fees
            </button>
            {fees?.eip1559 ? (
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                {[
                  ['Base fee', `${(Number(fees.baseFeePerGas) / 1e9).toFixed(4)} gwei`],
                  ['Priority tip', `${(Number(fees.maxPriorityFeePerGas) / 1e9).toFixed(4)} gwei`],
                  ['Suggested max fee', `${(Number(fees.maxFeePerGas) / 1e9).toFixed(4)} gwei`]
                ].map(([k, v]) => (
                  <div key={k}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p><p className="num mt-0.5 text-sm font-bold">{v}</p></div>
                ))}
              </div>
            ) : fees?.gasPrice != null ? (
              <p className="num mt-2 text-xs">Legacy gas price: {(Number(fees.gasPrice) / 1e9).toFixed(4)} gwei</p>
            ) : null}
            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info size={12} className="mt-0.5 shrink-0" />
              EVM mempool introspection (full pending-transaction contents) needs the non-standard <code className="mx-1">txpool_*</code> namespace,
              which public RPC providers disable. Only Bitcoin offers a true public mempool view.
            </p>
          </Card>
        </>
      ) : null}

      {/* ---------------- Validators ---------------- */}
      {tab === 'validators' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Solana vote accounts give real activated stake; Ethereum validators come from the consensus-layer beacon API.
            </p>
            <button onClick={loadValidators} disabled={valBusy} className="btn-primary !h-9 px-3 !text-xs">
              {valBusy ? <Loader2 size={13} className="animate-spin" /> : <Server size={13} />} Load validators
            </button>
          </div>

          {sol?.ok ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ['Active validators', sol.current],
                  ['Delinquent', sol.delinquent],
                  ['Total activated stake', `${(sol.totalActivatedStakeSol / 1e6).toFixed(2)}M SOL`],
                  ['Average commission', sol.commissionAvg != null ? `${sol.commissionAvg.toFixed(2)}%` : '—']
                ].map(([k, v]) => (
                  <Card key={k} className="!p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p>
                    <p className="num mt-1 text-lg font-bold">{v}</p>
                  </Card>
                ))}
              </div>
              <Card className="!p-0">
                <div className="border-b border-border px-4 py-3"><p className="text-sm font-semibold">Solana — top validators by stake</p></div>
                <div className="divide-y divide-border/60">
                  {sol.sample.map((v) => (
                    <div key={v.votePubkey} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                      <span className="flex items-center gap-2">
                        <span className="num w-6 text-muted-foreground">#{v.rank}</span>
                        <span className="font-mono text-[10px]">{short(v.votePubkey, 12)}</span>
                      </span>
                      <span className="flex items-center gap-3 text-muted-foreground">
                        <span className="num">{((v.stakeSol * 1e9) / 1e9).toFixed(0)} SOL</span>
                        <span className="num">{v.commission}% fee</span>
                        <span className="num">{v.sharePct?.toFixed(3)}%</span>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : sol?.error ? (
            <Card className="!p-4"><p className="text-xs text-down">{sol.error}</p></Card>
          ) : null}

          {beacon?.ok ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {[
                  ['Validators in state', beacon.total?.toLocaleString()],
                  ['Active', beacon.active?.toLocaleString()],
                  ['Beacon slot', beacon.slot]
                ].map(([k, v]) => (
                  <Card key={k} className="!p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p>
                    <p className="num mt-1 text-lg font-bold">{String(v)}</p>
                  </Card>
                ))}
              </div>
              <Card className="!p-0">
                <div className="border-b border-border px-4 py-3"><p className="text-sm font-semibold">Ethereum validators (first page)</p></div>
                <div className="divide-y divide-border/60">
                  {beacon.sample.map((v) => (
                    <div key={v.index} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                      <span className="flex items-center gap-2">
                        <span className="num w-12 text-muted-foreground">#{v.index}</span>
                        <span className="font-mono text-[10px]">{short(v.pubkey, 12)}</span>
                      </span>
                      <span className="flex items-center gap-3 text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{v.status}</span>
                        <span className="num">{v.balanceEth?.toFixed(4)} ETH</span>
                        <span className="num">eff. {v.effectiveBalanceEth?.toFixed(0)} ETH</span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                  Validator data is paged by the API; this shows the first page of the state, not the full set.
                </p>
              </Card>
            </>
          ) : beacon?.error ? (
            <Card className="!p-4"><p className="text-xs text-down">{beacon.error}</p></Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
