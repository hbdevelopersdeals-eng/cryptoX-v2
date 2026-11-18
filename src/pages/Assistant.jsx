import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, Send, Info, AlertTriangle, ShieldCheck, Check, X, Bot, ListChecks
} from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useTransactions, useAlerts } from '../lib/prefs.jsx';
import { buildPortfolio } from '../lib/portfolio.js';
import { answer, capabilityMap, INTENTS } from '../lib/analyst.js';
import { askModel } from '../lib/assistantClient.js';
import { Card } from '../components/ui.jsx';
import { cls } from '../lib/format.js';

/* The context a model is allowed to see: a small, numeric market snapshot.
 *
 * Nothing user-identifying goes here — not the email, not the portfolio value,
 * not the ledger. A model answer about "how is the market doing" does not need
 * to know what the reader owns, and anything sent is sent to a third party. */
export function buildModelContext({ rows = [], global = null, feed = null } = {}) {
  return {
    marketCapUsd: Number.isFinite(global?.mcap) ? global.mcap : undefined,
    btcDominance: Number.isFinite(global?.btcDom) ? global.btcDom : undefined,
    volume24hUsd: Number.isFinite(global?.vol) ? global.vol : undefined,
    feed: feed?.simulated ? 'simulated (fallback data — say so in the answer)' : feed?.marketSource || undefined,
    coins: (rows || [])
      .filter((r) => r && r.symbol && Number.isFinite(r.price))
      .slice(0, 8)
      .map((r) => ({ symbol: r.symbol, price: r.price, pct24: Number.isFinite(r.pct24) ? r.pct24 : undefined }))
  };
}

const STATUS = {
  supported: 'bg-up/15 text-up',
  'no-source': 'bg-down/15 text-down',
  action: 'bg-primary/15 text-primary'
};

const SUGGESTIONS = [
  'How is the market doing?',
  'What is bitcoin?',
  'RSI for ETH',
  'How is my portfolio doing?',
  'What is my risk?',
  'Alert me when BTC is above 120k',
  'Show me whale wallets'
];

export default function AssistantPage() {
  const { rows, global, feed } = useMarket();
  const [txs] = useTransactions();
  const [alerts, , , alertApi] = useAlerts();
  const [q, setQ] = useState('');
  const [log, setLog] = useState([]);
  const [confirmed, setConfirmed] = useState({});

  const portfolio = useMemo(() => {
    if (!txs?.length) return null;
    const priceById = {};
    (rows || []).forEach((r) => { priceById[r.id] = r.price; });
    try { return buildPortfolio({ transactions: txs, priceById }); } catch { return null; }
  }, [txs, rows]);

  const caps = useMemo(() => capabilityMap(), []);

  /**
   * Ask the server-side model first; fall back to the deterministic router.
   *
   * WHICH ONE ANSWERED IS SHOWN. The two are different products — one costs
   * money and can be wrong in fluent ways, the other is a lookup that cannot
   * invent a number — so the answer card carries the source. A silent fallback
   * would let a template masquerade as a model, which is the failure this
   * product keeps refusing to make everywhere else.
   */
  const ask = async (query) => {
    const text = String(query ?? q).trim();
    if (!text) return;

    const id = Date.now();
    const local = answer(text, { rows, global, portfolio });
    setLog((cur) => [{ id, query: text, pending: true, blocks: [], disclaimer: '' }, ...cur].slice(0, 12));
    setQ('');

    const remote = await askModel({ message: text, context: buildModelContext({ rows, global, feed }) });

    setLog((cur) => {
      const rest = cur.filter((entry) => entry.id !== id);
      if (remote.ok) {
        const entry = {
          id,
          query: text,
          intent: 'model',
          confidence: 1,
          blocks: [
            {
              title: 'Answer',
              lines: remote.text.split('\n').filter(Boolean),
              evidence: `${remote.provider} · ${remote.model}`
            }
          ],
          disclaimer:
            'Written by a language model from the market snapshot shown. It can be wrong; it has no access to your portfolio and gives no advice.'
        };
        return [entry, ...rest].slice(0, 12);
      }

      // Deterministic answer, labelled with why the model was not used.
      const note =
        remote.reason === 'not-configured'
          ? 'No model key is configured on this deployment, so the built-in analyst answered.'
          : remote.reason === 'not-signed-in'
            ? 'You are not signed in, so the built-in analyst answered.'
            : 'The model was unavailable, so the built-in analyst answered.';
      return [{ id, ...local, fallbackNote: note }, ...rest].slice(0, 12);
    });
  };

  /**
   * Action execution is deliberately gated: the assistant only ever PROPOSES,
   * and the user must press Confirm. Nothing runs on its own.
   */
  const confirmProposal = (entry) => {
    const p = entry.proposal;
    if (!p || p.kind !== 'alert' || !p.payload?.symbol || !p.payload?.threshold) {
      setConfirmed((c) => ({ ...c, [entry.id]: 'unsupported' }));
      return;
    }
    alertApi.add({
      coinId: null,
      symbol: p.payload.symbol,
      name: p.payload.symbol,
      cooldownMs: 300000,
      rule: { type: p.payload.direction === 'below' ? 'price_below' : 'price_above', symbol: p.payload.symbol, value: Number(p.payload.threshold) }
    });
    setConfirmed((c) => ({ ...c, [entry.id]: 'done' }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">CryptoX AI</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Answers come from one of two places, and each card says which. The deterministic analyst computes from this
          app&apos;s own data — market rows, your ledger, the indicator engines and on-chain reads — so it is reproducible
          and cannot invent a number. Where the deployment has a model key, a language model may answer instead, using
          only the small market snapshot shown to it; that answer is labelled with the provider and can be wrong.
        </p>
      </div>

      <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
        <p className="flex items-start gap-2 text-[11px]">
          <Info size={13} className="mt-0.5 shrink-0 text-primary" />
          <span>
            <b className="text-foreground">Deterministic unless labelled otherwise.</b>{' '}
            <span className="text-muted-foreground">
              Your query is matched to one of {INTENTS.length} known tasks and answered by a function. If nothing matches,
              it says so rather than improvising — and it never invents a number. When a model key is configured on the
              server, a model answer may replace it; that card names the provider and says it can be wrong.
            </span>
          </span>
        </p>
      </div>

      {/* ---------------- ask ---------------- */}
      <Card className="!p-4">
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
            aria-label="Ask the assistant about the market, a coin, your portfolio or an address"
            placeholder="Ask about the market, a coin, your portfolio, or an address…"
            className="input-dark !h-10 min-w-[240px] flex-1 !text-xs"
          />
          <button onClick={() => ask()} className="btn-primary !h-10 px-4 !text-xs">
            <Send size={13} /> Ask
          </button>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} className="rounded-lg border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent">
              {s}
            </button>
          ))}
        </div>
      </Card>

      {/* ---------------- answers ---------------- */}
      {log.map((entry) => (
        <Card key={entry.id} className="!p-4">
          <p className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Sparkles size={12} className="text-primary" />
            <span className="font-semibold text-foreground">{entry.query}</span>
            {entry.intent ? <span className="num">· {entry.intent}</span> : null}
            {Number.isFinite(entry.confidence) ? (
              <span className="num">· confidence {(entry.confidence * 100).toFixed(0)}%</span>
            ) : null}
          </p>

          {entry.pending ? (
            <p role="status" className="text-[11px] text-muted-foreground">
              Asking…
            </p>
          ) : null}

          {entry.blocks.map((b, i) => (
            <div key={i} className="mb-2 rounded-lg border border-border p-3">
              <p className="text-xs font-semibold">{b.title}</p>
              <ul className="mt-1 space-y-0.5">
                {b.lines.map((l, j) => (
                  <li key={j} className="text-[11px] text-muted-foreground">{l}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-muted-foreground/80">Source: {b.evidence}</p>
            </div>
          ))}

          {/* -------- action proposal with an explicit gate -------- */}
          {entry.proposal ? (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                <ShieldCheck size={13} /> Proposed action — needs your confirmation
              </p>
              <p className="mt-1 text-[11px]">{entry.proposal.summary}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{entry.proposal.safety}</p>

              {confirmed[entry.id] === 'done' ? (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-up">
                  <Check size={12} /> Created. Manage it on the <Link to="/alerts" className="underline">Alerts</Link> page.
                </p>
              ) : confirmed[entry.id] === 'unsupported' ? (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-down">
                  <AlertTriangle size={12} /> This proposal cannot be executed here — it needs a target price. Go to the{' '}
                  <Link to="/alerts" className="underline">Alerts</Link> page to set it up.
                </p>
              ) : (
                <div className="mt-2 flex gap-1.5">
                  <button onClick={() => confirmProposal(entry)} className="btn-primary !h-7 !px-2.5 !text-[10px]">
                    <Check size={11} /> Confirm
                  </button>
                  <button
                    onClick={() => setConfirmed((c) => ({ ...c, [entry.id]: 'cancelled' }))}
                    className="btn-ghost !h-7 !px-2.5 !text-[10px]"
                  >
                    <X size={11} /> {confirmed[entry.id] === 'cancelled' ? 'Cancelled' : 'Cancel'}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {entry.fallbackNote ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-border px-2 py-1.5 text-[10px] text-muted-foreground">
              <Info size={11} className="mt-0.5 shrink-0" /> {entry.fallbackNote}
            </p>
          ) : null}

          {entry.disclaimer ? (
            <p className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground">
              <Info size={11} className="mt-0.5 shrink-0 text-primary" /> {entry.disclaimer}
            </p>
          ) : null}
        </Card>
      ))}

      {!log.length ? (
        <Card className="!p-8">
          <p className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
            <Bot size={26} className="text-muted-foreground" />
            Ask something above, or pick a suggestion.
          </p>
        </Card>
      ) : null}

      {/* ---------------- capability map ---------------- */}
      <Card className="!p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks size={15} className="text-primary" /> What it can and cannot answer
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Published up front so a refusal reads as a known boundary, not a bug.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
          {caps.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5">
              <span className="text-[11px]">{c.label}</span>
              <span className={cls('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold', STATUS[c.status])}>{c.status}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
