import React from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { BrandLogo } from './BrandLogo.jsx';

/* Chrome for the pages that render without a session.
 *
 * These routes used to sit inside <RequireAuth><Shell/></RequireAuth>, so an
 * anonymous visitor (and every crawler) was bounced to /login. The layout is
 * deliberately small: a logo, four links and a CTA. It also gives the marketing
 * page a real internal-link graph, which matters more than any meta tag for
 * getting the pricing and provenance pages discovered.
 */

const LINKS = [
  { to: '/', label: 'Overview' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/guides', label: 'Guides' },
  { to: '/data-sources', label: 'Data sources' },
  { to: '/status', label: 'Status' }
];

export default function PublicLayout({ children }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <BrandLogo size="md" to="/" />
          <nav aria-label="Public" className="flex flex-wrap items-center gap-1">
            {LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm transition-colors ${isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`
                }
              >
                {label}
              </NavLink>
            ))}
            <Link to="/login" className="btn-sm-dark ml-1">Log in</Link>
            <Link to="/register" className="btn-primary h-9 px-3 text-xs">Start free</Link>
          </nav>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {children ?? <Outlet />}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <Link to="/legal/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/legal/terms" className="hover:text-foreground">Terms</Link>
          <Link to="/legal/risk" className="hover:text-foreground">Risk</Link>
          <Link to="/legal/security" className="hover:text-foreground">Security</Link>
          <Link to="/compliance" className="hover:text-foreground">Compliance</Link>
          <span className="ml-auto text-xs">Educational demo. No orders are placed.</span>
        </div>
      </footer>
    </div>
  );
}
