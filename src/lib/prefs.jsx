import React, { useEffect, useState } from 'react';
import { lsGet, lsSet, lsRemove, onStore, emitStore } from './storage.js';

/* localStorage-backed reactive state (same-tab aware) */

export function useLsState(key, fallback) {
  const [val, setVal] = useState(() => lsGet(key, fallback));
  useEffect(() => onStore(key, () => setVal(lsGet(key, fallback))), [key]);
  const set = (next) => {
    const value = typeof next === 'function' ? next(lsGet(key, fallback)) : next;
    setStore(key, value);
    setVal(value);
  };
  return [val, set];
}

export function setStore(key, value) {
  lsSet(key, value);
  emitStore(key);
}

/* ---------- Watchlist ---------- */
const WATCH_KEY = 'cx_watch';
export function useWatchlist() {
  const [ids, setIds] = useLsState(WATCH_KEY, []);
  const toggle = (id) =>
    setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  return [ids, toggle];
}

/* ---------- Portfolio holdings ---------- */
const PORT_KEY = 'cx_portfolio';
export function useHoldings() {
  const [holds, setHolds] = useLsState(PORT_KEY, []);
  const add = (h) => setHolds((cur) => [...cur, { id: cryptoId(), ...h }]);
  const remove = (id) => setHolds((cur) => cur.filter((x) => x.id !== id));
  return [holds, add, remove];
}

/* ---------- Portfolio transactions (source of truth for lots & cost basis) ---------- */
const TX_KEY = 'cx_tx';
export function useTransactions() {
  const [txs, setTxs] = useLsState(TX_KEY, []);
  const add = (t) => setTxs((cur) => [...cur, { id: cryptoId(), at: Date.now(), ...t }]);
  const remove = (id) => setTxs((cur) => cur.filter((x) => x.id !== id));
  const clear = () => setTxs([]);
  const importMany = (rows) => setTxs((cur) => [...cur, ...rows.map((r) => ({ id: cryptoId(), ...r }))]);
  return [txs, { add, remove, clear, importMany }];
}

/* A coin bought on two different venues becomes two lots, so each holding row
 * records the venue it was acquired on. */
export function holdingToTransaction(h) {
  return {
    coinId: h.coinId,
    symbol: h.symbol || null,
    side: 'buy',
    amount: Number(h.amount),
    price: Number(h.buyPrice),
    fee: 0,
    at: h.at || Date.now(),
    venue: h.venue || null,
    note: 'Imported from the previous holdings format'
  };
}

/**
 * One-time migration of the legacy { coinId, amount, buyPrice } holdings list
 * into buy transactions, so existing users keep their cost basis.
 * The legacy key is only cleared once the transactions are safely written.
 */
export function migrateLegacyHoldings() {
  const legacy = lsGet('cx_portfolio', []);
  if (!Array.isArray(legacy) || !legacy.length) return [];
  const rows = legacy
    .filter((h) => h && h.coinId && Number(h.amount) > 0 && Number(h.buyPrice) > 0)
    .map(holdingToTransaction);
  if (rows.length) lsRemove('cx_portfolio');
  return rows;
}

/* ---------- Portfolio equity snapshots (builds historical performance) ---------- */
const SNAP_KEY = 'cx_snapshots';
export function useSnapshots() {
  const [snaps, setSnaps] = useLsState(SNAP_KEY, []);
  /** Keep at most one point per hour so history stays compact over months. */
  const record = (point) =>
    setSnaps((cur) => {
      const last = cur[cur.length - 1];
      if (last && point.t - last.t < 3600000) return [...cur.slice(0, -1), point];
      return [...cur, point].slice(-3000);
    });
  const clear = () => setSnaps([]);
  return [snaps, { record, clear }];
}

/* ---------- Known-good addresses, used for lookalike (poisoning) detection ---------- */
const ADDRBOOK_KEY = 'cx_addrbook';
export function useAddressBook() {
  const [book, setBook] = useLsState(ADDRBOOK_KEY, []);
  const add = (entry) => setBook((cur) => (
    cur.some((x) => x.address.toLowerCase() === entry.address.toLowerCase())
      ? cur
      : [...cur, { id: cryptoId(), at: Date.now(), ...entry }]
  ));
  const remove = (id) => setBook((cur) => cur.filter((x) => x.id !== id));
  const clear = () => setBook([]);
  return [book, { add, remove, clear }];
}

/* ---------- Watched public blockchain addresses (read-only) ---------- */
const WALLET_KEY = 'cx_wallets';
export function useWallets() {
  const [wallets, setWallets] = useLsState(WALLET_KEY, []);
  const add = (w) => setWallets((cur) => [...cur, { id: cryptoId(), at: Date.now(), ...w }]);
  const remove = (id) => setWallets((cur) => cur.filter((x) => x.id !== id));
  return [wallets, { add, remove }];
}

/* ---------- Alert rules + firing history ---------- */
const ALERT_KEY = 'cx_alerts';
const ALERT_STATE_KEY = 'cx_alert_state';

export function useAlerts() {
  const [alerts, setAlerts] = useLsState(ALERT_KEY, []);
  const [state, setState] = useLsState(ALERT_STATE_KEY, { lastFired: {}, log: [] });

  const add = (a) => setAlerts((cur) => [...cur, { id: cryptoId(), enabled: true, at: Date.now(), ...a }]);
  const remove = (id) => setAlerts((cur) => cur.filter((x) => x.id !== id));
  const patch = (id, p) => setAlerts((cur) => cur.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const clearAll = () => setAlerts([]);

  const recordFired = (hits) =>
    setState((cur) => ({ ...cur, log: [...hits, ...(cur.log || [])].slice(0, 200) }));
  const commitLastFired = (map) => setState((cur) => ({ ...cur, lastFired: map }));
  const clearLog = () => setState((cur) => ({ ...cur, log: [] }));
  const resetCooldowns = () => setState((cur) => ({ ...cur, lastFired: {} }));

  return [alerts, { add, remove, patch, clearAll }, state, { recordFired, commitLastFired, clearLog, resetCooldowns }];
}

/* ---------- Armed strategies ---------- */
const ARMS_KEY = 'cx_arms';
export function useArms() {
  const [arms, setArms] = useLsState(ARMS_KEY, []);
  const arm = (a) => {
    const key = `${a.presetId}|${a.coinId}|${a.interval}`;
    if (arms.some((x) => x.key === key)) return;
    setArms((cur) => [...cur, { key, name: a.name, at: Date.now(), state: 'neutral', ...a }]);
  };
  const disarm = (key) => setArms((cur) => cur.filter((x) => x.key !== key));
  const patchArm = (key, patch) => setArms((cur) => cur.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  return [arms, { arm, disarm, patchArm }];
}

/* ---------- Signal / trade log ---------- */
const LOG_KEY = 'cx_log';
export function useSignalLog() {
  const [log, setLog] = useLsState(LOG_KEY, []);
  const push = (entry) =>
    setLog((cur) => [{ t: Date.now(), ...entry }, ...cur].slice(0, 60));
  const clear = () => setLog([]);
  return [log, push, clear];
}

/* ---------- Paper trading simulation ---------- */
const SIM_KEY = 'cx_sim';
export const DEFAULT_SIM = {
  startedAt: Date.now(),
  cash: 10000,
  holdings: [], // {coinId, symbol, qty, entryPrice}
  trades: [], // {t, side, coinId, symbol, price, qty, usd, pnl}
  equity: [{ t: Date.now(), v: 10000 }],
  running: null // {armKey, presetId, name, coinId, symbol, interval}
};
export function useSim() {
  const [sim, setSim] = useLsState(SIM_KEY, DEFAULT_SIM);
  return [sim, setSim];
}

export function cryptoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- Paper trading bots (never touch a real exchange) ---------- */
const BOTS_KEY = 'cx_bots';
export function useBots() {
  const [bots, setBots] = useLsState(BOTS_KEY, []);
  const add = (b) => setBots((cur) => [...cur, { id: cryptoId(), running: false, log: [], state: {}, at: Date.now(), ...b }]);
  const remove = (id) => setBots((cur) => cur.filter((x) => x.id !== id));
  const patch = (id, p) => setBots((cur) => cur.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const appendLog = (id, entries) => setBots((cur) => cur.map((x) => (
    x.id === id ? { ...x, log: [...entries, ...x.log].slice(0, 200) } : x
  )));
  const clearLog = (id) => setBots((cur) => cur.map((x) => (x.id === id ? { ...x, log: [] } : x)));
  const clearAll = () => setBots([]);
  return [bots, { add, remove, patch, appendLog, clearLog, clearAll }];
}
