import React, { useState } from 'react';
import { Image as ImageIcon, Loader2, Search, Info, AlertTriangle } from 'lucide-react';
import { EVM_RPC } from '../lib/wallets.js';
import { readNftBalance } from '../lib/nft.js';
import { Card } from './ui.jsx';
import { cls } from '../lib/format.js';

const CHAINS = Object.keys(EVM_RPC);

function Row({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cls('num text-xs font-semibold', tone)}>{value}</span>
    </div>
  );
}

/**
 * ERC-721 / ERC-1155 holding check for a single collection.
 *
 * Deliberately NOT a gallery: enumerating a wallet's NFTs needs an indexer that
 * has walked every Transfer log since genesis, which public RPC cannot do. This
 * resolves the standard via ERC-165 and reads one owner's balance.
 */
export default function NftChecker() {
  const [chain, setChain] = useState(CHAINS[0]);
  const [contract, setContract] = useState('');
  const [owner, setOwner] = useState('');
  const [tokenId, setTokenId] = useState('0');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      const r = await readNftBalance(chain, contract.trim(), owner.trim(), { tokenId: Number(tokenId) || 0 });
      setRes(r);
    } catch (e) {
      setRes({ error: e?.message || 'Lookup failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="!p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <ImageIcon size={15} className="text-primary" /> NFT holdings (ERC-721 / ERC-1155)
      </h2>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Resolves the token standard through ERC-165 first, then reads the balance with the matching{' '}
        <span className="num">balanceOf</span> arity. A per-collection check — not a wallet gallery.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div>
          <p className="mb-0.5 text-[10px] text-muted-foreground">Chain</p>
          <select value={chain} onChange={(e) => setChain(e.target.value)} className="input-dark !h-8 !text-[11px]">
            {CHAINS.map((c) => <option key={c} value={c}>{EVM_RPC[c].name}</option>)}
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
        <div>
          <p className="mb-0.5 text-[10px] text-muted-foreground">Token id (ERC-1155)</p>
          <input value={tokenId} onChange={(e) => setTokenId(e.target.value)} className="input-dark !h-8 num !text-[11px]" />
        </div>
      </div>

      <button onClick={run} disabled={busy || !contract || !owner} className="btn-primary mt-3 !h-8 px-3 !text-[11px] disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Check holdings
      </button>

      {res ? (
        <div className="mt-3 rounded-lg border border-border bg-muted/25 p-3">
          {res.error ? (
            <p className="flex items-start gap-2 text-[11px] text-down">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                {res.error}
                {res.standard === 'not-nft' ? ' — some older collections predate ERC-165, so this is not proof it is not an NFT.' : ''}
              </span>
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                <div>
                  <Row label="Standard" value={res.standard} />
                  <Row
                    label={res.standard === 'ERC-1155' ? `Balance (id ${res.tokenId})` : 'Tokens owned'}
                    value={String(res.balance)}
                    tone={res.balance > 0n ? 'text-up' : undefined}
                  />
                </div>
                <div>
                  <Row label="Contract" value={`${contract.slice(0, 8)}…${contract.slice(-6)}`} />
                  <Row label="Owner" value={`${owner.slice(0, 8)}…${owner.slice(-6)}`} />
                </div>
              </div>
              {res.note ? (
                <p className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground">
                  <Info size={11} className="mt-0.5 shrink-0 text-primary" /> {res.note}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
