import { useEffect, useState } from 'react';
import { supabase, supabaseConfigured, TABLES } from './supabase.js';
import { reportError } from './telemetry.js';

/* Streaming wallet / portfolio events: subscribes to row changes on the user's
 * own tables through Supabase Realtime. RLS still applies, so a user only ever
 * receives events for rows they own.
 *
 * If Realtime is not enabled for these tables the subscription reports an error
 * instead of pretending to work — the fix is a one-line SQL change:
 *   alter publication supabase_realtime add table public.cx_holdings, ...;
 */

export const WATCHED_TABLES = [
  TABLES.holdings,
  TABLES.alerts,
  TABLES.arms,
  TABLES.paperRuns,
  TABLES.watchlist
];

export function useWalletEvents({ enabled = true, tables = WATCHED_TABLES, onChange } = {}) {
  const [state, setState] = useState({
    status: supabaseConfigured ? 'connecting' : 'unconfigured',
    received: 0,
    errors: 0,
    lastEvent: null,
    channels: 0,
    hint: null
  });

  useEffect(() => {
    if (!enabled || !supabaseConfigured || !supabase) return undefined;
    let alive = true;
    const channels = tables.map((table) => {
      const channel = supabase
        .channel(`cx-events-${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          if (!alive) return;
          const event = {
            table,
            eventType: payload.eventType,
            at: Date.now(),
            recordId: payload.new?.id || payload.old?.id || null
          };
          setState((s) => ({ ...s, received: s.received + 1, lastEvent: event }));
          try {
            onChange?.(event, payload);
          } catch (err) {
            reportError(err, { kind: 'walletEvents.handler', table });
          }
        })
        .subscribe((status) => {
          if (!alive) return;
          setState((s) => {
            if (status === 'SUBSCRIBED') return { ...s, status: 'live', channels: s.channels + 1 };
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              return {
                ...s,
                status: 'error',
                errors: s.errors + 1,
                hint: 'Realtime is not enabled for these tables yet (add them to the supabase_realtime publication).'
              };
            }
            return s;
          });
        });
      return channel;
    });

    return () => {
      alive = false;
      channels.forEach((c) => {
        try { supabase.removeChannel(c); } catch { /* noop */ }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tables.join('|')]);

  return state;
}
