/* Localized SEO: titles, descriptions, canonical URLs and hreflang alternates.
 *
 * HONEST LIMITATION — read before trusting this file.
 * CryptoX is a static single-page app served from a CDN and routed with a hash
 * (/#/markets). Search engines cannot crawl a distinct URL per language here:
 * the hash fragment is never sent to the server, so every language resolves to
 * one document. The functions below therefore produce CORRECT markup for a
 * crawler-aware build, and are applied to the live document so the tags are
 * present and valid — but true per-language indexing needs either
 * history-API routing with a server rewrite, or pre-rendering per locale.
 * `SEO_LIMITATION` states this in the UI rather than implying multilingual SEO
 * is solved.
 */

export const SITE_URL = 'https://cryptox-v2.site.accio.ai';

export const SEO_LIMITATION =
  'Per-language URLs need server-side routing or pre-rendering; a hash-routed static build exposes one crawlable URL.';

/**
 * Prefix a route with a locale segment.
 * localePath('ur', '/markets') -> '/ur/markets'
 */
export function localePath(lang, path = '/') {
  const clean = '/' + String(path).replace(/^#?\/?/, '');
  return `/${lang}${clean === '/' ? '' : clean}` || `/${lang}`;
}

/** Strip a leading locale segment so routes can be matched language-agnostically. */
export function stripLocale(path = '/') {
  return '/' + String(path).replace(/^\/+/, '').replace(/^[a-z]{2}(-[A-Za-z]{4})?\//, '');
}

/** The full URL for a locale + route, for canonical and alternate tags. */
export const localeHref = (baseUrl, lang, path) =>
  `${String(baseUrl).replace(/\/+$/, '')}/#${localePath(lang, path)}`;

/**
 * hreflang alternates for a route, plus an x-default pointing at the source
 * language. `languages` is an array of language codes.
 */
export function hreflangLinks({ baseUrl = SITE_URL, path = '/', languages = [], defaultLang = 'en' } = {}) {
  const links = languages
    .filter(Boolean)
    .map((code) => ({ hreflang: code, href: localeHref(baseUrl, code, path) }));
  links.push({ hreflang: 'x-default', href: localeHref(baseUrl, defaultLang, path) });
  return links;
}

/* ---------------------------------------------------------------------------
 * Document application
 * ------------------------------------------------------------------------ */

const setMeta = (doc, selector, attrs) => {
  let el = doc.head.querySelector(selector);
  if (!el) {
    el = doc.createElement('meta');
    doc.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

const setLink = (doc, id, attrs) => {
  let el = doc.head.querySelector(`link[data-cx="${id}"]`);
  if (!el) {
    el = doc.createElement('link');
    el.setAttribute('data-cx', id);
    doc.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

/**
 * Apply localized metadata to the live document.
 * Every write is guarded so a missing <head> or a sandboxed document never
 * breaks a render.
 */
export function applySeo({
  lang,
  dir,
  title,
  description,
  path = '/',
  baseUrl = SITE_URL,
  languages = [],
  siteName = 'CryptoX',
  doc = typeof document === 'undefined' ? null : document
} = {}) {
  if (!doc || !doc.head) return { applied: false, reason: 'no-document' };

  try {
    if (title) doc.title = title;
    if (lang) doc.documentElement.setAttribute('lang', lang);
    if (dir) doc.documentElement.setAttribute('dir', dir);

    if (description) {
      setMeta(doc, 'meta[name="description"]', { name: 'description', content: description });
      setMeta(doc, 'meta[property="og:description"]', { property: 'og:description', content: description });
    }
    if (title) {
      setMeta(doc, 'meta[property="og:title"]', { property: 'og:title', content: title });
      setMeta(doc, 'meta[name="twitter:title"]', { name: 'twitter:title', content: title });
    }
    setMeta(doc, 'meta[property="og:locale"]', { property: 'og:locale', content: String(lang || 'en').replace('-', '_') });
    setMeta(doc, 'meta[property="og:site_name"]', { property: 'og:site_name', content: siteName });

    setLink(doc, 'canonical', { rel: 'canonical', href: localeHref(baseUrl, lang, path) });

    // hreflang: rewrite the managed block so removed languages do not linger.
    doc.head.querySelectorAll('link[rel="alternate"][data-cx-lang]').forEach((n) => n.remove());
    hreflangLinks({ baseUrl, path, languages, defaultLang: 'en' }).forEach(({ hreflang, href }) => {
      const el = doc.createElement('link');
      el.setAttribute('rel', 'alternate');
      el.setAttribute('hreflang', hreflang);
      el.setAttribute('href', href);
      el.setAttribute('data-cx-lang', hreflang);
      doc.head.appendChild(el);
    });

    return { applied: true, alternates: languages.length + 1 };
  } catch (err) {
    return { applied: false, reason: err?.message || 'error' };
  }
}

/** JSON-LD for the site, localized. Returned as an object for testing. */
export function siteJsonLd({ lang = 'en', siteName = 'CryptoX', description, baseUrl = SITE_URL } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url: `${String(baseUrl).replace(/\/+$/, '')}/#/${lang}`,
    inLanguage: lang,
    ...(description ? { description } : {})
  };
}
