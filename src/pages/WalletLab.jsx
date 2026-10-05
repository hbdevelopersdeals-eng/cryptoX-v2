import React, { useMemo, useState } from 'react';
import {
  Shield, ShieldAlert, Search, Fuel, FlaskConical, KeyRound, Route, Check, Ban,
  AlertTriangle, Loader2, Plus, X, Info
} from 'lucide-react';
import { useAddressBook } from '../lib/prefs.jsx';
import { WALLET_CHAINS, chainById, derivePath, validateChainAddress, checksumLabel } from '../lib/chains.js';
import { CUSTODY_POLICY, CAPABILITIES, capabilitySummary, assessAddressRisk, analyseApprovals } from '../lib/walletSecurity.js';
import { EVM_RPC } from '../lib/wallets.js';
import { suggestFees, simulateCall, estimateGas, inspectAddress, readAllowance, readTokenMeta, SIG } from '../lib/evmRead.js';
import { Card } from '../components/ui.jsx';

const TABS = [
  { id: 'policy', label: 'Custody policy', icon: Shield },
  { id: 'check', label: 'Address check', icon: Search },
  { id: 'chains', label: 'Chains & paths', icon: Route },
  { id: 'gas', label: 'Gas & simulate', icon: Fuel },
  { id: 'approvals', label: 'Approvals', icon: FlaskConical },
  { id: 'caps', label: 'Capabilities', icon: KeyRound }
];

const EVM_CHAINS = Object.keys(EVM_RPC);
const RESULT_CHAINS = [...EVM_CHAINS, 'bitcoin', 'solana', 'tron', 'xrp', 'sui', 'aptos', 'ton', 'cosmos', 'polkadot', 'cardano'];

const gwei = (v) => (v == null ? '—' : `${(Number(v) / 1e9).toFixed(4)} gwei`);

const STATUS_META = {
  supported: { label: 'Supported', cls: 'bg-up/15 text-up', Icon: Check },
  partial: { label: 'Partial', cls: 'bg-primary/15 text-primary', Icon: AlertTriangle },
  none: { label: 'Not offered', cls: 'bg-down/15 text-down', Icon: Ban }
};

export default function WalletLabPage() {
  const [tab, setTab] = useState('policy');
  const [book, bookApi] = useAddressBook();

  /* address check */
  const [checkChain, setCheckChain] = useState('evm');
  const [checkAddr, setCheckAddr] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [bookLabel, setBookLabel] = useState('');

  /* gas */
  const [gasChain, setGasChain] = useState('ethereum');
  const [fees, setFees] = useState(null);
  const [gasBusy, setGasBusy] = useState(false);

  /* simulation */
  const [sim, setSim] = useState({ chain: 'ethereum', from: '', to: '', data: '', value: '' });
  const [simResult, setSimResult] = useState(null);
  const [simBusy, setSimBusy] = useState(false);

  /* approvals */
  const [owner, setOwner] = useState('');
  const [pairs, setPairs] = useState([{ token: '', spender: '', label: '' }]);
  const [approvalResult, setApprovalResult] = useState(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalChain, setApprovalChain] = useState('ethereum');

  const capSummary = useMemo(() => capabilitySummary(), []);

  const runCheck = async () => {
    if (!checkAddr.trim()) return;
    setCheckBusy(true);
    setCheckResult(null);
    let isContract = null;
    let probeNote = null;
    if (EVM_CHAINS.includes(checkChain)) {
      const probe = await inspectAddress(checkChain, checkAddr.trim());
      if (probe.ok) isContract = probe.isContract;
      else probeNote = probe.error;
    }
    const risk = assessAddressRisk(checkAddr.trim(), checkChain, {
      known: book.map((b) => ({ address: b.address, label: b.label })),
      isContract
    });
    setCheckResult({ ...risk, probeNote, chained: EVM_CHAINS.includes(checkChain) });
    setCheckBusy(false);
  };

  const loadFees = async () => {
    setGasBusy(true);
    setFees(null);
    const f = await suggestFees(gasChain);
    setFees(f);
    setGasBusy(false);
  };

  const runSim = async () => {
    setSimBusy(true);
    setSimResult(null);
    const call = await simulateCall(sim.chain, {
      from: sim.from.trim() || undefined,
      to: sim.to.trim(),
      data: sim.data.trim() || '0x',
      value: sim.value.trim() || null
    });
    let gas = null;
    if (call.ok && call.success && sim.from.trim() && sim.to.trim()) {
      const g = await estimateGas(sim.chain, {
        from: sim.from.trim(),
        to: sim.to.trim(),
        data: sim.data.trim() || '0x',
        value: sim.value.trim() || null
      });
      if (g.ok) gas = g.gas;
    }
    setSimResult({ ...call, gas });
    setSimBusy(false);
  };

  const runApprovals = async () => {
    setApprovalBusy(true);
    const filled = pairs.filter((p) => /^0x[0-9a-fA-F]{40}$/.test(p.token.trim()) && /^0x[0-9a-fA-F]{40}$/.test(p.spender.trim()));
    if (!owner.trim() || !filled.length) {
      setApprovalResult({ error: 'Enter a wallet address and at least one valid token + spender pair.' });
      setApprovalBusy(false);
      return;
    }
    const metas = {};
    const rows = [];
    for (const p of filled) {
      const token = p.token.trim();
      const spender = p.spender.trim();
      if (!metas[token]) metas[token] = await readTokenMeta(approvalChain, token);
      const res = await readAllowance(approvalChain, token, owner.trim(), spender);
      rows.push({
        token,
        symbol: metas[token]?.symbol || null,
        decimals: metas[token]?.decimals ?? null,
        spender,
        spenderLabel: p.label.trim() || null,
        allowance: res.ok && res.allowance != null ? res.allowance : 0n,
        readError: res.ok ? null : res.error
      });
    }
    setApprovalResult({ ...analyseApprovals(rows), rows, readErrors: rows.filter((r) => r.readError).length });
    setApprovalBusy(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Wallet Lab</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A read-only non-custodial toolkit: verify an address before you send, understand a transaction before you sign,
          and audit what you have approved. No keys, no seed phrases, no signing.
        </p>
      </div>

      {/* The single most important statement in this section. */}
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
        <p className="flex items-start gap-2 text-sm">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-primary" />
          <span>
            <b className="text-foreground">This is not a wallet, and it cannot move funds.</b>{' '}
            <span className="text-muted-foreground">
              CryptoX never asks for a seed phrase or private key, never generates or stores key material, and has no ability
              to sign or broadcast a transaction. Send, swap, bridge and stake therefore cannot be executed here — that is a
              deliberate safety boundary, not a missing feature.
            </span>
          </span>
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${on ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ---------------- Policy ---------------- */}
      {tab === 'policy' ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {CUSTODY_POLICY.map((p, i) => (
            <Card key={p.id} className="!p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{i + 1}</span>
                {p.title}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{p.detail}</p>
            </Card>
          ))}
        </div>
      ) : null}

      {/* ---------------- Address check ---------------- */}
      {tab === 'check' ? (
        <>
          <Card className="!p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Chain</p>
                <select value={checkChain} onChange={(e) => setCheckChain(e.target.value)} className="input-dark !h-10 !w-auto !text-xs">
                  {RESULT_CHAINS.map((c) => <option key={c} value={c}>{chainById(c)?.name || c}</option>)}
                </select>
              </div>
              <div className="min-w-[18rem] flex-1">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Address to verify</p>
                <input
                  value={checkAddr}
                  onChange={(e) => setCheckAddr(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runCheck(); }}
                  placeholder="Paste the full address"
                  className="input-dark !h-10 font-mono !text-xs"
                />
              </div>
              <button onClick={runCheck} disabled={checkBusy || !checkAddr.trim()} className="btn-primary !h-10 px-4 !text-xs">
                {checkBusy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Verify
              </button>
            </div>
          </Card>

          {checkResult ? (
            <>
              <Card className="!p-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {checkResult.risk === 'clean'
                    ? <Check size={15} className="text-up" />
                    : <AlertTriangle size={15} className="text-primary" />}
                  Risk: <span className={
                    checkResult.risk === 'clean' ? 'text-up'
                      : checkResult.risk === 'critical' ? 'text-down'
                        : 'text-primary'
                  }>{checkResult.risk}</span>
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Validation</p>
                    <p className={`text-sm font-semibold ${checkResult.validation.ok ? 'text-up' : 'text-down'}`}>
                      {checkResult.validation.ok ? 'Format accepted' : 'Rejected'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {checkResult.validation.ok
                        ? checksumLabel(checkResult.validation.checksum)
                        : checkResult.validation.reason}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Type</p>
                    <p className="text-sm font-semibold">
                      {checkResult.chained
                        ? checkResult.isContract === true ? 'Contract' : checkResult.isContract === false ? 'Wallet (EOA)' : 'Unknown'
                        : 'Not probed'}
                    </p>
                    {checkResult.probeNote ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{checkResult.probeNote}</p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Normalised</p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                      {checkResult.validation.normalized || '—'}
                    </p>
                  </div>
                </div>
                {checkResult.validation.note ? (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
                    <Info size={12} className="mt-0.5 shrink-0" /> {checkResult.validation.note}
                  </p>
                ) : null}
              </Card>

              {checkResult.findings.length ? (
                <Card className="!p-0">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-sm font-semibold">Findings ({checkResult.findings.length})</p>
                  </div>
                  <div className="divide-y divide-border/60">
                    {checkResult.findings.map((f, i) => (
                      <div key={`${f.code}-${i}`} className="flex items-start gap-3 px-4 py-3">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          f.level === 'critical' ? 'bg-down' : f.level === 'high' ? 'bg-primary' : f.level === 'medium' ? 'bg-primary/60' : 'bg-muted-foreground/40'
                        }`} />
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.level}</p>
                          <p className="mt-0.5 text-xs">{f.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : (
                <Card className="!p-4">
                  <p className="text-xs text-muted-foreground">
                    No structural issues found. That does <b>not</b> prove the address is spendable or that it belongs to the
                    person you think — always confirm out-of-band on a second channel.
                  </p>
                </Card>
              )}

              <Card className="!p-4">
                <p className="text-sm font-semibold">Save to address book</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Saved addresses are used to detect lookalike (poisoning) addresses on future checks.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input value={bookLabel} onChange={(e) => setBookLabel(e.target.value)} placeholder="Label, e.g. Cold storage" className="input-dark !h-9 min-w-[14rem] flex-1 !text-xs" />
                  <button
                    onClick={() => {
                      bookApi.add({ address: checkResult.validation.normalized || checkAddr.trim(), label: bookLabel.trim() || 'Saved address' });
                      setBookLabel('');
                    }}
                    disabled={!checkResult.validation.ok}
                    className="btn-primary !h-9 px-3 !text-xs"
                  >
                    <Plus size={13} /> Save
                  </button>
                </div>
              </Card>
            </>
          ) : null}

          <Card className="!p-0">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Address book <span className="text-xs font-normal text-muted-foreground">({book.length})</span></p>
              {book.length ? <button onClick={bookApi.clear} className="btn-ghost !h-8 !px-2.5 !text-[11px]">Clear</button> : null}
            </div>
            {!book.length ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                Empty. Add the addresses you actually send to — that is what makes lookalike detection work.
              </p>
            ) : (
              <div className="divide-y divide-border/60">
                {book.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">{b.label}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">{b.address}</p>
                    </div>
                    <button onClick={() => bookApi.remove(b.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-down/10 hover:text-down"><X size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}

      {/* ---------------- Chains & paths ---------------- */}
      {tab === 'chains' ? (
        <>
          <div className="rounded-xl border border-border bg-muted/30 p-3.5">
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info size={14} className="mt-0.5 shrink-0 text-primary" />
              <span>
                An HD wallet derives every address from one seed using BIP-32/39/44. CryptoX documents the standard paths and
                coin types so you can set the right one in a wallet that <b>does</b> hold keys — it never derives or stores
                anything itself.
              </span>
            </p>
          </div>

          <Card className="!p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Chain</th>
                    <th className="px-3 py-2.5 text-right font-semibold">SLIP-44</th>
                    <th className="px-3 py-2.5 font-semibold">Curve</th>
                    <th className="px-3 py-2.5 font-semibold">Standard paths</th>
                    <th className="px-3 py-2.5 font-semibold">Example (account 0, index 0)</th>
                  </tr>
                </thead>
                <tbody>
                  {WALLET_CHAINS.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold">{c.name}</p>
                        {c.covers ? <p className="text-[10px] text-muted-foreground">{c.covers.join(' · ')}</p> : null}
                      </td>
                      <td className="num px-3 py-2.5 text-right">{c.slip44}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{c.curve}</td>
                      <td className="px-3 py-2.5">
                        {c.paths.map((p) => (
                          <p key={p.path} className="text-[11px]">
                            <span className="text-muted-foreground">{p.label}: </span>
                            <span className="font-mono">{p.path}</span>
                          </p>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{derivePath(c.id) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <b>i</b> is the address index. Bitcoin and EVM chains additionally use a change branch (0 = receive,
              1 = internal). Using the wrong path is why an address can appear “missing” in a restored wallet.
            </p>
          </Card>
        </>
      ) : null}

      {/* ---------------- Gas & simulate ---------------- */}
      {tab === 'gas' ? (
        <>
          <Card className="!p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Live gas &amp; fee estimate</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Read from public RPC (EIP-1559 where supported). Read-only.</p>
              </div>
              <div className="flex items-end gap-2">
                <select value={gasChain} onChange={(e) => setGasChain(e.target.value)} className="input-dark !h-9 !w-auto !text-xs">
                  {EVM_CHAINS.map((c) => <option key={c} value={c}>{EVM_RPC[c].name}</option>)}
                </select>
                <button onClick={loadFees} disabled={gasBusy} className="btn-primary !h-9 px-3 !text-xs">
                  {gasBusy ? <Loader2 size={13} className="animate-spin" /> : <Fuel size={13} />} Fetch
                </button>
              </div>
            </div>

            {fees ? (
              fees.ok ? (
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {fees.eip1559 ? (
                    <>
                      <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Base fee</p><p className="num mt-1 text-sm font-bold">{gwei(fees.baseFeePerGas)}</p></div>
                      <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Priority (tip)</p><p className="num mt-1 text-sm font-bold">{gwei(fees.maxPriorityFeePerGas)}</p></div>
                      <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Max fee</p><p className="num mt-1 text-sm font-bold text-primary">{gwei(fees.maxFeePerGas)}</p></div>
                      <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sampled blocks</p><p className="num mt-1 text-sm font-bold">{fees.sampledBlocks}</p></div>
                    </>
                  ) : (
                    <>
                      <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Legacy gas price</p><p className="num mt-1 text-sm font-bold">{gwei(fees.gasPrice)}</p></div>
                      <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Mode</p><p className="mt-1 text-sm font-bold">Pre-1559</p></div>
                    </>
                  )}
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{fees.error}</p>
              )
            ) : null}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Max fee = 2 × base fee + tip, the standard headroom so a base-fee rise mid-block does not strand the transaction.
            </p>
          </Card>

          <Card className="!p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><FlaskConical size={15} className="text-primary" /> Dry-run a transaction</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Executes the call against current chain state and keeps nothing. Nothing is signed and nothing is broadcast.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Chain</p>
                <select value={sim.chain} onChange={(e) => setSim({ ...sim, chain: e.target.value })} className="input-dark !h-9 !text-xs">
                  {EVM_CHAINS.map((c) => <option key={c} value={c}>{EVM_RPC[c].name}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">From (optional, enables gas estimate)</p>
                <input value={sim.from} onChange={(e) => setSim({ ...sim, from: e.target.value })} placeholder="0x…" className="input-dark !h-9 font-mono !text-xs" />
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">To (contract or wallet)</p>
                <input value={sim.to} onChange={(e) => setSim({ ...sim, to: e.target.value })} placeholder="0x…" className="input-dark !h-9 font-mono !text-xs" />
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Value (wei, optional)</p>
                <input value={sim.value} onChange={(e) => setSim({ ...sim, value: e.target.value })} placeholder="0" className="input-dark !h-9 num !text-xs" />
              </div>
              <div className="md:col-span-2">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Calldata (optional)</p>
                <input value={sim.data} onChange={(e) => setSim({ ...sim, data: e.target.value })} placeholder={`0x…  e.g. decimals() is ${SIG.decimals}`} className="input-dark !h-9 font-mono !text-xs" />
              </div>
            </div>
            <button onClick={runSim} disabled={simBusy || !sim.to.trim()} className="btn-primary mt-3 !h-9 px-3 !text-xs">
              {simBusy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Simulate
            </button>

            {simResult ? (
              <div className={`mt-3 rounded-lg border p-3 ${simResult.success ? 'border-up/40 bg-up/5' : 'border-destructive/40 bg-destructive/5'}`}>
                <p className="text-xs font-semibold">
                  {simResult.success ? 'Call succeeded' : simResult.ok ? 'Call would revert' : 'Could not simulate'}
                </p>
                {simResult.success ? (
                  <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">return: {String(simResult.result).slice(0, 130)}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">{simResult.reason || simResult.error}</p>
                )}
                {simResult.gas != null ? (
                  <p className="num mt-1 text-[11px]">Estimated gas: {simResult.gas.toString()}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">Add a “from” address to get a gas estimate.</p>
                )}
              </div>
            ) : null}
          </Card>
        </>
      ) : null}

      {/* ---------------- Approvals ---------------- */}
      {tab === 'approvals' ? (
        <>
          <Card className="!p-4">
            <p className="text-sm font-semibold">Token approval audit</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Reads live allowances from the chain. An unlimited approval lets a spender move that token whenever it likes,
              even years later. Revoking requires a signed transaction in your own wallet.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Chain</p>
                <select value={approvalChain} onChange={(e) => setApprovalChain(e.target.value)} className="input-dark !h-9 !text-xs">
                  {EVM_CHAINS.map((c) => <option key={c} value={c}>{EVM_RPC[c].name}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Your wallet address</p>
                <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="0x… (the owner)" className="input-dark !h-9 font-mono !text-xs" />
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {pairs.map((p, i) => (
                <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                  <input
                    value={p.token}
                    onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, token: e.target.value } : x)))}
                    placeholder="Token contract 0x…"
                    className="input-dark !h-9 font-mono !text-xs"
                  />
                  <input
                    value={p.spender}
                    onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, spender: e.target.value } : x)))}
                    placeholder="Spender 0x…"
                    className="input-dark !h-9 font-mono !text-xs"
                  />
                  <input
                    value={p.label}
                    onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    placeholder="Label (e.g. Uniswap Router)"
                    className="input-dark !h-9 !text-xs"
                  />
                  <button
                    onClick={() => setPairs(pairs.length > 1 ? pairs.filter((_, j) => j !== i) : pairs)}
                    className="btn-ghost !h-9 !px-3 !text-xs"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setPairs([...pairs, { token: '', spender: '', label: '' }])} className="btn-ghost !h-9 px-3 !text-xs">
                <Plus size={13} /> Add pair
              </button>
              <button onClick={runApprovals} disabled={approvalBusy} className="btn-primary !h-9 px-3 !text-xs">
                {approvalBusy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Check allowances
              </button>
            </div>
          </Card>

          {approvalResult ? (
            approvalResult.error ? (
              <Card className="!p-4"><p className="text-xs text-down">{approvalResult.error}</p></Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    ['Pairs checked', approvalResult.rows.length],
                    ['Unlimited', approvalResult.unlimitedCount],
                    ['Already revoked', approvalResult.revokedCount],
                    ['High risk', approvalResult.highRiskCount]
                  ].map(([label, value]) => (
                    <Card key={label} className="!p-4">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className={`num mt-1 text-lg font-bold ${label === 'High risk' && value > 0 ? 'text-down' : ''}`}>{value}</p>
                    </Card>
                  ))}
                </div>

                <Card className="!p-0">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-sm font-semibold">Allowances</p>
                    {approvalResult.readErrors ? (
                      <p className="mt-0.5 text-[11px] text-down">{approvalResult.readErrors} read(s) failed — shown as revoked is NOT safe; they are listed with their error.</p>
                    ) : null}
                  </div>
                  <div className="divide-y divide-border/60">
                    {approvalResult.rows.map((r, i) => (
                      <div key={`${r.token}-${r.spender}-${i}`} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold">
                            {r.symbol || r.token.slice(0, 10)} → {r.spenderLabel || `${r.spender.slice(0, 10)}…`}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            r.risk === 'critical' ? 'bg-down/20 text-down'
                              : r.risk === 'high' ? 'bg-down/15 text-down'
                                : r.risk === 'low' ? 'bg-primary/15 text-primary' : 'bg-up/15 text-up'
                          }`}>{r.risk}</span>
                        </div>
                        <p className="mt-1 num text-[11px] text-muted-foreground">
                          {r.readError ? `Error: ${r.readError}`
                            : r.revoked ? 'Allowance is 0 — revoked'
                              : r.unlimited ? 'UNLIMITED allowance' : `Allowance ${r.allowance}`}
                        </p>
                        {r.flags.map((f) => (
                          <p key={f.code} className="mt-1 text-[11px] text-muted-foreground">• {f.message}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">{approvalResult.note}</p>
                </Card>
              </>
            )
          ) : null}
        </>
      ) : null}

      {/* ---------------- Capabilities ---------------- */}
      {tab === 'caps' ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Supported', capSummary.supported, 'text-up'],
              ['Partial', capSummary.partial, 'text-primary'],
              ['Not offered', capSummary.none, 'text-down']
            ].map(([label, value, tone]) => (
              <Card key={label} className="!p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={`num mt-1 text-xl font-bold ${tone}`}>{value}</p>
              </Card>
            ))}
          </div>

          <Card className="!p-4">
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info size={14} className="mt-0.5 shrink-0 text-primary" />
              <span>
                Anything requiring a key or a signing transport is marked <b className="text-foreground">not offered</b> rather
                than stubbed. A fake swap or a fake send would be more dangerous than a missing one, because it would train you
                to trust a button that cannot protect your funds.
              </span>
            </p>
          </Card>

          {['Keys', 'Chains', 'Actions', 'Safety'].map((group) => (
            <Card key={group} className="!p-0">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">{group}</p>
              </div>
              <div className="divide-y divide-border/60">
                {CAPABILITIES.filter((c) => c.group === group).map((c) => {
                  const meta = STATUS_META[c.status];
                  const Icon = meta.Icon;
                  return (
                    <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={`mt-0.5 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.cls}`}>
                        <Icon size={10} /> {meta.label}
                      </span>
                      <div>
                        <p className="text-xs font-semibold">{c.label}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{c.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </>
      ) : null}
    </div>
  );
}
