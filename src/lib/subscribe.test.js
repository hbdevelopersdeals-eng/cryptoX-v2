import { describe, it, expect, vi } from 'vitest';

/* supabase.js reports `supabaseConfigured === false` under MODE=test so nothing
 * in the suite touches the network. That is the right default for the app, but
 * it would short-circuit every path below into 'not-configured' and make these
 * tests assert nothing. Mock the module so the configured branch is reachable,
 * and pass the client explicitly in each test.
 *
 * The attribution gate is NOT mocked: it is exercised through its injectable
 * `attributionReady`, and one test proves the real default still gates. */
vi.mock('./supabase.js', () => ({
  supabaseConfigured: true,
  supabase: null,
  requireSupabase: () => { throw new Error('not used in these tests'); },
  TABLES: {}
}));

const { CHECKOUT_FUNCTION, checkoutEndpoint, startCheckout, beginCheckout } = await import('./subscribe.js');
const { ATTRIBUTION_READY } = await import('./checkout.js');

const ENDPOINT = 'https://bvyiqinyakxlefaeomoj.supabase.co/functions/v1/lemonsqueezy-checkout';

/** A signed-in Supabase-shaped client. */
const clientWith = (token = 'jwt-token') => ({ auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } });

const okResponse = (body = { url: 'https://hbstore.lemonsqueezy.com/checkout/custom/abc', plan: 'pro', cycle: 'monthly', amount: 9.99 }) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { status: 200, json: async () => body };
  };
  return { fetchImpl, calls };
};

const errResponse = (status, body = { error: 'provider-rejected' }) => async () => ({ status, json: async () => body });

/** Every test runs the real path with the gate open and a valid client. */
const base = (over = {}) => ({
  plan: 'pro', cycle: 'monthly', client: clientWith(), endpoint: ENDPOINT,
  apiKey: 'public-anon-key', fetchImpl: okResponse().fetchImpl, attributionReady: true, ...over
});

const start = (over = {}) => startCheckout(base(over));

describe('subscribe: the gate', () => {
  it('refuses with NO request while attribution is not ready', async () => {
    const { fetchImpl, calls } = okResponse();
    // The real default is used here: no attributionReady override.
    const res = await startCheckout({ plan: 'pro', cycle: 'monthly', client: clientWith(), endpoint: ENDPOINT, fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'attribution-not-ready' });
    expect(calls).toEqual([]);
  });

  it('refuses when the gate is explicitly closed, even with everything else valid', async () => {
    const { fetchImpl, calls } = okResponse();
    const res = await startCheckout(base({ attributionReady: false, fetchImpl }));
    expect(res).toMatchObject({ ok: false, reason: 'attribution-not-ready' });
    expect(calls).toEqual([]);
  });

  it('documents the production value of the real gate', () => {
    // Not an assertion of policy but of shape: flipping ATTRIBUTION_READY in
    // checkout.js is the single line that enables checkout.
    expect(typeof ATTRIBUTION_READY).toBe('boolean');
  });
});

describe('subscribe: the endpoint is derived, not hardcoded', () => {
  it('builds the function URL from the project URL, ignoring a trailing slash', () => {
    expect(checkoutEndpoint('https://bvyiqinyakxlefaeomoj.supabase.co')).toBe(ENDPOINT);
    expect(checkoutEndpoint('https://bvyiqinyakxlefaeomoj.supabase.co/')).toBe(ENDPOINT);
  });

  it('returns null rather than a broken URL when unconfigured', () => {
    expect(checkoutEndpoint('')).toBeNull();
    expect(checkoutEndpoint(null)).toBeNull();
  });

  it('names the function the deployed Edge Function actually uses', () => {
    expect(CHECKOUT_FUNCTION).toBe('lemonsqueezy-checkout');
    expect(checkoutEndpoint('https://x.supabase.co').endsWith(`/functions/v1/${CHECKOUT_FUNCTION}`)).toBe(true);
  });
});

describe('subscribe: the request body carries a plan and a cycle only', () => {
  it('sends exactly the two keys the server reads', async () => {
    const { fetchImpl, calls } = okResponse();
    await startCheckout(base({ plan: 'business', cycle: 'annual', fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].body).sort()).toEqual(['cycle', 'plan']);
    expect(calls[0].body).toEqual({ plan: 'business', cycle: 'annual' });
  });

  it('never sends a user id, variant id, price or nonce', async () => {
    const { fetchImpl, calls } = okResponse();
    await startCheckout(base({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0].body)).not.toMatch(/user|variant|amount|price|nonce/i);
  });

  it('posts to the endpoint it was given', async () => {
    const { fetchImpl, calls } = okResponse();
    await startCheckout(base({ fetchImpl }));
    expect(calls[0].url).toBe(ENDPOINT);
    expect(calls[0].init.method).toBe('POST');
  });

  it('carries the caller token in the Authorization header, not the body', async () => {
    const { fetchImpl, calls } = okResponse();
    await startCheckout(base({ client: clientWith('tok-123'), fetchImpl }));
    expect(calls[0].init.headers.authorization).toBe('Bearer tok-123');
    expect(JSON.stringify(calls[0].body)).not.toMatch(/tok-123/);
  });

  it('refuses a plan with no sellable variant before calling anything', async () => {
    const { fetchImpl, calls } = okResponse();
    const res = await startCheckout(base({ plan: 'free', cycle: 'monthly', fetchImpl }));
    expect(res).toMatchObject({ ok: false, reason: 'no-variant-mapped' });
    expect(calls).toEqual([]);
  });

  it('refuses a cycle with no sellable variant', async () => {
    const { fetchImpl, calls } = okResponse();
    const res = await startCheckout(base({ plan: 'pro', cycle: 'weekly', fetchImpl }));
    expect(res).toMatchObject({ ok: false, reason: 'no-variant-mapped' });
    expect(calls).toEqual([]);
  });
});

describe('subscribe: every failure returns no URL', () => {
  const cases = [
    ['no session', { client: clientWith(null) }, 'not-signed-in'],
    ['no client', { client: null }, 'not-configured'],
    ['no endpoint', { endpoint: null }, 'not-configured'],
    ['401 from the gateway', { fetchImpl: errResponse(401, { code: 'UNAUTHORIZED_NO_AUTH_HEADER' }) }, 'not-signed-in'],
    ['403', { fetchImpl: errResponse(403, {}) }, 'not-signed-in'],
    ['503 not configured', { fetchImpl: errResponse(503, { error: 'not-configured', missing: ['LEMONSQUEEZY_API_KEY'] }) }, 'not-configured'],
    ['provider rejected', { fetchImpl: errResponse(502, { error: 'provider-rejected' }) }, 'provider-rejected'],
    ['provider unreachable', { fetchImpl: errResponse(502, { error: 'provider-unreachable' }) }, 'provider-unreachable']
  ];

  for (const [label, over, reason] of cases) {
    it(`${label} -> ${reason}, and never a url`, async () => {
      const res = await start(over);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(reason);
      expect(res.url).toBeUndefined();
    });
  }

  it('a session lookup that throws is reported, not swallowed', async () => {
    const client = { auth: { getSession: async () => { throw new Error('storage blocked'); } } };
    expect(await start({ client })).toMatchObject({ ok: false, reason: 'session-unavailable' });
  });

  it('a network throw is reported, not swallowed', async () => {
    const res = await start({ fetchImpl: async () => { throw new Error('offline'); } });
    expect(res).toMatchObject({ ok: false, reason: 'network' });
  });

  it('a non-https url from the server is refused', async () => {
    const res = await start({ fetchImpl: okResponse({ url: 'http://evil.example/steal' }).fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-checkout-url' });
    expect(res.url).toBeUndefined();
  });

  it('a javascript: url from the server is refused', async () => {
    const res = await start({ fetchImpl: okResponse({ url: 'javascript:alert(1)' }).fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-checkout-url' });
  });

  it('a response with no url at all is refused', async () => {
    expect(await start({ fetchImpl: okResponse({ ok: true }).fetchImpl })).toMatchObject({ ok: false, reason: 'invalid-checkout-url' });
  });

  it('a non-JSON body is refused rather than throwing', async () => {
    const res = await start({ fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('not json'); } }) });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-checkout-url' });
  });

  it('the server error code is surfaced as the reason', async () => {
    const res = await start({ fetchImpl: errResponse(400, { error: 'invalid-plan' }) });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-plan', status: 400 });
  });
});

describe('subscribe: navigation is separate from the URL', () => {
  it('reports opened=false and keeps the url when navigation fails', async () => {
    const res = await beginCheckout(base({ navigate: () => { throw new Error('popup blocked'); } }));
    expect(res.ok).toBe(true);
    expect(res.opened).toBe(false);
    expect(res.reason).toBe('navigation-failed');
    expect(res.url).toBe('https://hbstore.lemonsqueezy.com/checkout/custom/abc');
  });

  it('navigates to the returned url exactly once', async () => {
    const navigate = vi.fn();
    const res = await beginCheckout(base({ navigate }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('https://hbstore.lemonsqueezy.com/checkout/custom/abc');
    expect(res.opened).toBe(true);
  });

  it('does not navigate on a failure', async () => {
    const navigate = vi.fn();
    const res = await beginCheckout(base({ client: clientWith(null), navigate }));
    expect(navigate).not.toHaveBeenCalled();
    expect(res.opened).toBe(false);
  });

  it('does not navigate while the gate is closed', async () => {
    const navigate = vi.fn();
    const res = await beginCheckout(base({ attributionReady: false, navigate }));
    expect(navigate).not.toHaveBeenCalled();
    expect(res.opened).toBe(false);
  });
});

describe('subscribe: a return from checkout grants nothing', () => {
  it('never returns an entitlement or a grant', async () => {
    const res = await start();
    expect(Object.keys(res)).not.toContain('isPaid');
    expect(Object.keys(res)).not.toContain('entitlements');
    expect(res).not.toHaveProperty('granted', true);
    expect(res).toMatchObject({ ok: true, url: expect.stringContaining('https://') });
  });

  it('the success result exposes only the url, plan, cycle and amount', async () => {
    const res = await start();
    expect(Object.keys(res).sort()).toEqual(['amount', 'cycle', 'ok', 'plan', 'url']);
  });
});
