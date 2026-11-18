import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { AUTH_MODE } from '../lib/auth.jsx';
import { BrandLogo } from './BrandLogo.jsx';

/* Public chrome.
 *
 * Everything inside `RequireAuth` is invisible to a prospect, a crawler and an
 * anonymous uptime check. This frame is the alternative: the same brand, the
 * same footer links, no session required. It is deliberately not `Shell` — the
 * app shell is a fixed-height, sidebar-driven console, which is the wrong shape
 * for a marketing page and would hide the content behind a login redirect.
 */

const PUBLIC_LINKS = [
  { to: '/pricing', label: 'Pricing' },
  { to: '/status', label: 'Status' },
  { to: '/legal/security', label: 'Security' }
];

export default function PublicFrame({ children }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#public-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <BrandLogo size="md" to="/" />

          <nav aria-label="Public" className="ml-6 hidden items-center gap-5 md:flex">
            {PUBLIC_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <Link to="/login" className="btn-ghost">Log in</Link>
            <Link to="/register" className="btn-primary">Create free account</Link>
          </div>

          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded-lg p-2 text-muted-foreground hover:bg-accent sm:hidden"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {open ? (
          <div className="border-t border-border bg-card/60 px-4 py-3 sm:hidden">
            <nav aria-label="Public mobile" className="flex flex-col gap-1">
              {PUBLIC_LINKS.map((l) => (
                <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="rounded-lg px-2 py-2 text-sm hover:bg-accent">
                  {l.label}
                </Link>
              ))}
              <Link to="/login" onClick={() => setOpen(false)} className="rounded-lg px-2 py-2 text-sm hover:bg-accent">Log in</Link>
              <Link to="/register" onClick={() => setOpen(false)} className="mt-1 rounded-lg bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground">
                Create free account
              </Link>
            </nav>
          </div>
        ) : null}
      </header>

      <main id="public-main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>

      <footer className="border-t border-border bg-card/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <Link to="/pricing" className="hover:text-foreground hover:underline">Pricing</Link>
            <Link to="/status" className="hover:text-foreground hover:underline">System status</Link>
            <Link to="/legal/privacy" className="hover:text-foreground hover:underline">Privacy</Link>
            <Link to="/legal/terms" className="hover:text-foreground hover:underline">Terms</Link>
            <Link to="/legal/risk" className="hover:text-foreground hover:underline">Risk disclosure</Link>
            <Link to="/legal/security" className="hover:text-foreground hover:underline">Security</Link>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            © {new Date().getFullYear()} CryptoX. Market data shown for information only — not investment advice.
            {AUTH_MODE === 'demo'
              ? ' This deployment runs in demo mode: accounts and data stay in your browser and no real trading takes place.'
              : ''}
          </p>
        </div>
      </footer>
    </div>
  );
}
