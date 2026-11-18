/* Localized SEO: titles, descriptions, canonical URLs, robots and hreflang.
 *
 * HISTORY — read before trusting this file.
 * CryptoX used to be routed with HashRouter, so every route lived behind `#/`
 * and the whole application exposed exactly one crawlable URL. The markup
 * below was correct but had nothing to point at, which `SEO_LIMITATION`
 * admitted in the UI. The app now uses path routing (BrowserRouter): the
 * canonical URLs produced here are real paths that return 200, so a crawler
 * sees a distinct URL per route.
 *
 * The remaining honest limitation is LANGUAGE, not routing. The interface
 * ships 24 catalogs but URLs are not locale-prefixed, so `/pricing` is one
 * document whose language is chosen on the client. We therefore do not emit
 * hreflang alternates: 24 alternates all serving the same document is a
 * duplicate-URL signal, not a multilingual site. `hreflangLinks` stays
 * available for the day real locale prefixes exist; the Region page uses it to
 * explain the gap instead of pretending it is solved.
 */

import { seoForPath, canonicalFor, SITE_NAME } from './routes.js';

export { SITE_NAME };

export const SITE_URL = 'https://cryptox-v2.site.accio.ai';

export const SEO_LIMITATION =
  'Per-language URLs need locale-prefixed routes or pre-rendering; one document serves all 24 catalogs, so no hreflang alternates are emitted.';

/** Default social preview image (1200×630 PNG at public/og-image.png).
 *
 * PNG, not the SVG card in public/assets/images: Facebook, X, LinkedIn and
 * Slack do not render SVG in a link preview — they drop the card entirely, so an
 * SVG og:image is the same as having none. The SVG stays in the repo as the
 * editable source; export it to this PNG whenever the card changes.
 */
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

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

/**
 * Full URL for a locale + route. Path-based: locale prefixes are real paths,
 * never fragments, so the same function serves both canonical and alternate.
 */
export const localeHref = (baseUrl, lang, path) =>
  `${String(baseUrl).replace(/\/+$/, '')}${localePath(lang, path)}`;

/**
 * hreflang alternates for a route, plus an x-default pointing at the source
 * language. Only meaningful once every language has its own indexable URL.
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

/** JSON-LD block, rewritten in place so repeat renders do not stack up. */
export function setJsonLd(doc, id, data) {
  if (!doc || !doc.head) return null;
  let el = doc.head.querySelector(`script[data-cx-ld="${id}"]`);
  if (!el) {
    el = doc.createElement('script');
    el.setAttribute('type', 'application/ld+json');
    el.setAttribute('data-cx-ld', id);
    doc.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
  return el;
}

/**
 * Apply route-aware metadata to the live document.
 *
 * `pathname` drives everything: the canonical, og:url, the title and the
 * robots directive. A path that is not in the public manifest is marked
 * `noindex, nofollow` rather than inheriting the home page's canonical —
 * inheriting it is how a private route gets indexed as a duplicate of `/`.
 */
export function applySeo({
  lang,
  dir,
  pathname = '/',
  title,
  description,
  baseUrl = SITE_URL,
  siteName = SITE_NAME,
  languages = [],
  doc = typeof document === 'undefined' ? null : document
} = {}) {
  if (!doc || !doc.head) return { applied: false, reason: 'no-document' };

  try {
    const route = seoForPath(pathname);
    const indexable = Boolean(route?.indexable);

    const finalTitle = route?.title || title || siteName;
    const finalDescription = route?.description || description || '';
    const canonical = canonicalFor(pathname, baseUrl);

    if (lang) doc.documentElement.setAttribute('lang', lang);
    if (dir) doc.documentElement.setAttribute('dir', dir);
    doc.title = finalTitle;

    if (finalDescription) {
      setMeta(doc, 'meta[name="description"]', { name: 'description', content: finalDescription });
      setMeta(doc, 'meta[property="og:description"]', { property: 'og:description', content: finalDescription });
      setMeta(doc, 'meta[name="twitter:description"]', { name: 'twitter:description', content: finalDescription });
    }

    setMeta(doc, 'meta[name="robots"]', {
      name: 'robots',
      content: indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'
    });
    setMeta(doc, 'meta[property="og:title"]', { property: 'og:title', content: finalTitle });
    setMeta(doc, 'meta[name="twitter:title"]', { name: 'twitter:title', content: finalTitle });
    setMeta(doc, 'meta[property="og:type"]', { property: 'og:type', content: 'website' });
    setMeta(doc, 'meta[property="og:url"]', { property: 'og:url', content: canonical });
    setMeta(doc, 'meta[property="og:image"]', { property: 'og:image', content: OG_IMAGE });
    setMeta(doc, 'meta[property="og:locale"]', { property: 'og:locale', content: String(lang || 'en').replace('-', '_') });
    setMeta(doc, 'meta[property="og:site_name"]', { property: 'og:site_name', content: siteName });
    setMeta(doc, 'meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
    setMeta(doc, 'meta[name="twitter:image"]', { name: 'twitter:image', content: OG_IMAGE });

    setLink(doc, 'canonical', { rel: 'canonical', href: canonical });

    // Alternates are emitted only when real locale-prefixed URLs are passed in.
    doc.head.querySelectorAll('link[rel="alternate"][data-cx-lang]').forEach((n) => n.remove());
    if (languages.length) {
      hreflangLinks({ baseUrl, path: pathname, languages, defaultLang: 'en' }).forEach(({ hreflang, href }) => {
        const el = doc.createElement('link');
        el.setAttribute('rel', 'alternate');
        el.setAttribute('hreflang', hreflang);
        el.setAttribute('href', href);
        el.setAttribute('data-cx-lang', hreflang);
        doc.head.appendChild(el);
      });
    }

    return { applied: true, canonical, indexable, alternates: languages.length };
  } catch (err) {
    return { applied: false, reason: err?.message || 'error' };
  }
}

/** JSON-LD for the site, localized. Returned as an object for testing. */
export function siteJsonLd({ lang = 'en', siteName = SITE_NAME, description, baseUrl = SITE_URL, pathname = '/' } = {}) {
  const url = pathname === '/' ? `${String(baseUrl).replace(/\/+$/, '')}/${lang}` : canonicalFor(pathname, baseUrl);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url,
    inLanguage: lang,
    ...(description ? { description } : {})
  };
}
