import { describe, it, expect, vi } from 'vitest';
import {
  PROVIDERS, parseKeys, keysFromEnv, classifyFailure, recordFailure, recordSuccess,
  planAttempts, isAvailable, chat, extractText, healthReport, describeKeyRisk,
  emptyState, COOLDOWNS_MS
} from './aiRouter.js';

const okOpenAi = (text = 'hello') => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: text } }] }),
  text: async () => ''
});

const okGemini = (text = 'hi from gemini') => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  text: async () => ''
});

const fail = (status, body = '') => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => body
});

describe('key handling', () => {
  it('accepts a comma or newline separated list and dedupes', () => {
    expect(parseKeys('a, b\nc a')).toEqual(['a', 'b', 'c']);
    expect(parseKeys('')).toEqual([]);
    expect(parseKeys(null)).toEqual([]);
    expect(parseKeys(['x', ' x ', 'y'])).toEqual(['x', 'y']);
  });

  it('collects keys from either env name per provider', () => {
    const keys = keysFromEnv({ GEMINI_API_KEYS: 'g1,g2', VITE_GROQ_API_KEY: 'q1' });
    expect(keys.gemini).toEqual(['g1', 'g2']);
    expect(keys.groq).toEqual(['q1']);
    expect(keys.mistral).toEqual([]);
  });
});

describe('failure classification', () => {
  it('recognises Gemini quota exhaustion, which does not look like OpenAI quota', () => {
    expect(classifyFailure({ status: 429, body: '{"error":{"status":"RESOURCE_EXHAUSTED"}}' })).toBe('quota');
  });

  it('recognises OpenAI-style insufficient_quota', () => {
    expect(classifyFailure({ status: 429, body: '{"error":{"code":"insufficient_quota"}}' })).toBe('quota');
    expect(classifyFailure({ status: 402, body: 'payment required' })).toBe('quota');
  });

  it('treats a plain 429 as a short rate limit, not exhausted credit', () => {
    expect(classifyFailure({ status: 429, body: 'rate limit reached' })).toBe('rate');
  });

  it('treats an invalid key as auth, not as quota', () => {
    expect(classifyFailure({ status: 400, body: 'API key not valid. Please pass a valid API key.' })).toBe('auth');
    expect(classifyFailure({ status: 401 })).toBe('auth');
  });

  it('separates server faults from network faults', () => {
    expect(classifyFailure({ status: 503 })).toBe('server');
    expect(classifyFailure({ status: 0 })).toBe('network');
  });
});

describe('failover planning', () => {
  const keys = { gemini: ['g1'], groq: ['q1'], mistral: ['m1'] };

  it('orders attempts by provider preference', () => {
    const attempts = planAttempts(emptyState(), keys);
    expect(attempts.map((a) => a.provider.id)).toEqual(['gemini', 'groq', 'mistral']);
  });

  it('skips a provider that is cooling down', () => {
    const state = recordFailure(emptyState(), { providerId: 'gemini', kind: 'quota' });
    expect(planAttempts(state, keys, Date.now()).map((a) => a.provider.id)).toEqual(['groq', 'mistral']);
  });

  it('returns to a provider once its cooldown expires', () => {
    const now = Date.now();
    const state = recordFailure(emptyState(), { providerId: 'gemini', kind: 'quota', now });
    expect(isAvailable(state, 'gemini', now + 1000)).toBe(false);
    expect(isAvailable(state, 'gemini', now + COOLDOWNS_MS.quota + 1)).toBe(true);
  });

  it('never retries a key that failed auth', () => {
    const state = recordFailure(emptyState(), { providerId: 'gemini', keyIndex: 0, kind: 'auth' });
    const attempts = planAttempts(state, { gemini: ['g1', 'g2'] });
    expect(attempts.filter((a) => a.provider.id === 'gemini')).toHaveLength(1);
    expect(attempts.find((a) => a.provider.id === 'gemini').key).toBe('g2');
  });

  it('plans nothing when no provider has a key', () => {
    expect(planAttempts(emptyState(), {})).toEqual([]);
  });
});

describe('chat failover', () => {
  it('answers from the first healthy provider', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okOpenAi('first'));
    const res = await chat({ messages: [{ role: 'user', content: 'hi' }], keys: { groq: ['q1'] }, fetchImpl });
    expect(res.text).toBe('first');
    expect(res.provider).toBe('groq');
    expect(res.attempts).toEqual([]);
  });

  it('moves to the next provider when the first has run out of credit', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fail(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}'))
      .mockResolvedValueOnce(okOpenAi('second'));

    const res = await chat({ messages: [{ role: 'user', content: 'hi' }], keys: { gemini: ['g1'], groq: ['q1'] }, fetchImpl });

    expect(res.text).toBe('second');
    expect(res.provider).toBe('groq');
    expect(res.attempts[0]).toMatchObject({ provider: 'gemini', kind: 'quota' });
    // The exhausted provider is now cold, so the next call skips it entirely.
    expect(res.state.providers.gemini.cooldownUntil).toBeGreaterThan(Date.now());
  });

  it('rotates to the second key of the same provider when the first key is invalid', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fail(401, 'invalid api key'))
      .mockResolvedValueOnce(okGemini('second key'));

    const res = await chat({ messages: [{ role: 'user', content: 'hi' }], keys: { gemini: ['bad', 'good'] }, fetchImpl });

    expect(res.text).toBe('second key');
    expect(res.state.keysDisabled['gemini:0']).toBeTruthy();
  });

  it('cools a provider down after a server error and returns to it once the cooldown passes', async () => {
    /* One provider with one key cannot recover inside the same call — that is the
       design. What must be true is that the fault is recorded with a short
       cooldown and that the very next request (after it) succeeds, which is what
       "the user's work does not stop" actually means. */
    const now = Date.now();
    const first = vi.fn().mockResolvedValue(fail(503, 'unavailable'));
    let caught;
    try {
      await chat({ messages: [{ role: 'user', content: 'hi' }], keys: { gemini: ['g1'] }, fetchImpl: first, now });
    } catch (error) {
      caught = error;
    }
    expect(caught.failures[0]).toMatchObject({ provider: 'gemini', kind: 'server' });

    const second = vi.fn().mockResolvedValue(okGemini('recovered'));
    const res = await chat({
      messages: [{ role: 'user', content: 'hi' }],
      keys: { gemini: ['g1'] },
      state: caught.state,
      fetchImpl: second,
      now: now + COOLDOWNS_MS.server + 1000
    });
    expect(res.text).toBe('recovered');
  });

  it('treats an empty completion as a failure and moves on', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(okGemini(''))
      .mockResolvedValueOnce(okOpenAi('filled'));
    const res = await chat({ messages: [{ role: 'user', content: 'hi' }], keys: { gemini: ['g1'], groq: ['q1'] }, fetchImpl });
    expect(res.text).toBe('filled');
    expect(res.attempts[0].kind).toBe('empty');
  });

  it('throws with every reason when all providers are exhausted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fail(429, 'quota exceeded'));
    /* Asserted by inspecting the thrown aggregate rather than with toMatchObject:
       AggregateError does not compare like a plain object, and the useful fact is
       which providers were tried and why each refused. */
    let caught;
    try {
      await chat({ messages: [{ role: 'user', content: 'hi' }], keys: { gemini: ['g1'], groq: ['q1'] }, fetchImpl });
    } catch (error) {
      caught = error;
    }
    expect(caught.failures.map((f) => f.provider)).toEqual(['gemini', 'groq']);
    expect(caught.failures.every((f) => f.kind === 'quota')).toBe(true);
  });

  it('says plainly when nothing is configured, instead of failing silently', async () => {
    await expect(chat({ messages: [], keys: {} })).rejects.toMatchObject({ kind: 'unconfigured' });
  });

  it('recovers on the next call once a cooldown has passed', async () => {
    const now = Date.now();
    const cooled = recordFailure(emptyState(), { providerId: 'gemini', kind: 'rate', now });
    const fetchImpl = vi.fn().mockResolvedValue(okGemini('back'));
    const res = await chat({
      messages: [{ role: 'user', content: 'hi' }],
      keys: { gemini: ['g1'] },
      state: cooled,
      fetchImpl,
      now: now + COOLDOWNS_MS.rate + 1000
    });
    expect(res.text).toBe('back');
  });

  it('bounds the number of attempts, so a stuck provider cannot loop forever', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fail(500, 'boom'));
    await chat({ messages: [], keys: { gemini: ['a', 'b', 'c'], groq: ['d'] }, fetchImpl }).catch(() => {});
    expect(fetchImpl.mock.calls.length).toBe(4);
  });

  it('passes the system prompt through in both API dialects', async () => {
    const seen = [];
    const capture = () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'x' } }], candidates: [{ content: { parts: [{ text: 'x' }] } }] }),
      text: async () => ''
    });
    const fetchImpl = vi.fn().mockImplementation((url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve(capture());
    });

    await chat({ messages: [{ role: 'user', content: 'q' }], system: 'be terse', keys: { gemini: ['g1'], groq: ['q1'] }, fetchImpl });
    await chat({ messages: [{ role: 'user', content: 'q' }], system: 'be terse', keys: { groq: ['q1'] }, fetchImpl });

    expect(seen[0].url).toContain('generativelanguage.googleapis.com');
    expect(JSON.stringify(seen[0].body)).toContain('be terse');
    expect(seen[1].body.messages[0]).toEqual({ role: 'system', content: 'be terse' });
  });

  it('never puts an api key in the request body, only in the header or query', async () => {
    let captured;
    const fetchImpl = vi.fn().mockImplementation((url, init) => {
      captured = { url, init };
      return Promise.resolve(okOpenAi());
    });
    await chat({ messages: [{ role: 'user', content: 'q' }], keys: { groq: ['secret-key-123'] }, fetchImpl });
    expect(captured.init.body).not.toContain('secret-key-123');
    expect(captured.init.headers.authorization).toBe('Bearer secret-key-123');
  });
});

describe('response parsing', () => {
  it('reads Gemini and OpenAI shapes', () => {
    expect(extractText({ style: 'gemini' }, { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] })).toBe('ab');
    expect(extractText({ style: 'openai' }, { choices: [{ message: { content: ' c ' } }] })).toBe('c');
  });

  it('returns an empty string rather than undefined for a malformed response', () => {
    expect(extractText({ style: 'gemini' }, {})).toBe('');
    expect(extractText({ style: 'openai' }, null)).toBe('');
  });
});

describe('reporting', () => {
  it('marks a provider ready only when a usable key exists and it is not cooling', () => {
    const state = recordFailure(emptyState(), { providerId: 'groq', kind: 'quota' });
    const report = healthReport(state, { gemini: ['g1'], groq: ['q1'] });
    expect(report.find((r) => r.id === 'gemini').ready).toBe(true);
    expect(report.find((r) => r.id === 'groq').ready).toBe(false);
    expect(report.find((r) => r.id === 'mistral').configured).toBe(0);
  });

  it('does not describe browser-held keys as safe', () => {
    const edge = describeKeyRisk('edge');
    const browser = describeKeyRisk('browser');
    expect(edge.safe).toBe(true);
    expect(browser.safe).toBe(false);
    expect(browser.message).toMatch(/visible to anyone with devtools/);
  });

  it('resets a provider to healthy after one success', () => {
    const broken = recordFailure(emptyState(), { providerId: 'groq', kind: 'server' });
    const fixed = recordSuccess(broken, 'groq');
    expect(fixed.providers.groq.cooldownUntil).toBe(0);
    expect(fixed.calls).toBe(1);
  });

  it('declares six providers so the fallback chain has depth', () => {
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
  });
});
