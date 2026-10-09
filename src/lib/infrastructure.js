/* Infrastructure and performance posture (Sections 18 and 19).
 *
 * Every entry is either VERIFIED (with the evidence that proves it) or DECLARED
 * as unavailable. The measured entries came from response headers on the live
 * deployment, captured on 2026-10-09; they are facts about that deployment, not
 * claims about the architecture in general.
 *
 * Sections 18 and 19 are mostly infrastructure this repository does not own:
 * WAF, load balancing, auto-scaling, multi-region, database replication and
 * Disaster recovery are configured at the hosting provider. Listing them as
 * "done" because a diagram says so is exactly how a real gap survives an audit.
 */

export const MEASURED = {
  capturedAt: '2026-10-09',
  origin: 'Alibaba Cloud OSS (x-oss-* response headers)',
  cdn: 'Alibaba Cloud CDN / Swift (X-Cache, Ali-Swift-* headers)',
  findings: {
    cdnCaching: { value: 'X-Cache: HIT TCP_REFRESH_HIT', rating: 'verified' },
    cdnToOriginAuth: { value: 'x-oss-cdn-auth: success', rating: 'verified' },
    tls: { value: 'HTTPS served; TLS terminated at the CDN', rating: 'verified' },
    timingAllowed: { value: 'Timing-Allow-Origin: *', rating: 'verified', note: 'Resource Timing is permitted, so real-user performance measurement works from the browser.' },
    compression: {
      value: 'content-encoding: absent on /assets/*.js',
      rating: 'defect',
      detail: 'A 311 KB bundle is transferred as 318,455 bytes — the byte count equals the uncompressed size, so no gzip or brotli is applied. Compression would cut roughly two thirds of that.',
      fix: 'Enable gzip/brotli at the CDN or origin. The Vary header already advertises Accept-Encoding, so the origin supports variants.'
    },
    assetCacheHeaders: {
      value: 'cache-control: absent on hashed assets',
      rating: 'defect',
      detail: 'Filenames are content-hashed, so they can be cached forever, but with no cache-control they may be revalidated on every visit.',
      fix: 'public, max-age=31536000, immutable for /assets/*.'
    },
    htmlCache: { value: 'X-Swift-CacheTime: 16', rating: 'ok', note: 'Short TTL on HTML is correct: it must not outlive a deploy.' },
    securityHeaders: {
      value: 'No strict-transport-security, content-security-policy or x-content-type-options response headers',
      rating: 'defect',
      detail: 'The CSP exists as a meta tag in the document, which applies after the document starts parsing and cannot cover everything a header covers.',
      fix: 'Serve CSP, HSTS and X-Content-Type-Options as response headers at the CDN.'
    }
  }
};

/* ------------------------------------------------------------------ Section 18 */

/*
 * `owner` is the honest part: 'repo' means this codebase can enforce it,
 * 'cdn' means the deployment must, 'provider' means the hosting platform, and
 * 'n/a' means it does not apply to a static application.
 */
export const PERFORMANCE = [
  { item: 'CDN', owner: 'cdn', status: 'verified', evidence: 'X-Cache: HIT from Alibaba CDN.' },
  { item: 'Edge caching', owner: 'cdn', status: 'partial', evidence: 'Working for HTML; the 16s TTL is appropriate. Broken for hashed assets, which have no cache-control.' },
  { item: 'Compression', owner: 'cdn', status: 'defect', evidence: 'No content-encoding on assets; full 311 KB transferred.' },
  { item: 'Code splitting', owner: 'repo', status: 'verified', evidence: '91 lazy chunks emitted; enforced by scripts/check-bundle.mjs.' },
  { item: 'Tree shaking', owner: 'repo', status: 'verified', evidence: 'Vite production build; unwired modules are demonstrably absent from the bundle.' },
  { item: 'Lazy loading', owner: 'repo', status: 'verified', evidence: 'Every route and every translation catalog outside English is a dynamic import.' },
  { item: 'Hashed asset caching', owner: 'cdn', status: 'defect', evidence: 'No cache-control on content-hashed assets, so they may be revalidated on every visit. They could be immutable for a year.' },
  { item: 'Image optimization / WebP / AVIF', owner: 'repo', status: 'n/a', evidence: 'The application ships no content images; the only assets are PWA icons in PNG. Nothing to optimise until real imagery is added.' },
  { item: 'Database indexing', owner: 'repo', status: 'verified', evidence: 'Per-user indexes in 0001; migration 0002 adds composite and partial indexes.' },
  { item: 'Query optimization', owner: 'repo', status: 'partial', evidence: 'Indexes match the query shapes the app uses; no EXPLAIN analysis has been run against production data volumes.' },
  { item: 'Caching layer / API caching', owner: 'provider', status: 'n/a', evidence: 'The application is static; there is no application server to cache at. Market data is cached client-side with explicit TTLs and staleness (see rates.js).' },
  { item: 'Background jobs / queue architecture / connection pooling', owner: 'provider', status: 'n/a', evidence: 'No server-side runtime exists in this build, so there is nothing to schedule or pool.' },
  { item: 'Performance monitoring', owner: 'repo', status: 'implemented', evidence: 'src/lib/webVitals.js collects LCP, INP, CLS, TTFB and API latency. It reports nothing anywhere, because there is no endpoint — stated in the module.' }
];

export const PERFORMANCE_TARGETS = [
  { metric: 'LCP', target: '<= 2500ms', measured: 'collector implemented; no field data yet' },
  { metric: 'INP', target: '<= 200ms', measured: 'collector implemented; no field data yet' },
  { metric: 'CLS', target: '<= 0.1', measured: 'collector implemented; no field data yet' },
  { metric: 'TTFB', target: '<= 800ms', measured: 'x-oss-server-time observed at 86ms on the origin document' },
  { metric: 'API latency', target: 'p75 <= 300ms', measured: 'tracker implemented; no field data yet' },
  { metric: 'Database latency', target: 'p95 <= 50ms', measured: 'unavailable — provider metric' },
  { metric: 'Error rate', target: '<= 1%', measured: 'client-side rate implemented; server rate is a provider metric' }
];

export const MEASURED_NOTE =
  'Field data requires real traffic. A collector with no endpoint and no users produces no numbers, and inventing them would be worse than leaving the column empty.';

/* ------------------------------------------------------------------ Section 19 */

export const ARCHITECTURE_PATH = [
  { hop: 'User', owner: 'n/a' },
  { hop: 'CDN / Edge', owner: 'cdn', status: 'verified' },
  { hop: 'WAF', owner: 'provider', status: 'unavailable', note: 'Needs a WAF product in front of the origin.' },
  { hop: 'Load balancer', owner: 'provider', status: 'n/a', note: 'Static object storage needs no load balancer.' },
  { hop: 'Application', owner: 'repo', status: 'verified', note: 'Static bundle; there is no application server.' },
  { hop: 'Services', owner: 'provider', status: 'unavailable', note: 'Supabase auth and Postgres are the only services.' },
  { hop: 'Database / Cache / Queue', owner: 'provider', status: 'partial', note: 'Postgres exists; no cache tier and no queue.' }
];

export const INFRASTRUCTURE = [
  { item: 'Multi-region deployment', status: 'provider', note: 'Single-region today. Requires provider configuration plus a data-residency decision, since replicating EU data to another region is itself a compliance event.' },
  { item: 'Regional failover', status: 'provider', note: 'Depends on multi-region and on a replication strategy for Postgres.' },
  { item: 'CDN', status: 'verified', evidence: 'Serving with cache HITs.' },
  { item: 'Global DNS', status: 'provider', note: 'Single hostname resolving through the provider.' },
  { item: 'Health checks', status: 'partial', note: 'The application has a /status page, but it checks public API reachability from the browser, not the deployment\'s own health. A real health check is an endpoint the platform polls.' },
  { item: 'Auto-scaling', status: 'n/a', note: 'Static assets scale by definition; there is no compute to scale.' },
  { item: 'Horizontal scaling', status: 'n/a', note: 'Same as above. The database is the only scaling concern.' },
  { item: 'Database replication', status: 'provider' },
  { item: 'Read replicas', status: 'provider', note: 'No read/write split exists; the client talks to one Postgres endpoint through PostgREST.' },
  { item: 'Backup infrastructure', status: 'provider', note: 'Supabase automated backups. Whether PITR is enabled is a plan-level setting that must be confirmed on the live project, not assumed.' },
  { item: 'Disaster recovery', status: 'unavailable', note: 'No RTO or RPO is defined, and an untested restore is not a recovery plan. This needs a written runbook plus a restore rehearsal.' }
];

export const infrastructureSummary = () => {
  const all = [...PERFORMANCE, ...INFRASTRUCTURE];
  return {
    total: all.length,
    verified: all.filter((i) => i.status === 'verified').length,
    implemented: all.filter((i) => i.status === 'implemented').length,
    partial: all.filter((i) => i.status === 'partial').length,
    defects: all.filter((i) => i.status === 'defect').length,
    // Defects found by MEASURING the live deployment, which include items that
    // are not performance work (the missing security headers).
    measuredDefects: Object.values(MEASURED.findings).filter((f) => f.rating === 'defect').length,
    unavailable: all.filter((i) => i.status === 'unavailable').length,
    notApplicable: all.filter((i) => i.status === 'n/a').length,
    providerOwned: all.filter((i) => i.owner === 'provider').length
  };
};
