import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, X } from 'lucide-react';
import { lsGet, lsSet } from '../lib/storage.js';

const KEY = 'cx_consent_v1';

/* Honest consent notice: this build sets no tracking cookies and loads no
 * third-party analytics. It stores app data (settings, demo account, watchlist)
 * in localStorage only. Raised because GDPR/UK-GDPR still require transparency
 * even for strictly-essential local storage. */
export default function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!lsGet(KEY, null));
  }, []);

  if (!visible) return null;

  const decide = (choice) => {
    lsSet(KEY, { choice, at: Date.now() });
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Privacy notice"
      className="fixed bottom-3 left-3 right-3 z-[70] mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur sm:left-6 sm:right-6"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <ShieldCheck size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Your privacy on CryptoX</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            This demo stores your account (password hashed, never plaintext), settings and watchlist in your own browser
            (localStorage). It sets <b className="text-foreground">no tracking cookies</b> and loads no third-party analytics.
            Market data is requested directly from public Binance/CoinGecko endpoints, which means those providers see your IP.
            Read the <Link to="/legal/privacy" className="font-medium text-primary hover:underline">privacy notice</Link>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => decide('accepted')} className="btn-primary !h-9 px-3 !text-xs">Got it</button>
            <button onClick={() => decide('essential-only')} className="btn-sm-dark !h-9">Essential only</button>
          </div>
        </div>
        <button onClick={() => decide('dismissed')} aria-label="Dismiss privacy notice" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
