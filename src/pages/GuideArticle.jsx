import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { guideBySlug, GUIDES } from '../lib/guides.js';
import { setJsonLd } from '../lib/seo.js';

/* One guide.
 *
 * The article body comes from src/lib/guides.js, which the prerenderer also
 * reads — so the page a reader sees and the text a crawler gets are the same
 * source. FAQPage and Article JSON-LD are attached here because an answer
 * engine quoting a Q&A pair needs the structure, not just the prose.
 */

export default function GuideArticlePage() {
  const { slug } = useParams();
  const guide = guideBySlug(slug);

  useEffect(() => {
    if (!guide || typeof document === 'undefined') return;
    setJsonLd(document, 'guide-article', {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: guide.title,
      description: guide.description,
      articleSection: 'Research guides',
      isPartOf: { '@type': 'WebSite', name: 'CryptoX', url: 'https://cryptox-v2.site.accio.ai/' }
    });
    if (guide.faq?.length) {
      setJsonLd(document, 'guide-faq', {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: guide.faq.map(([q, a]) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a }
        }))
      });
    }
  }, [guide]);

  if (!guide) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold tracking-tight">Guide not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Available guides: {GUIDES.map((g) => g.slug).join(', ')}.
        </p>
        <Link to="/guides" className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft size={14} aria-hidden="true" /> All guides
        </Link>
      </div>
    );
  }

  return (
    <article className="max-w-3xl space-y-8">
      <header>
        <Link to="/guides" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} aria-hidden="true" /> All guides
        </Link>
        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{guide.title}</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">{guide.description}</p>
      </header>

      {guide.sections.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h2 className="text-xl font-bold tracking-tight">{section.heading}</h2>
          {section.paragraphs.map((p) => (
            <p key={p.slice(0, 40)} className="text-sm leading-relaxed text-muted-foreground">{p}</p>
          ))}
          {section.bullets?.length ? (
            <ul className="space-y-1.5 pl-1">
              {section.bullets.map((b) => (
                <li key={b.slice(0, 40)} className="flex gap-2 text-sm text-muted-foreground">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      {guide.faq?.length ? (
        <section className="space-y-3" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="text-xl font-bold tracking-tight">Common questions</h2>
          <dl className="space-y-4">
            {guide.faq.map(([q, a]) => (
              <div key={q}>
                <dt className="text-sm font-semibold">{q}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <footer className="border-t border-border pt-6 text-xs text-muted-foreground">
        <p>
          CryptoX is research and simulation software. No orders are placed, no exchange account is
          connected, and nothing here is investment advice.{' '}
          <Link to="/legal/risk" className="text-primary hover:underline">Risk disclosure</Link> ·{' '}
          <Link to="/guides" className="text-primary hover:underline">All guides</Link>
        </p>
      </footer>
    </article>
  );
}
