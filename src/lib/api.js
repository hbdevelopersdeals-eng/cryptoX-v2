/* API conventions (Section 27).
 *
 * This application has no server, so what is built here is the CONTRACT a
 * backend must satisfy — the part that can be defined, validated and generated
 * without one. Supabase/PostgREST is the de facto API today; these conventions
 * are what a versioned facade in front of it would enforce.
 *
 * Two decisions that matter more than the rest:
 *   - Filter and sort field names are checked against a per-route ALLOWLIST.
 *     Interpolating a caller-supplied column name into a query is the same
 *     injection class as interpolating a value.
 *   - Errors have one shape everywhere, always carrying a code and the request
 *     id, because an error the client cannot correlate is an error nobody can
 *     debug.
 */

import { correlationId } from './observability.js';
import { idempotencyKey } from './reliability.js';

export const API_VERSION = 'v1';
export const SUPPORTED_VERSIONS = ['v1'];

/*
 * The route registry IS the documentation. OpenAPI below is generated from it,
 * so the spec cannot drift from the implementation — which is the usual fate of
 * a hand-written spec.
 */
export const ROUTES = [
  {
    method: 'GET', path: '/portfolios', version: 'v1', auth: 'required', permission: 'portfolio:read',
    paginated: true, filters: ['currency', 'createdAfter'], sortable: ['createdAt', 'name'], defaultSort: '-createdAt'
  },
  {
    method: 'POST', path: '/portfolios', version: 'v1', auth: 'required', permission: 'portfolio:create',
    idempotent: true, request: { required: ['name', 'currency'] }
  },
  {
    method: 'GET', path: '/portfolios/{id}', version: 'v1', auth: 'required', permission: 'portfolio:read', owned: true
  },
  {
    method: 'DELETE', path: '/portfolios/{id}', version: 'v1', auth: 'required', permission: 'portfolio:delete', owned: true, idempotent: true
  },
  {
    method: 'GET', path: '/alerts', version: 'v1', auth: 'required', permission: 'alerts:read',
    paginated: true, filters: ['symbol', 'enabled'], sortable: ['createdAt'], defaultSort: '-createdAt'
  },
  {
    method: 'POST', path: '/alerts', version: 'v1', auth: 'required', permission: 'alerts:create', idempotent: true,
    request: { required: ['symbol', 'ruleType'] }
  },
  {
    method: 'GET', path: '/market/quotes', version: 'v1', auth: 'none', permission: null,
    filters: ['symbols'], sortable: [], cacheSeconds: 5,
    request: { required: ['symbols'] }
  },
  {
    method: 'GET', path: '/billing/invoices', version: 'v1', auth: 'required', permission: 'billing:read',
    paginated: true, filters: ['status', 'currency'], sortable: ['issuedAt'], defaultSort: '-issuedAt'
  },
  {
    method: 'POST', path: '/billing/refunds', version: 'v1', auth: 'required', permission: 'billing:approve', idempotent: true,
    request: { required: ['invoiceId', 'amount'] }
  },
  {
    // Retained so existing clients keep working, with a date they can plan around.
    method: 'GET', path: '/market/ticker', version: 'v1', auth: 'none', permission: null,
    deprecated: { since: '2026-06-01', sunset: '2027-01-01', replacement: '/market/quotes' }
  }
];

export const findRoute = (method, path, version = API_VERSION) =>
  ROUTES.find((r) => r.method === method.toUpperCase() && r.path === path && r.version === version) || null;

/** Build a versioned path, substituting {params}. Missing params are refused. */
export function buildPath(route, params = {}) {
  if (!route) return { ok: false, reason: 'unknown-route' };
  const missing = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => params[k] == null);
  if (missing.length) return { ok: false, reason: 'missing-path-params', missing };
  const path = route.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(params[k])));
  return { ok: true, url: `/api/${route.version}${path}` };
}

/* ------------------------------------------------------------- pagination */

export const PAGE = { defaultLimit: 25, maxLimit: 100 };

/** Cursor-based, because offsets drift when rows are inserted mid-pagination. */
export function encodeCursor({ id, sort = null }) {
  if (id == null) return null;
  return btoa(JSON.stringify({ id, sort })).replace(/=+$/, '');
}

export function decodeCursor(cursor) {
  if (!cursor) return { ok: true, value: null };
  try {
    const pad = cursor.length % 4 === 0 ? '' : '='.repeat(4 - (cursor.length % 4));
    const parsed = JSON.parse(atob(cursor + pad));
    if (parsed?.id == null) return { ok: false, reason: 'cursor-missing-id' };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, reason: 'cursor-malformed' };
  }
}

export function parsePagination({ limit, cursor } = {}) {
  const raw = Number(limit);
  const requested = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : PAGE.defaultLimit;
  // Clamp rather than reject: a client asking for 10,000 rows gets the maximum
  // and a flag telling it the request was adjusted.
  const clamped = Math.min(requested, PAGE.maxLimit);
  const decoded = decodeCursor(cursor);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  return {
    ok: true,
    limit: clamped,
    clamped: clamped !== requested,
    cursor: decoded.value,
    note: clamped !== requested ? `Limit raised/lowered to the maximum of ${PAGE.maxLimit}.` : undefined
  };
}

/* ------------------------------------------------------- filter and sort */

/**
 * Validate filters and sort against the route allowlist.
 *
 * An unknown field is an ERROR, not a silently ignored clause: silently dropping
 * a filter returns a superset of what the caller asked for, which for an
 * authorization-scoped query is a data leak rather than a bug.
 */
export function buildQuery(route, { filters = {}, sort = null } = {}) {
  if (!route) return { ok: false, reason: 'unknown-route' };
  const allowedFilters = route.filters || [];
  const allowedSortable = route.sortable || [];
  const unknown = Object.keys(filters).filter((k) => !allowedFilters.includes(k));
  if (unknown.length) return { ok: false, reason: 'unknown-filter', unknown, allowed: allowedFilters };

  let order = route.defaultSort || null;
  if (sort) {
    const desc = String(sort).startsWith('-');
    const field = desc ? String(sort).slice(1) : String(sort);
    if (!allowedSortable.includes(field)) {
      return { ok: false, reason: 'unknown-sort', field, allowed: allowedSortable };
    }
    order = `${desc ? '-' : ''}${field}`;
  }
  if (route.paginated && !order) return { ok: false, reason: 'sort-required-for-pagination' };

  return { ok: true, filters: { ...filters }, order };
}

/* ------------------------------------------------------------------ errors */

/*
 * One envelope. `code` is machine-readable and stable; `message` is for a human
 * and may be localised. A client must never have to parse a message to decide
 * what to do.
 */
export const ERROR_CODES = {
  invalid_request: 400,
  unauthenticated: 401,
  permission_denied: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
  unavailable: 503
};

export function errorEnvelope({ code, message = null, requestId = null, details = null } = {}) {
  if (!(code in ERROR_CODES)) return { ok: false, reason: 'unknown-error-code', allowed: Object.keys(ERROR_CODES) };
  const id = requestId || correlationId();
  return {
    ok: true,
    status: ERROR_CODES[code],
    body: {
      error: {
        code,
        message: message || code.replace(/_/g, ' '),
        requestId: id,
        details: details || undefined,
        // The status is repeated in the body so a client that only logs the body
        // still records the outcome.
        status: ERROR_CODES[code]
      }
    },
    headers: { 'x-request-id': id }
  };
}

/* -------------------------------------------------- versioning & deprecation */

export const DEPRECATION_POLICY = {
  minimumNoticeDays: 180,
  note: 'A deprecated route keeps working for at least six months after the announcement, and every response says when it goes away.'
};

export function versionHeaders(route, { now = new Date() } = {}) {
  const headers = { 'x-api-version': route?.version || API_VERSION };
  if (!route?.deprecated) return headers;
  const d = route.deprecated;
  headers.deprecation = `@${new Date(d.since).getTime() / 1000}`;
  headers.sunset = new Date(d.sunset).toUTCString();
  headers.link = `<${d.replacement}>; rel="successor-version"`;
  const daysLeft = (new Date(d.sunset) - now) / 86400000;
  return {
    ...headers,
    // The client is told how long it has left, not just that it is deprecated.
    'x-sunset-in-days': String(Math.max(0, Math.floor(daysLeft))),
    note: daysLeft < DEPRECATION_POLICY.minimumNoticeDays
      ? `Under the ${DEPRECATION_POLICY.minimumNoticeDays}-day notice policy: only ${Math.floor(daysLeft)} days remain.`
      : undefined
  };
}

export function validateVersion(version) {
  if (!version) return { ok: true, version: API_VERSION };
  if (!SUPPORTED_VERSIONS.includes(version)) {
    return { ok: false, reason: 'unsupported-version', supported: SUPPORTED_VERSIONS };
  }
  return { ok: true, version };
}

/* -------------------------------------------------------------- validation */

/** Body validation against the route's declared requirements. */
export function validateRequest(route, body = {}) {
  if (!route) return { ok: false, reason: 'unknown-route' };
  const required = route.request?.required || [];
  const missing = required.filter((k) => body?.[k] === undefined || body?.[k] === null || body?.[k] === '');
  if (missing.length) return { ok: false, reason: 'missing-fields', missing };
  return { ok: true };
}

/** Idempotency for routes that declare it, refused for those that do not. */
export function idempotencyFor(route, { payload, actor = null } = {}) {
  if (!route?.idempotent) return { ok: true, required: false };
  const k = idempotencyKey({ operation: `${route.method} ${route.path}`, payload, actor });
  if (!k.ok) return { ok: false, reason: k.reason };
  return { ok: true, required: true, key: k.key, header: 'idempotency-key' };
}

/* ------------------------------------------------------------ authorization */

/*
 * A route's declared permission is the contract; the actual decision belongs to
 * rbac.authorize. This only refuses a route that declares none, which is how a
 * new endpoint ships unauthenticated by accident.
 */
export function routeAuthRequirement(route) {
  if (!route) return { ok: false, reason: 'unknown-route' };
  if (route.auth === 'required' && !route.permission) {
    return { ok: false, reason: 'missing-permission-declaration', note: 'An authenticated route must name the permission it needs.' };
  }
  return { ok: true, auth: route.auth, permission: route.permission || null };
}

/* --------------------------------------------------------------- OpenAPI */

/**
 * Generate an OpenAPI 3.1 document from the registry.
 * Generated, not hand-written, so the spec cannot describe routes that do not
 * exist or miss routes that do.
 */
export function generateOpenApi({ serverUrl = 'https://api.example.com', info = {} } = {}) {
  const paths = {};
  const securitySchemes = {
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    apiKey: { type: 'apiKey', in: 'header', name: 'apikey' }
  };

  for (const route of ROUTES) {
    const full = `/api/${route.version}${route.path}`;
    paths[full] = paths[full] || {};
    const parameters = [...String(route.path).matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1], in: 'path', required: true, schema: { type: 'string' }
    }));
    if (route.paginated) {
      parameters.push({ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: PAGE.maxLimit, default: PAGE.defaultLimit } });
      parameters.push({ name: 'cursor', in: 'query', schema: { type: 'string' } });
    }
    for (const f of route.filters || []) parameters.push({ name: f, in: 'query', schema: { type: 'string' } });
    if ((route.sortable || []).length) parameters.push({ name: 'sort', in: 'query', schema: { type: 'string', enum: [...route.sortable, ...route.sortable.map((s) => `-${s}`)] } });

    const responses = {
      200: { description: 'Success' },
      400: { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      500: { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
    };
    if (route.auth === 'required') responses[401] = { description: 'Unauthenticated' };
    if (route.permission) responses[403] = { description: 'Permission denied' };
    responses[429] = { description: 'Rate limited' };

    paths[full][route.method.toLowerCase()] = {
      operationId: `${route.method.toLowerCase()}${route.path.replace(/[/{}]/g, '_')}`,
      tags: [String(route.path).split('/')[1] || 'root'],
      parameters,
      responses,
      deprecated: route.deprecated ? true : undefined,
      security: route.auth === 'none' ? [] : [{ bearerAuth: [] }, { apiKey: [] }]
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: info.title || 'CryptoX API',
      version: info.version || API_VERSION,
      description: info.description || 'Versioned API contract generated from the route registry.'
    },
    servers: [{ url: serverUrl }],
    paths,
    components: {
      securitySchemes,
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'requestId', 'status'],
              properties: {
                code: { type: 'string', enum: Object.keys(ERROR_CODES) },
                message: { type: 'string' },
                requestId: { type: 'string' },
                status: { type: 'integer' },
                details: { type: 'object', nullable: true }
              }
            }
          }
        }
      }
    }
  };
}

/** Stop routes and OpenAPI from drifting apart. */
export function validateRegistry(routes = ROUTES) {
  const problems = [];
  const seen = new Set();
  for (const r of routes) {
    const key = `${r.method} ${r.version}${r.path}`;
    if (seen.has(key)) problems.push({ route: key, reason: 'duplicate' });
    seen.add(key);
    if (!SUPPORTED_VERSIONS.includes(r.version)) problems.push({ route: key, reason: 'unsupported-version' });
    if (r.auth === 'required' && !r.permission) problems.push({ route: key, reason: 'missing-permission' });
    if (r.paginated && !(r.sortable || []).length) problems.push({ route: key, reason: 'paginated-without-sort' });
    if (r.deprecated) {
      const days = (new Date(r.deprecated.sunset) - new Date(r.deprecated.since)) / 86400000;
      if (days < DEPRECATION_POLICY.minimumNoticeDays) {
        problems.push({ route: key, reason: 'deprecation-notice-too-short', days: Math.floor(days) });
      }
      if (!r.deprecated.replacement) problems.push({ route: key, reason: 'deprecation-without-replacement' });
    }
  }
  return { ok: problems.length === 0, problems, routes: routes.length };
}

export const apiSummary = () => ({
  version: API_VERSION,
  routes: ROUTES.length,
  paginated: ROUTES.filter((r) => r.paginated).length,
  idempotent: ROUTES.filter((r) => r.idempotent).length,
  deprecated: ROUTES.filter((r) => r.deprecated).length,
  errorCodes: Object.keys(ERROR_CODES).length
});
