import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ShieldCheck, ScrollText, AlertTriangle, Lock } from 'lucide-react';
import { Card, EmptyState } from '../components/ui.jsx';

/* Substantive-but-plain-language legal pages for this demo build.
 * These are transparency documents, NOT legal advice: a qualified lawyer must
 * review them before any commercial launch (see docs/COMPLIANCE.md). */

const CONTACT = 'privacy@cryptox.example (placeholder — set a monitored address before launch)';

const DOCS = {
  privacy: {
    title: 'Privacy Notice',
    updated: '11 September 2026',
    icon: ShieldCheck,
    sections: [
      ['Summary', 'CryptoX is a client-side demo. There is no CryptoX server receiving your data: your account, settings, watchlist, portfolio and alerts are stored in your own browser using localStorage. No tracking cookies, no advertising SDKs and no third-party analytics are used.'],
      ['What is stored, and where', 'Account email and a PBKDF2-SHA256 hash of your password (never the password itself), session metadata, watchlist, portfolio entries, price alerts, armed strategies, paper-trading results, and your privacy-notice choice. All of it stays on this device. Clearing browser storage or using "Clear results" removes it.'],
      ['Third-party requests', 'To show live prices the browser contacts public endpoints operated by CoinGecko, Binance, and Alternative.me, and loads coin icons from the CoinGecko CDN. Those providers receive your IP address and standard request headers. CryptoX does not proxy or sell this data. Review their privacy policies before using the app in a regulated context.'],
      ['Legal bases and your rights (GDPR/UK-GDPR)', 'Where GDPR applies, processing of locally stored data rests on your consent and the legitimate interest in operating a demo. Because data never leaves your device, CryptoX cannot access, export, or erase it on your behalf — you exercise access, rectification, erasure, portability and objection directly in your browser settings. You may withdraw consent at any time by clearing storage or clicking "Essential only" on the notice.'],
      ['Retention', 'Local data persists until you delete it. Sessions expire automatically after 12 hours (and after 30 minutes of inactivity).'],
      ['Children', 'This app is not directed at children and must not be used by anyone below the age of digital consent in their jurisdiction.'],
      ['Changes and contact', `Material changes will be surfaced in-app. Privacy questions: ${CONTACT}.`]
    ]
  },
  terms: {
    title: 'Terms of Use',
    updated: '11 September 2026',
    icon: ScrollText,
    sections: [
      ['What this is', 'CryptoX is an educational demo of a cryptocurrency dashboard and strategy simulator. It is provided free of charge, "as is" and "as available", without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy, or uninterrupted availability.'],
      ['No financial advice, no execution', 'Nothing in the app is financial, investment, legal, or tax advice, and no recommendation is made to buy or sell any asset. CryptoX does not connect to an exchange, does not hold funds, and does not place orders. Every "strategy", "signal", "backtest" and "paper trade" is a simulation computed from public market data.'],
      ['Your responsibilities', 'You are responsible for how you use any information shown, for complying with the laws of your jurisdiction, and for the security of the device and browser profile where your demo data is stored. Do not use the app to break any law, to attempt to disrupt the underlying data providers, or to redistribute their market data commercially without a licence.'],
      ['Market data and third-party services', 'Market data is supplied by third parties under their own terms. It may be delayed, incomplete, or unavailable, and CryptoX makes no accuracy guarantee. Commercial use of market data typically requires a paid licence from the relevant provider.'],
      ['Limitation of liability', 'To the maximum extent permitted by law, the authors of CryptoX are not liable for any direct, indirect, incidental, consequential, or special damages, including lost profits or trading losses, arising from use of the app.'],
      ['Changes', 'These terms may change; the updated date above will reflect it.']
    ]
  },
  risk: {
    title: 'Risk Disclosure',
    updated: '11 September 2026',
    icon: AlertTriangle,
    sections: [
      ['Crypto assets are volatile', 'Prices can move violently within minutes. You can lose the entire value of your capital. Never trade money you cannot afford to lose, and never assume historical behaviour will repeat.'],
      ['Simulation is not reality', 'Backtests and paper trades are optimistic by nature. This engine models next-bar fills, fees and slippage, but it does NOT model funding costs, borrow costs, latency, partial fills, exchange outages, market impact, taxes, or regulatory restrictions. Real results will differ — usually for the worse.'],
      ['Signals are mechanical', 'One-click presets (including RSI buy-below-30 / sell-above-70) are textbook rules, not predictive intelligence. Mechanical rules produce long losing streaks and can fail entirely in trending or illiquid markets.'],
      ['Synthetic data guard', 'When live market data is unavailable the app may show synthetic candles for layout purposes. Such data is clearly labelled and is never used to generate signals or simulated trades.'],
      ['Not regulated', 'CryptoX is not a broker, exchange, investment adviser, or custodian, and is not authorised or supervised by any financial regulator.'] 
    ]
  },
  security: {
    title: 'Security Overview',
    updated: '11 September 2026',
    icon: Lock,
    sections: [
      ['Implemented in this build', 'Password hashing with PBKDF2-SHA256 (210,000 iterations, per-user salt, constant-time comparison); transparent migration of legacy plaintext accounts; brute-force lockout (5 attempts / 15 minutes); session absolute and idle expiry; verification codes are random, hashed, time-limited and attempt-limited; a Content-Security-Policy restricts script, style, image and connection origins; error boundaries prevent blank-screen failures; dependency auditing runs in CI.'],
      ['Known residual risks', 'This is a client-only build: a user with control of the device can read or modify localStorage, and identity cannot be trusted for anything of value. There is no server-side session, no WAF, no rate limiting at the network edge, no independent penetration test, and no SOC 2/ISO certification. Sessions are held in localStorage rather than httpOnly cookies.'],
      ['Do not reuse passwords', 'Because this is a demo, use a throwaway password. Never enter credentials you use elsewhere.'],
      ['Reporting a vulnerability', 'Please report security issues privately rather than publicly disclosing them. Include reproduction steps and impact. Contact channel is a placeholder until launch readiness: security@cryptox.example.'],
      ['Production roadmap', 'Server-side identity (Supabase/OIDC) with httpOnly sessions, API-key proxying, signed market-data licences, edge rate limiting, a third-party penetration test, dependency and container scanning, and monitored logging. See docs/OPERATIONS.md.']
    ]
  }
};

export default function LegalPage() {
  const { doc } = useParams();
  const entry = DOCS[doc];

  if (!entry) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <EmptyState
            icon={<ScrollText size={28} className="text-muted-foreground" />}
            title="Document not found"
            sub="Available documents: privacy, terms, risk, security."
            action={<Link to="/" className="btn-primary">Back to CryptoX</Link>}
          />
        </Card>
      </div>
    );
  }

  const Icon = entry.icon;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon size={14} className="text-primary" />
          <span>Last updated {entry.updated}</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{entry.title}</h1>
      </div>

      <Card className="space-y-5">
        {entry.sections.map(([heading, body]) => (
          <section key={heading}>
            <h2 className="text-sm font-semibold">{heading}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </section>
        ))}
        <p className="rounded-xl border border-border bg-background/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
          This document is a plain-language transparency notice for a demo build. It is not legal advice and must be reviewed
          by qualified counsel in your operating jurisdictions before any commercial launch.
        </p>
      </Card>

      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(DOCS).map(([key, d]) => (
          <Link key={key} to={`/legal/${key}`} className={`font-medium hover:underline ${key === doc ? 'text-primary' : 'text-muted-foreground'}`}>
            {d.title}
          </Link>
        ))}
        <Link to="/status" className="font-medium text-muted-foreground hover:underline">System status</Link>
      </div>
    </div>
  );
}
