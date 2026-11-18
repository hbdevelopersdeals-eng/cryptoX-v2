import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../lib/i18n.jsx';
import { applySeo, setJsonLd, siteJsonLd } from '../lib/seo.js';

/* Owns <title>, <meta description>, canonical, robots and og:url.
 *
 * It lives inside the router because metadata is a function of the URL: two
 * routes must never share a canonical. Rendering it as a route-agnostic effect
 * (which is what the app did before) is why every page advertised the home
 * page's canonical and search engines had no reason to index any of them.
 *
 * Private routes are marked `noindex, nofollow` by applySeo. That is not a
 * substitute for the auth gate; it stops a crawler that reached a deep link
 * from filing it as a thin duplicate of the login page.
 */
export default function SeoManager() {
  const { pathname } = useLocation();
  const { lang, dir } = useI18n();

  useEffect(() => {
    applySeo({ lang, dir, pathname });
  }, [pathname, lang, dir]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setJsonLd(document, 'website', siteJsonLd({ lang }));
  }, [lang]);

  return null;
}
