import { describe, it, expect } from 'vitest';
import {
  REQUIRED_SECRETS, STORE_ID, PRODUCT_ID, SELLABLE_PLANS, CYCLES, NONCE_TTL_MS, VARIANTS,
  checkSecrets, readIntent, variantFor, mintNonce, nonceExpiry,
  buildProviderRequest, readProviderResponse, handleRequest
} from './handler.js';
import { VARIANTS as APP_VARIANTS, variantFor as appVariantFor } from '../../../src/lib/checkout.js';
import { VARIANT_TO_PLAN as WEBHOOK_MAP } from '../lemonsqueezy-webhook/handler.js';

/* Checkout creation. The cases that matter are the ones an attacker produces:
 * a body that names another user, a body that names a variant, a body that
 * names a price. The server may read none of them. */

const env = { LEMONSQUEEZY_API_KEY: 'ls_test_key_not_real' };

/** A store that records the nonce rows it is asked to write. */
function makeStore() {
  const calls = { nonces: [] };
  return {
    calls,
    async saveNonce(row) { calls.nonces.push(row); }
  };
}

/** A fetch stand-in returning a well-formed Lemon Squeezy checkout response. */
function okFetch(status = 201, url = 'https://hbstore.lemonsqueezy.com/checkout/custom/abc123') {
  const calls = { requests: [] };
  const fetchImpl = async (input, init) => {
    calls.requests.push({ url: input, init, body: JSON.parse(init.body) });
    return { status, json: async () => ({ data: { id: 'co_1', attributes: { url } } }) };
  };
  return { fetchImpl, calls };
}

const failingFetch = (status = 401) => async () => ({ status, json: async () => ({ errors: [{ detail: 'bad key' }] }) });
const throwingFetch = () => async () => { throw new Error('network down'); };

const run = (over = {}) => handleRequest({
  method: 'POST', body: { plan: 'pro', cycle: 'monthly' }, userId: 'user-1',
  env, store: makeStore(), fetchImpl: okFetch().fetchImpl, ...over
});

describe('checkout: fails closed without an API key', () => {
  it('names the secret it requires', () => {
    expect(REQUIRED_SECRETS).toEqual(['LEMONSQUEEZY_API_KEY']);
    expect(checkSecrets({})).toEqual({ ok: false, missing: ['LEMONSQUEEZY_API_KEY'] });
    expect(checkSecrets({ LEMONSQUEEZY_API_KEY: '  ' }).ok).toBe(false);
    expect(checkSecrets(env).ok).toBe(true);
  });

  it('refuses with 503 and writes NO nonce and calls NO provider', async () => {
    const store = makeStore();
    const { fetchImpl, calls } = okFetch();
    const res = await run({ env: {}, store, fetchImpl });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'not-configured' });
    // A nonce written without a key would be an orphan; a provider call would
    // be an unauthenticated request.
    expect(store.calls.nonces).toEqual([]);
    expect(calls.requests).toEqual([]);
  });
});

describe('checkout: the caller must be authenticated', () => {
  it('refuses with 401 when there is no verified user', async () => {
    const store = makeStore();
    const res = await run({ userId: null, store });
    expect(res.status).toBe(401);
    expect(store.calls.nonces).toEqual([]);
  });

  it('refuses an empty-string user id', async () => {
    expect((await run({ userId: '' })).status).toBe(401);
  });

  it('refuses an unauthenticated caller with 401 even when the service is unconfigured', async () => {
    // Auth is checked before configuration on purpose: answering an anonymous
    // caller with which secrets are missing would make this endpoint a
    // configuration oracle, and the publishable key needed to reach it is
    // public. Behave identically whatever our own state is.
    const store = makeStore();
    const res = await run({ userId: null, env: {}, store });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthenticated' });
    expect(JSON.stringify(res.body)).not.toMatch(/LEMONSQUEEZY_API_KEY|missing/);
    expect(store.calls.nonces).toEqual([]);
  });
});

describe('checkout: the request body can choose nothing but a plan and a cycle', () => {
  it('accepts each of the six sellable plan and cycle pairs', () => {
    for (const v of VARIANTS) {
      const read = readIntent({ plan: v.plan, cycle: v.cycle });
      expect(read.ok, `${v.plan}:${v.cycle}`).toBe(true);
      expect(read.variant.id).toBe(v.id);
    }
  });

  it('IGNORES a user id, a variant id, a price or a nonce in the body', async () => {
    const store = makeStore();
    const { fetchImpl, calls } = okFetch();
    const res = await handleRequest({
      method: 'POST', userId: 'user-1', env, store, fetchImpl,
      body: {
        plan: 'pro', cycle: 'monthly',
        // Every one of these is an attempt to choose something the server owns.
        userId: 'someone-else', user_id: 'someone-else', variantId: '2230943',
        amount: 0.01, price: 0.01, nonce: 'chosen-by-caller',
        relationships: { variant: { data: { id: '2230943' } } }
      }
    });
    expect(res.status).toBe(200);
    // The variant is the pro one, not the enterprise one the body asked for.
    expect(calls.requests[0].body.data.relationships.variant.data.id).toBe('2230904');
    expect(store.calls.nonces[0].user_id).toBe('user-1');
    expect(store.calls.nonces[0].nonce).not.toBe('chosen-by-caller');
    // No amount is ever sent to the provider: the variant IS the price.
    expect(JSON.stringify(calls.requests[0].body)).not.toMatch(/amount|"price"/);
  });

  it('rejects a plan that is not sellable, including free', () => {
    expect(readIntent({ plan: 'free', cycle: 'monthly' })).toMatchObject({ ok: false, reason: 'invalid-plan' });
    expect(readIntent({ plan: 'gold', cycle: 'monthly' }).ok).toBe(false);
    expect(readIntent({ plan: '', cycle: 'monthly' }).ok).toBe(false);
    expect(readIntent({ plan: 42, cycle: 'monthly' }).ok).toBe(false);
  });

  it('rejects a bad cycle and a missing or malformed body', () => {
    expect(readIntent({ plan: 'pro', cycle: 'weekly' }).reason).toBe('invalid-cycle');
    expect(readIntent({ plan: 'pro' }).reason).toBe('invalid-cycle');
    expect(readIntent('not json').reason).toBe('invalid-json');
    expect(readIntent(null).reason).toBe('invalid-body');
    expect(readIntent([{ plan: 'pro', cycle: 'monthly' }]).reason).toBe('invalid-body');
  });

  it('lists exactly the sellable plans, with free absent', () => {
    expect(SELLABLE_PLANS).toEqual(['pro', 'business', 'enterprise']);
    expect(SELLABLE_PLANS).not.toContain('free');
    expect(CYCLES).toEqual(['monthly', 'annual']);
  });

  it('refuses a method other than POST', async () => {
    expect((await run({ method: 'GET' })).status).toBe(405);
    expect((await run({ method: 'OPTIONS' })).status).toBe(204);
  });
});

describe('checkout: the nonce is the attribution key', () => {
  it('mints an unguessable, unique nonce', () => {
    const a = mintNonce();
    const b = mintNonce();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
    const many = new Set(Array.from({ length: 200 }, mintNonce));
    expect(many.size).toBe(200);
  });

  it('binds the nonce to the user, plan, cycle and variant', async () => {
    const store = makeStore();
    await run({ store, body: { plan: 'enterprise', cycle: 'annual' } });
    expect(store.calls.nonces[0]).toMatchObject({
      user_id: 'user-1', plan_id: 'enterprise', billing_cycle: 'annual', variant_id: '2230943'
    });
  });

  it('stores the nonce BEFORE asking the provider for a URL', async () => {
    // A live checkout whose purchase resolves to nobody is worse than a failure.
    const order = [];
    const store = { async saveNonce() { order.push('nonce'); } };
    const fetchImpl = async () => { order.push('provider'); return { status: 201, json: async () => ({ data: { attributes: { url: 'https://x.lemonsqueezy.com/c' } } }) }; };
    await run({ store, fetchImpl });
    expect(order).toEqual(['nonce', 'provider']);
  });

  it('expires the nonce, and not immediately', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const exp = nonceExpiry(now);
    expect(exp.toISOString()).toBe('2026-10-10T02:00:00.000Z');
    expect(NONCE_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('does not echo the nonce back to the caller', async () => {
    const res = await run();
    expect(JSON.stringify(res.body)).not.toMatch(/"nonce"/);
  });
});

describe('checkout: the provider request is built by the server', () => {
  it('targets the configured store and the mapped variant', () => {
    const built = buildProviderRequest({ variant: variantFor('business', 'annual'), nonce: 'n' });
    expect(built.data.type).toBe('checkouts');
    expect(built.data.relationships.store.data).toEqual({ type: 'stores', id: STORE_ID });
    expect(built.data.relationships.variant.data).toEqual({ type: 'variants', id: '2230940' });
  });

  it('carries the nonce and only the nonce as custom data', () => {
    const built = buildProviderRequest({ variant: variantFor('pro', 'monthly'), nonce: 'n1' });
    expect(built.data.attributes.checkout_data.custom).toEqual({ nonce: 'n1' });
    // No identity in custom data: the webhook resolves the nonce instead.
    expect(Object.keys(built.data.attributes.checkout_data.custom)).toEqual(['nonce']);
  });

  it('takes the redirect target from configuration, never from the caller', () => {
    const without = buildProviderRequest({ variant: variantFor('pro', 'monthly'), nonce: 'n', env: {} });
    expect(without.data.attributes.product_options).toBeUndefined();
    const withUrl = buildProviderRequest({ variant: variantFor('pro', 'monthly'), nonce: 'n', env: { CHECKOUT_REDIRECT_URL: 'https://cryptox-v2.site.accio.ai/upgrade/success' } });
    expect(withUrl.data.attributes.product_options.redirect_url).toBe('https://cryptox-v2.site.accio.ai/upgrade/success');
  });

  it('has no way for a caller-supplied redirect to reach the provider request', async () => {
    const { fetchImpl, calls } = okFetch();
    await handleRequest({
      method: 'POST', userId: 'user-1', env, store: makeStore(), fetchImpl,
      body: { plan: 'pro', cycle: 'monthly', redirectUrl: 'https://evil.example/steal', redirect_url: 'https://evil.example/steal' }
    });
    expect(JSON.stringify(calls.requests[0].body)).not.toMatch(/evil\.example/);
  });

  it('sends the API key as a bearer token and never in the body', async () => {
    const { fetchImpl, calls } = okFetch();
    await run({ fetchImpl });
    expect(calls.requests[0].init.headers.authorization).toBe(`Bearer ${env.LEMONSQUEEZY_API_KEY}`);
    expect(JSON.stringify(calls.requests[0].body)).not.toMatch(/ls_test_key_not_real/);
  });
});

describe('checkout: the provider response is validated', () => {
  it('accepts only an https checkout URL', () => {
    expect(readProviderResponse(201, { data: { attributes: { url: 'https://hbstore.lemonsqueezy.com/c/1' } } }))
      .toMatchObject({ ok: true, url: 'https://hbstore.lemonsqueezy.com/c/1' });
    // A downgrade or an injection target is refused.
    expect(readProviderResponse(201, { data: { attributes: { url: 'http://evil.example/c' } } }))
      .toMatchObject({ ok: false, reason: 'provider-url-invalid' });
    expect(readProviderResponse(201, { data: { attributes: {} } }))
      .toMatchObject({ ok: false, reason: 'provider-url-invalid' });
    expect(readProviderResponse(201, null)).toMatchObject({ ok: false, reason: 'provider-url-invalid' });
  });

  it('refuses a non-2xx from the provider without echoing its body', async () => {
    const res = await run({ fetchImpl: failingFetch(401) });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'provider-rejected' });
    expect(JSON.stringify(res.body)).not.toMatch(/bad key/);
  });

  it('refuses when the provider is unreachable', async () => {
    const res = await run({ fetchImpl: throwingFetch() });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'provider-unreachable' });
  });

  it('never returns a URL on any failure path', async () => {
    for (const over of [{ env: {} }, { userId: null }, { body: { plan: 'nope', cycle: 'monthly' } }, { fetchImpl: failingFetch() }, { fetchImpl: throwingFetch() }]) {
      const res = await run(over);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body ?? {})).not.toMatch(/https:\/\//);
    }
  });

  it('returns the url, plan, cycle and the price the variant actually charges', async () => {
    const res = await run({ body: { plan: 'pro', cycle: 'monthly' } });
    expect(res.body).toMatchObject({ ok: true, plan: 'pro', cycle: 'monthly', amount: 9.99 });
    expect(res.body.url).toBe('https://hbstore.lemonsqueezy.com/checkout/custom/abc123');
  });
});

describe('checkout: the three variant maps must agree', () => {
  // Three copies of a billing map — the application's, the checkout function's
  // and the webhook's. This is the test that makes the duplication safe: if any
  // one drifts, a buyer is charged for one plan and given another.
  it('the checkout map matches the application map exactly', () => {
    const mine = VARIANTS.map((v) => ({ plan: v.plan, cycle: v.cycle, id: v.id, uuid: v.uuid, amount: v.amount })).sort((a, b) => a.id.localeCompare(b.id));
    const theirs = APP_VARIANTS.map((v) => ({ plan: v.plan, cycle: v.cycle, id: v.id, uuid: v.uuid, amount: v.amount })).sort((a, b) => a.id.localeCompare(b.id));
    expect(mine).toEqual(theirs);
  });

  it('the webhook map matches the application map exactly', () => {
    const fromWebhook = Object.entries(WEBHOOK_MAP).map(([id, m]) => ({ id, plan: m.planId, cycle: m.cycle })).sort((a, b) => a.id.localeCompare(b.id));
    const fromApp = APP_VARIANTS.map((v) => ({ id: v.id, plan: v.plan, cycle: v.cycle })).sort((a, b) => a.id.localeCompare(b.id));
    expect(fromWebhook).toEqual(fromApp);
  });

  it('resolves the same variant as the application for every plan and cycle', () => {
    for (const v of APP_VARIANTS) {
      expect(variantFor(v.plan, v.cycle).id, `${v.plan}:${v.cycle}`).toBe(appVariantFor(v.plan, v.cycle).id);
    }
  });

  it('there are exactly six variants, covering pro, business and enterprise twice', () => {
    expect(VARIANTS).toHaveLength(6);
    expect(VARIANTS.filter((v) => v.cycle === 'monthly')).toHaveLength(3);
    expect(VARIANTS.filter((v) => v.cycle === 'annual')).toHaveLength(3);
    expect([...new Set(VARIANTS.map((v) => v.id))]).toHaveLength(6);
    expect([...new Set(VARIANTS.map((v) => v.uuid))]).toHaveLength(6);
  });

  it('targets the store and product the variants belong to', () => {
    expect(STORE_ID).toBe('489130');
    expect(PRODUCT_ID).toBe('1426526');
  });
});

describe('checkout: no secret reaches the response', () => {
  it('never includes the API key in any response', async () => {
    for (const over of [{}, { env: {} }, { fetchImpl: failingFetch() }, { fetchImpl: throwingFetch() }]) {
      const res = await run(over);
      expect(JSON.stringify(res.body ?? {})).not.toMatch(/ls_test_key_not_real/);
    }
  });
});
