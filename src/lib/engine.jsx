import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useMarket } from './market.jsx';
import { useArms, useSignalLog } from './prefs.jsx';
import { evaluateStrategy, presetById, intervalLabel } from './strategies.js';

/* Always-on strategy engine: every ~4s it re-evaluates every armed strategy
   against live-updated candles and writes SIGNAL entries to the global log
   when a BUY/SELL edge fires. */

const EngineContext = createContext(null);
export const useEngine = () => useContext(EngineContext);

export function StrategyEngineProvider({ children }) {
  const { byId, getKlines } = useMarket();
  const [arms, armsApi] = useArms();
  const [, pushLog] = useSignalLog();

  const armsRef = useRef(arms);
  const byIdRef = useRef(byId);
  const getKlinesRef = useRef(getKlines);
  const pushLogRef = useRef(pushLog);
  const prevRef = useRef({}); // armKey -> last emitted signal
  const lastEvalRef = useRef(0);

  armsRef.current = arms;
  byIdRef.current = byId;
  getKlinesRef.current = getKlines;
  pushLogRef.current = pushLog;

  useEffect(() => {
    const evaluateAll = async () => {
      const list = armsRef.current;
      if (!list.length) return;
      for (const arm of list) {
        try {
          const row = byIdRef.current[arm.coinId];
          if (!row) continue;
          const klRes = await getKlinesRef.current(row.symbol, arm.interval, 220);
          const klData = klRes?.candles;
          if (!klData || klData.length < 30) continue;

          // Integrity guard: synthetic candles are NEVER used to emit signals.
          if (klRes.source === 'simulated') {
            if (arm.dataWarning !== 'simulated') {
              armsApi.patchArm(arm.key, {
                dataWarning: 'simulated',
                state: 'neutral',
                reason: 'Live market data unavailable — synthetic candles are not used for signals'
              });
            }
            prevRef.current[arm.key] = null;
            continue;
          }

          let kl = klData;
          const price = row.price;
          if (price && Math.abs(price - kl[kl.length - 1].c) / kl[kl.length - 1].c < 0.05) {
            kl = [...kl];
            kl[kl.length - 1] = { ...kl[kl.length - 1], c: price };
          }
          const res = evaluateStrategy(arm.presetId, { open: kl.map((x) => x.o), high: kl.map((x) => x.h), low: kl.map((x) => x.l), close: kl.map((x) => x.c), volume: kl.map((x) => x.v) }, arm.params, { price });
          const prev = prevRef.current[arm.key];
          if (res.signal && res.signal !== prev) {
            prevRef.current[arm.key] = res.signal;
            pushLogRef.current({
              kind: 'signal',
              side: res.signal,
              armKey: arm.key,
              presetId: arm.presetId,
              presetName: arm.name,
              coinId: arm.coinId,
              symbol: row.symbol,
              coinName: row.name,
              image: row.image,
              reason: res.reason,
              price,
              interval: arm.interval,
              intervalLabel: intervalLabel(arm.interval)
            });
          } else if (!res.signal && prev) {
            prevRef.current[arm.key] = null;
          }
          // persist live state so the hub can render status chips
          const changed =
            arm.state !== res.state ||
            arm.reason !== res.reason ||
            arm.lastPrice !== res.price ||
            arm.dataWarning === 'simulated';
          if (changed) {
            armsApi.patchArm(arm.key, {
              state: res.state,
              reason: res.reason,
              lastPrice: res.price,
              lastAt: Date.now(),
              dataWarning: null
            });
          }
        } catch { /* single arm failure is non-fatal */ }
      }
      lastEvalRef.current = Date.now();
    };

    const iv = setInterval(evaluateAll, 4000);
    const t0 = setTimeout(evaluateAll, 600);
    return () => { clearInterval(iv); clearTimeout(t0); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <EngineContext.Provider value={{ evaluatedAt: lastEvalRef.current, presetById }}>
      {children}
    </EngineContext.Provider>
  );
}
