import { describe, it, expect } from 'vitest';
import {
  API_VERSION, SUPPORTED_VERSIONS, ROUTES, PAGE, ERROR_CODES, DEPRECATION_POLICY,
  findRoute, buildPath, encodeCursor, decodeCursor, parsePagination,
  buildQuery, errorEnvelope, versionHeaders, validateVersion, validateRequest,
  idempotencyFor, routeAuthRequirement, generateOpenApi, validateRegistry, apiSummary
} from './api.js';

/* The route registry is the contract; these tests are what stop it drifting. */

describe('api registry', () => {
  it('has no structural problems', () => {
    const res = validateRegistry();
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.routes).toBe(ROUTES.length);
  });

  it('versions every route and declares one version as current', () => {
    expect(SUPPORTED_VERSIONS).toContain(API_VERSION);
    for (const r of ROUTES) expect(SUPPORTED_VERSIONS).toContain(r.version);
  });

  it('gives every authenticated route a permission', () => {
    // An authenticated route with no permission ships open by accident.
    for (const r of ROUTES) {
      if (r.auth === 'required') expect(r.permission, `${r.method} ${r.path}`).toBeTruthy();
    }
  });

  it('finds routes regardless of method case, and returns null otherwise', () => {
    expect(findRoute('GET', '/portfolios')?.permission).toBe('portfolio:read');
    expect(findRoute('get', '/portfolios')?.permission).toBe('portfolio:read');
    expect(findRoute('GET', '/nope')).toBeNull();
    expect(findRoute('POST', '/portfolios', 'v9')).toBeNull();
  });
});

describe('buildPath', () => {
  it('substitutes path parameters under the version prefix', () => {
    expect(buildPath(findRoute('GET', '/portfolios/{id}'), { id: 'p_1' }))
      .toEqual({ ok: true, url: '/api/v1/portfolios/p_1' });
  });

  it('encodes a parameter rather than splicing it in raw', () => {
    const res = buildPath(findRoute('GET', '/portfolios/{id}'), { id: 'a/b?c#d' });
    expect(res.ok).toBe(true);
    expect(res.url).toBe('/api/v1/portfolios/a%2Fb%3Fc%23d');
  });

  it('refuses to build a path with a missing parameter', () => {
    const res = buildPath(findRoute('GET', '/portfolios/{id}'));
    expect(res).toEqual({ ok: false, reason: 'missing-path-params', missing: ['id'] });
  });

  it('refuses an unknown route', () => {
    expect(buildPath(null).reason).toBe('unknown-route');
  });
});

describe('pagination cursors', () => {
  it('round-trips a cursor', () => {
    const encoded = encodeCursor({ id: 'p_1', sort: '-createdAt' });
    expect(decodeCursor(encoded)).toEqual({ ok: true, value: { id: 'p_1', sort: '-createdAt' } });
  });

  it('pads a cursor whose length is not a multiple of four', () => {
    // Stripping the '=' padding makes length%4 non-zero for most payloads;
    // atob rejects unpadded input, so decode must restore the padding itself.
    const encoded = encodeCursor({ id: 'a' });
    expect(encoded.length % 4).not.toBe(0);
    expect(decodeCursor(encoded).value).toMatchObject({ id: 'a' });
  });

  it('refuses a cursor with no id', () => {
    const noId = btoa(JSON.stringify({ sort: 'x' })).replace(/=+$/, '');
    expect(decodeCursor(noId)).toEqual({ ok: false, reason: 'cursor-missing-id' });
  });

  it('refuses a malformed cursor instead of throwing', () => {
    expect(decodeCursor('!!!not-base64!!!')).toEqual({ ok: false, reason: 'cursor-malformed' });
    expect(decodeCursor(btoa('not json'))).toEqual({ ok: false, reason: 'cursor-malformed' });
  });

  it('treats an absent cursor as the first page', () => {
    expect(decodeCursor(null)).toEqual({ ok: true, value: null });
    expect(decodeCursor('')).toEqual({ ok: true, value: null });
    expect(encodeCursor({ id: null })).toBeNull();
  });
});

describe('parsePagination', () => {
  it('defaults to the page size', () => {
    expect(parsePagination()).toMatchObject({ ok: true, limit: PAGE.defaultLimit, clamped: false, cursor: null });
  });

  it('clamps an oversized limit and says so rather than rejecting', () => {
    const res = parsePagination({ limit: 10_000 });
    expect(res.limit).toBe(PAGE.maxLimit);
    expect(res.clamped).toBe(true);
    expect(res.note).toMatch(/maximum of 100/);
  });

  it('falls back on a nonsense limit', () => {
    for (const bad of ['abc', 0, -5, null, undefined, NaN]) {
      expect(parsePagination({ limit: bad }).limit).toBe(PAGE.defaultLimit);
    }
  });

  it('floors a fractional limit', () => {
    expect(parsePagination({ limit: 12.9 }).limit).toBe(12);
  });

  it('propagates a bad cursor rather than silently paginating from the start', () => {
    expect(parsePagination({ cursor: '!!' })).toEqual({ ok: false, reason: 'cursor-malformed' });
  });

  it('returns the decoded cursor for a valid one', () => {
    const res = parsePagination({ limit: 10, cursor: encodeCursor({ id: 'x' }) });
    expect(res.cursor).toMatchObject({ id: 'x' });
  });
});

describe('buildQuery filter and sort allowlists', () => {
  const listRoute = findRoute('GET', '/portfolios');

  it('accepts the declared filters and applies the default sort', () => {
    const res = buildQuery(listRoute, { filters: { currency: 'EUR' } });
    expect(res).toEqual({ ok: true, filters: { currency: 'EUR' }, order: '-createdAt' });
  });

  it('refuses an unknown filter instead of dropping it', () => {
    // Dropping the clause would return a superset of what was asked for, which
    // on an authorization-scoped query is a data leak, not a harmless no-op.
    const res = buildQuery(listRoute, { filters: { currency: 'EUR', secret: '1' } });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unknown-filter');
    expect(res.unknown).toEqual(['secret']);
    expect(res.allowed).toContain('currency');
  });

  it('accepts a sortable field in either direction', () => {
    expect(buildQuery(listRoute, { sort: 'name' }).order).toBe('name');
    expect(buildQuery(listRoute, { sort: '-createdAt' }).order).toBe('-createdAt');
  });

  it('refuses a sort field outside the allowlist', () => {
    const res = buildQuery(listRoute, { sort: '-passwordHash' });
    expect(res).toEqual({ ok: false, reason: 'unknown-sort', field: 'passwordHash', allowed: ['createdAt', 'name'] });
  });

  it('requires a deterministic order on a paginated route', () => {
    // A paginated query with no stable sort can skip or repeat rows between pages.
    const res = buildQuery({ paginated: true, filters: [], sortable: ['a'] }, {});
    expect(res).toEqual({ ok: false, reason: 'sort-required-for-pagination' });
  });

  it('leaves an unpaginated route unordered when it declares no default', () => {
    const res = buildQuery(findRoute('GET', '/market/quotes'), { filters: { symbols: 'BTCUSDT' } });
    expect(res).toEqual({ ok: true, filters: { symbols: 'BTCUSDT' }, order: null });
  });

  it('copies the filters so a caller cannot mutate the result afterwards', () => {
    const filters = { currency: 'EUR' };
    const res = buildQuery(listRoute, { filters });
    expect(res.filters).not.toBe(filters);
  });

  it('refuses an unknown route', () => {
    expect(buildQuery(null).reason).toBe('unknown-route');
  });
});

describe('error envelope', () => {
  it('maps each code to its status and repeats it in the body', () => {
    for (const [code, status] of Object.entries(ERROR_CODES)) {
      const res = errorEnvelope({ code });
      expect(res.status).toBe(status);
      expect(res.body.error.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    }
  });

  it('always carries a request id, in the body and the header', () => {
    const res = errorEnvelope({ code: 'not_found' });
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });

  it('honours a supplied request id so the caller can correlate it', () => {
    const res = errorEnvelope({ code: 'conflict', requestId: 'req-123' });
    expect(res.body.error.requestId).toBe('req-123');
  });

  it('humanises the code when no message is given', () => {
    expect(errorEnvelope({ code: 'permission_denied' }).body.error.message).toBe('permission denied');
    expect(errorEnvelope({ code: 'conflict', message: 'Already exists' }).body.error.message).toBe('Already exists');
  });

  it('refuses an unknown code so a client never gets an unmapped status', () => {
    const res = errorEnvelope({ code: 'teapot' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unknown-error-code');
    expect(res.allowed).toContain('rate_limited');
  });
});

describe('version headers and deprecation policy', () => {
  const ticker = findRoute('GET', '/market/ticker');

  it('emits only the version header on a live route', () => {
    expect(versionHeaders(findRoute('GET', '/portfolios'))).toEqual({ 'x-api-version': 'v1' });
  });

  it('announces sunset, successor and time remaining on a deprecated route', () => {
    const h = versionHeaders(ticker, { now: new Date('2026-06-01T00:00:00Z') });
    expect(h.deprecation).toBe(`@${new Date('2026-06-01').getTime() / 1000}`);
    expect(h.sunset).toBe(new Date('2027-01-01').toUTCString());
    expect(h.link).toBe('</market/quotes>; rel="successor-version"');
    expect(Number(h['x-sunset-in-days'])).toBeGreaterThan(200);
  });

  it('warns when less than the policy minimum notice remains', () => {
    const late = versionHeaders(ticker, { now: new Date('2026-12-22T00:00:00Z') });
    expect(Number(late['x-sunset-in-days'])).toBeLessThan(DEPRECATION_POLICY.minimumNoticeDays);
    expect(late.note).toMatch(/only \d+ days remain/);

    const early = versionHeaders(ticker, { now: new Date('2026-06-01T00:00:00Z') });
    expect(early.note).toBeUndefined();
  });

  it('never reports negative days remaining', () => {
    const past = versionHeaders(ticker, { now: new Date('2030-01-01T00:00:00Z') });
    expect(Number(past['x-sunset-in-days'])).toBe(0);
  });

  it('validates the requested version', () => {
    expect(validateVersion(null)).toEqual({ ok: true, version: API_VERSION });
    expect(validateVersion('v1')).toEqual({ ok: true, version: 'v1' });
    expect(validateVersion('v2')).toEqual({ ok: false, reason: 'unsupported-version', supported: SUPPORTED_VERSIONS });
  });
});

describe('request validation', () => {
  it('accepts a complete body', () => {
    expect(validateRequest(findRoute('POST', '/portfolios'), { name: 'Main', currency: 'USD' })).toEqual({ ok: true });
  });

  it('reports every missing required field', () => {
    const res = validateRequest(findRoute('POST', '/portfolios'), { name: 'Main' });
    expect(res).toEqual({ ok: false, reason: 'missing-fields', missing: ['currency'] });
  });

  it('counts an empty string as missing', () => {
    // '' is what an empty form field submits; treating it as present would let
    // an empty symbol reach the database.
    const res = validateRequest(findRoute('POST', '/alerts'), { symbol: '   '.trim(), ruleType: '' });
    expect(res.missing).toEqual(['symbol', 'ruleType']);
  });

  it('accepts a route that declares no requirements', () => {
    expect(validateRequest(findRoute('GET', '/portfolios'), {}).ok).toBe(true);
  });

  it('refuses an unknown route', () => {
    expect(validateRequest(null).reason).toBe('unknown-route');
  });
});

describe('idempotency', () => {
  it('is not required on a route that does not declare it', () => {
    expect(idempotencyFor(findRoute('GET', '/portfolios'))).toEqual({ ok: true, required: false });
  });

  it('derives a stable key for the same operation and payload', () => {
    const route = findRoute('POST', '/portfolios');
    const a = idempotencyFor(route, { payload: { name: 'Main', currency: 'USD' }, actor: 'u1' });
    const b = idempotencyFor(route, { payload: { currency: 'USD', name: 'Main' }, actor: 'u1' });
    expect(a.required).toBe(true);
    expect(a.header).toBe('idempotency-key');
    expect(a.key).toBe(b.key); // key order must not change the key
  });

  it('separates different payloads and different actors', () => {
    const route = findRoute('POST', '/portfolios');
    const base = idempotencyFor(route, { payload: { name: 'A' }, actor: 'u1' }).key;
    expect(idempotencyFor(route, { payload: { name: 'B' }, actor: 'u1' }).key).not.toBe(base);
    expect(idempotencyFor(route, { payload: { name: 'A' }, actor: 'u2' }).key).not.toBe(base);
  });
});

describe('route authorization declaration', () => {
  it('passes a public route through with no permission', () => {
    expect(routeAuthRequirement(findRoute('GET', '/market/quotes')))
      .toEqual({ ok: true, auth: 'none', permission: null });
  });

  it('rejects an authenticated route that names no permission', () => {
    const res = routeAuthRequirement({ method: 'GET', path: '/x', auth: 'required' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('missing-permission-declaration');
  });

  it('refuses an unknown route', () => {
    expect(routeAuthRequirement(null).reason).toBe('unknown-route');
  });
});

describe('OpenAPI generation', () => {
  const doc = generateOpenApi({ serverUrl: 'https://api.cryptox.test' });

  it('emits a 3.1 document with the server and error schema', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://api.cryptox.test' }]);
    expect(doc.components.schemas.Error.required).toEqual(['error']);
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('describes every registered route and no others', () => {
    const expected = new Set(ROUTES.map((r) => `/api/${r.version}${r.path}`));
    expect(new Set(Object.keys(doc.paths))).toEqual(expected);
    for (const r of ROUTES) {
      expect(doc.paths[`/api/${r.version}${r.path}`][r.method.toLowerCase()]).toBeTruthy();
    }
  });

  it('turns path parameters and pagination into real parameters', () => {
    const op = doc.paths['/api/v1/portfolios/{id}'].get;
    expect(op.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);

    const list = doc.paths['/api/v1/portfolios'].get;
    const names = list.parameters.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['limit', 'cursor', 'currency', 'createdAfter', 'sort']));
    expect(list.parameters.find((p) => p.name === 'limit').schema.maximum).toBe(PAGE.maxLimit);
  });

  it('enumerates sort in both directions', () => {
    const sort = doc.paths['/api/v1/portfolios'].get.parameters.find((p) => p.name === 'sort');
    expect(sort.schema.enum).toEqual(['createdAt', 'name', '-createdAt', '-name']);
  });

  it('marks the deprecated route and leaves security open where auth is none', () => {
    expect(doc.paths['/api/v1/market/ticker'].get.deprecated).toBe(true);
    expect(doc.paths['/api/v1/market/ticker'].get.security).toEqual([]);
    expect(doc.paths['/api/v1/portfolios'].get.security).toEqual([{ bearerAuth: [] }, { apiKey: [] }]);
  });

  it('documents the failure statuses a caller must handle', () => {
    const list = doc.paths['/api/v1/portfolios'].get.responses;
    expect(Object.keys(list)).toEqual(expect.arrayContaining(['200', '400', '401', '403', '429', '500']));
    expect(list['400'].content['application/json'].schema.$ref).toBe('#/components/schemas/Error');
  });

  it('gives every operation a unique operationId', () => {
    const ids = [];
    for (const p of Object.values(doc.paths)) for (const op of Object.values(p)) ids.push(op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('validateRegistry catches regressions', () => {
  const base = { method: 'GET', path: '/x', version: 'v1' };

  it('flags a duplicate route', () => {
    const res = validateRegistry([base, { ...base }]);
    expect(res.problems).toContainEqual({ route: 'GET v1/x', reason: 'duplicate' });
    expect(res.ok).toBe(false);
  });

  it('flags an unsupported version', () => {
    expect(validateRegistry([{ ...base, version: 'v9' }]).problems)
      .toContainEqual({ route: 'GET v9/x', reason: 'unsupported-version' });
  });

  it('flags an authenticated route with no permission', () => {
    expect(validateRegistry([{ ...base, auth: 'required' }]).problems)
      .toContainEqual({ route: 'GET v1/x', reason: 'missing-permission' });
  });

  it('flags pagination with no sortable field', () => {
    expect(validateRegistry([{ ...base, paginated: true }]).problems)
      .toContainEqual({ route: 'GET v1/x', reason: 'paginated-without-sort' });
  });

  it('flags a deprecation notice shorter than the policy allows', () => {
    const problems = validateRegistry([{
      ...base, deprecated: { since: '2026-01-01', sunset: '2026-01-31', replacement: '/y' }
    }]).problems;
    expect(problems.some((p) => p.reason === 'deprecation-notice-too-short')).toBe(true);
  });

  it('flags a deprecation with no successor to migrate to', () => {
    const problems = validateRegistry([{
      ...base, deprecated: { since: '2026-01-01', sunset: '2027-01-01' }
    }]).problems;
    expect(problems).toContainEqual({ route: 'GET v1/x', reason: 'deprecation-without-replacement' });
  });
});

describe('apiSummary', () => {
  it('counts what the registry actually contains', () => {
    const s = apiSummary();
    expect(s.version).toBe(API_VERSION);
    expect(s.routes).toBe(ROUTES.length);
    expect(s.paginated).toBe(ROUTES.filter((r) => r.paginated).length);
    expect(s.idempotent).toBe(ROUTES.filter((r) => r.idempotent).length);
    expect(s.deprecated).toBe(ROUTES.filter((r) => r.deprecated).length);
    expect(s.errorCodes).toBe(Object.keys(ERROR_CODES).length);
  });
});
