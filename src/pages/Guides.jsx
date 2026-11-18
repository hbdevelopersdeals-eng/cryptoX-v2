import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ArrowRight } from 'lucide-react';
import { GUIDES, GUIDE_GLOSSARY } from '../lib/guides.js';

/* The guides hub.
 *
 * Public on purpose: these are the pages that answer a question instead of
 * describing a product, which is what an answer engine can cite. It also gives
 * the marketing pages real internal links to something other than pricing.
 */

export default function GuidesPage() {
  return (
    <div className="space-y-12">
      <header className="max-w-3xl">
        <span className="chip">Research guides</span>
        <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          The method behind the numbers
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Four short guides on the parts of crypto research that are easy to get subtly wrong: what a
          backtest proves, why the fill price decides whether a result is real, and how cost basis is
          actually calculated. No predictions, no signals — just the mechanics, written to match what
          the product does.
        </p>
      </header>

      <section aria-labelledby="guides-heading" className="space-y-4">
        <h2 id="guides-heading" className="text-2xl font-bold tracking-tight">Guides</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {GUIDES.map((guide) => (
            <article key={guide.slug} className="card-panel flex flex-col">
              <BookOpen size={18} className="text-primary" aria-hidden="true" />
              <h3 className="mt-3 text-base font-semibold">{guide.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{guide.description}</p>
              <Link to={`/guides/${guide.slug}`} className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Read the guide <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="glossary-heading">
        <h2 id="glossary-heading" className="text-2xl font-bold tracking-tight">Glossary</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The terms used across these guides, in one place. Every definition describes what CryptoX
          computes, not a general theory of trading.
        </p>
        <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {GUIDE_GLOSSARY.map(([term, meaning]) => (
            <div key={term}>
              <dt className="text-sm font-semibold">{term}</dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card-panel">
        <h2 className="text-lg font-bold tracking-tight">Where these apply in the product</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The backtester, the paper trader and the portfolio all implement the rules described here.
          You can check them without an account on the{' '}
          <Link to="/" className="text-primary hover:underline">overview page</Link>, or read{' '}
          <Link to="/data-sources" className="text-primary hover:underline">where the data comes from</Link>.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          CryptoX is research and simulation software. No orders are placed and nothing here is
          investment advice.
        </p>
      </section>
    </div>
  );
}
