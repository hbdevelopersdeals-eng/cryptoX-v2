import { createClient } from '@supabase/supabase-js';

/* Supabase browser client.
 * Only ever uses the PUBLIC publishable/anon key — never the service-role key.
 * If the environment is not configured the app falls back to its local demo
 * mode instead of crashing, so previews and CI keep working. */

const URL = (import.meta.env && import.meta.env.VITE_SUPABASE_URL) || '';
const KEY =
  (import.meta.env && (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)) || '';

// Tests always use the local demo path: no network, no provider calls.
const isTest = (import.meta.env && import.meta.env.MODE) === 'test';

export const supabaseConfigured = Boolean(URL && KEY) && !isTest;

export const supabase = supabaseConfigured
  ? createClient(URL, KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'cx_sb_session'
      }
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured in this build (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing)');
  }
  return supabase;
}

/* Table names, kept in one place so browser code never drifts from the schema. */
export const TABLES = {
  settings: 'cx_settings',
  watchlist: 'cx_watchlist_items',
  holdings: 'cx_holdings',
  alerts: 'cx_alerts',
  arms: 'cx_strategy_arms',
  signals: 'cx_signal_events',
  paperRuns: 'cx_paper_runs'
};
