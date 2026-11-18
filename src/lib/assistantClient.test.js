import { describe, it, expect, vi } from 'vitest';
import { askModel, assistantEndpoint } from './assistantClient.js';

/* The client must never turn a refusal into an answer. Every branch below is a
 * way that could happen: a 501 mistaken for success, an empty body rendered as a
 * blank model reply, or a signed-out caller shown model output that came from
 * nowhere.
 */

const clientWithSession = (token = 'jwt-123') => ({
  auth: { getSession: vi.fn(async () => ({ data: { session: token ? { access_token: token } : null } })) }
});

const respond = (status, body) => vi.fn(async () => ({ status, json: async () => body }));

describe('assistantEndpoint', () => {
  it('is derived from the project URL, not hardcoded', () => {
    expect(assistantEndpoint('https://x.supabase.co/')).toBe('https://x.supabase.co/functions/v1/ai-assistant');
    expect(assistantEndpoint('')).toBeNull();
  });
});

describe('askModel', () => {
  it('rejects an empty question before any request', async () => {
    const fetchImpl = respond(200, {});
    const res = await askModel({ message: '   ', client: clientWithSession(), endpoint: 'https://x/f', fetchImpl });
    expect(res.reason).toBe('empty-message');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports not-configured when the deployment has no endpoint', async () => {
    const res = await askModel({ message: 'hi', client: null, endpoint: null });
    expect(res).toMatchObject({ ok: false, reason: 'not-configured' });
  });

  it('requires a session and says why', async () => {
    const res = await askModel({ message: 'hi', client: clientWithSession(null), endpoint: 'https://x/f', fetchImpl: respond(200, { text: 'x' }) });
    expect(res.reason).toBe('not-signed-in');
  });

  it('sends the bearer token and exactly message + context', async () => {
    const fetchImpl = respond(200, { text: 'BTC is 60k', provider: 'anthropic', model: 'claude-sonnet' });
    const res = await askModel({
      message: 'how is btc',
      context: { coins: [{ symbol: 'BTC', price: 60000 }] },
      client: clientWithSession(),
      endpoint: 'https://x/functions/v1/ai-assistant',
      apiKey: 'pub-key',
      fetchImpl
    });

    expect(res).toMatchObject({ ok: true, source: 'model', provider: 'anthropic' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://x/functions/v1/ai-assistant');
    expect(init.headers.authorization).toBe('Bearer jwt-123');
    expect(init.headers.apikey).toBe('pub-key');
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['context', 'message']);
  });

  it('maps 501 to not-configured so the caller can fall back honestly', async () => {
    const res = await askModel({
      message: 'hi',
      client: clientWithSession(),
      endpoint: 'https://x/f',
      fetchImpl: respond(501, { error: 'ai-not-configured', note: 'no key' })
    });
    expect(res.reason).toBe('not-configured');
    expect(res.note).toBe('no key');
  });

  it.each([
    [401, 'not-signed-in'],
    [400, 'blocked'],
    [413, 'too-long'],
    [502, 'provider-error']
  ])('maps %i to %s', async (status, reason) => {
    const res = await askModel({
      message: 'hi',
      client: clientWithSession(),
      endpoint: 'https://x/f',
      fetchImpl: respond(status, { error: 'provider-error' })
    });
    expect(res.reason).toBe(reason);
  });

  it('refuses an empty or missing answer instead of rendering a blank reply', async () => {
    const empty = await askModel({ message: 'hi', client: clientWithSession(), endpoint: 'https://x/f', fetchImpl: respond(200, { text: '  ' }) });
    expect(empty.reason).toBe('empty-answer');
    const none = await askModel({ message: 'hi', client: clientWithSession(), endpoint: 'https://x/f', fetchImpl: respond(200, {}) });
    expect(none.reason).toBe('empty-answer');
  });

  it('survives a network failure', async () => {
    const res = await askModel({
      message: 'hi',
      client: clientWithSession(),
      endpoint: 'https://x/f',
      fetchImpl: vi.fn(async () => {
        throw new Error('offline');
      })
    });
    expect(res.reason).toBe('network');
  });
});
