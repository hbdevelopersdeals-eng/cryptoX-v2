/* Multi-provider AI routing with automatic failover.
 *
 * The requirement: when one free tier runs out of credits, the next one answers
 * and the user's work does not stop. That is a queue of providers with health
 * state, not a single API key — so the whole design is about what happens when a
 * provider REFUSES, because that is the only interesting case.
 *
 * FOUR KINDS OF REFUSAL, FOUR DIFFERENT RESPONSES
 *
 *   quota      (429 RESOURCE_EXHAUSTED, insufficient_quota)  → cool the provider
 *              down for an hour and move to the next one. The key is fine; the
 *              allowance is not.
 *   rate       (429 with a short retry hint)                 → 60-second cooldown.
 *              Same key, temporary.
 *   auth       (401/403 invalid key)                         → disable THAT KEY
 *              permanently. Retrying an invalid key is the one failure that never
 *              recovers, and it burns a request every time it is tried.
 *   server     (5xx, timeout, network)                       → 30-second cooldown,
 *              because the provider may be having a bad minute.
 *
 * WHY NO HARDCODED QUOTAS
 * Free-tier limits change without notice and differ per model and region. A
 * number baked into this file would be wrong within a month and would silently
 * stop the failover from firing (the router would think it still had headroom).
 * So exhaustion is DETECTED at runtime from the provider's own answer, and the
 * only local budget is the one an operator configures.
 *
 * WHERE THE KEYS LIVE
 * In the browser they are public: anyone with devtools can read them. This module
 * therefore works in two places — a Deno Edge Function (production, keys in
 * Supabase secrets) and a local dev build (keys in .env.local). `describeKeyRisk()`
 * exists so a UI can say which one it is talking to instead of implying safety.
 */

/** Providers in preference order. Cheap and fast first; heavy fallbacks last. */
export const PROVIDERS = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    model: 'gemini-2.0-flash',
    envKeys: ['GEMINI_API_KEYS', 'VITE_GEMINI_API_KEY'],
    style: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
  },
  {
    id: 'groq',
    label: 'Groq',
    model: 'llama-3.3-70b-versatile',
    envKeys: ['GROQ_API_KEYS', 'VITE_GROQ_API_KEY'],
    style: 'openai',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions'
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    model: 'llama3.1-8b',
    envKeys: ['CEREBRAS_API_KEYS', 'VITE_CEREBRAS_API_KEY'],
    style: 'openai',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions'
  },
  {
    id: 'mistral',
    label: 'Mistral',
    model: 'mistral-small-latest',
    envKeys: ['MISTRAL_API_KEYS', 'VITE_MISTRAL_API_KEY'],
    style: 'openai',
    endpoint: 'https://api.mistral.ai/v1/chat/completions'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    envKeys: ['OPENROUTER_API_KEYS', 'VITE_OPENROUTER_API_KEY'],
    style: 'openai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions'
  },
  {
    id: 'together',
    label: 'Together AI',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    envKeys: ['TOGETHER_API_KEYS', 'VITE_TOGETHER_API_KEY'],
    style: 'openai',
    endpoint: 'https://api.together.xyz/v1/chat/completions'
  }
];

export const COOLDOWNS_MS = {
  quota: 60 * 60 * 1000,
  rate: 60 * 1000,
  server: 30 * 1000,
  network: 30 * 1000,
  auth: Infinity
};

/** Keys may be given as one string, comma or newline separated, or an array. */
export function parseKeys(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[\s,;]+/);
  return [...new Set(list.map((k) => String(k).trim()).filter(Boolean))];
}

/** Collect keys per provider from an env-like object. Never logs a value. */
export function keysFromEnv(env = {}) {
  const out = {};
  for (const p of PROVIDERS) {
    const found = [];
    for (const name of p.envKeys) found.push(...parseKeys(env[name]));
    out[p.id] = [...new Set(found)];
  }
  return out;
}

export const emptyState = () => ({ providers: {}, keysDisabled: {}, calls: 0 });

const providerState = (state, id) => state.providers?.[id] || { failures: 0, cooldownUntil: 0, lastError: null };

/** True when this provider may be attempted now. */
export function isAvailable(state, providerId, now = Date.now()) {
  const s = providerState(state, providerId);
  return !(s.cooldownUntil && s.cooldownUntil > now);
}

/**
 * Classify a provider refusal.
 * Gemini wraps errors as { error: { status: 'RESOURCE_EXHAUSTED', code: 429 } };
 * OpenAI-compatible ones use { error: { code: 'insufficient_quota' } }. Both are
 * matched because a router that only understands one shape fails over for the
 * wrong reason — or not at all.
 */
export function classifyFailure({ status = 0, body = '' } = {}) {
  const text = String(body || '').toLowerCase();

  if (status === 401 || status === 403 || text.includes('api key not valid') || text.includes('invalid api key')) {
    return 'auth';
  }
  if (
    text.includes('resource_exhausted') ||
    text.includes('insufficient_quota') ||
    text.includes('quota exceeded') ||
    text.includes('exceeded your current quota') ||
    text.includes('billing') ||
    status === 402
  ) {
    return 'quota';
  }
  if (status === 429 || text.includes('rate limit') || text.includes('too many requests')) {
    return 'rate';
  }
  if (status >= 500 || status === 408 || status === 504) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/**
 * Record a refusal. Returns a NEW state; the caller owns persistence.
 * An auth failure disables that specific key so the same bad credential is never
 * tried again, while the provider itself stays eligible through its other keys.
 */
export function recordFailure(state, { providerId, keyIndex = 0, kind = 'unknown', now = Date.now(), message = '' } = {}) {
  const next = { ...state, providers: { ...(state.providers || {}) }, keysDisabled: { ...(state.keysDisabled || {}) } };
  const prev = providerState(state, providerId);
  const cooldown = COOLDOWNS_MS[kind] ?? COOLDOWNS_MS.unknown;

  next.providers[providerId] = {
    failures: (prev.failures || 0) + 1,
    lastError: { kind, message: String(message).slice(0, 240), at: new Date(now).toISOString() },
    /* Auth is a per-key fault: disable that credential and leave the provider
       available for its other keys. Everything else is a provider-level cooling. */
    cooldownUntil: kind === 'auth' ? 0 : (cooldown === Infinity ? Number.MAX_SAFE_INTEGER : now + cooldown)
  };

  if (kind === 'auth') {
    next.keysDisabled[`${providerId}:${keyIndex}`] = new Date(now).toISOString();
  }
  return next;
}

export function recordSuccess(state, providerId) {
  return {
    ...state,
    calls: (state.calls || 0) + 1,
    providers: {
      ...(state.providers || {}),
      [providerId]: { failures: 0, cooldownUntil: 0, lastError: null }
    }
  };
}

/** Providers in the order they should be tried, with usable keys only. */
export function planAttempts(state, keys, now = Date.now()) {
  const attempts = [];
  for (const p of PROVIDERS) {
    if (!isAvailable(state, p.id, now)) continue;
    const list = keys?.[p.id] || [];
    const usable = list.filter((_, i) => !state.keysDisabled?.[`${p.id}:${i}`]);
    if (!usable.length) continue;
    usable.forEach((key, i) => {
      const originalIndex = list.indexOf(key);
      attempts.push({ provider: p, key, keyIndex: originalIndex >= 0 ? originalIndex : i });
    });
  }
  return attempts;
}

/* ------------------------------------------------------------- transport */

const openAiBody = ({ messages, temperature, maxTokens }) => JSON.stringify({
  model: undefined,
  messages,
  temperature,
  max_tokens: maxTokens
});

function buildRequest(provider, key, opts) {
  const { messages, temperature = 0.4, maxTokens = 800, system } = opts;
  const withSystem = system ? [{ role: 'system', content: system }, ...messages] : messages;

  if (provider.style === 'gemini') {
    return {
      url: `${provider.endpoint.replace('{model}', provider.model)}?key=${encodeURIComponent(key)}`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: withSystem.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          generationConfig: { temperature, maxOutputTokens: maxTokens }
        })
      }
    };
  }

  const body = JSON.parse(openAiBody({ messages: withSystem, temperature, maxTokens }));
  body.model = provider.model;
  return {
    url: provider.endpoint,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        ...(provider.id === 'openrouter' ? { 'HTTP-Referer': 'https://cryptox.site.accio.ai', 'X-Title': 'CryptoX' } : {})
      },
      body: JSON.stringify(body)
    }
  };
}

/** Pull the text out of either response shape. */
export function extractText(provider, json) {
  if (!json) return '';
  if (provider.style === 'gemini') {
    const parts = json.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || '').join('').trim();
  }
  return String(json.choices?.[0]?.message?.content || '').trim();
}

/**
 * Ask the first provider that will answer.
 *
 * Returns `{ text, provider, model, attempts }` on success. Throws an
 * AggregateError carrying every refusal when all providers are exhausted, because
 * "AI is unavailable" without the reasons is unactionable — an operator needs to
 * know whether to top up a quota or rotate a key.
 */
export async function chat({
  messages = [],
  system,
  temperature = 0.4,
  maxTokens = 800,
  keys = {},
  state = emptyState(),
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  timeoutMs = 20000,
  onStateChange
} = {}) {
  const attempts = planAttempts(state, keys, now);
  if (!attempts.length) {
    const err = new Error('No AI provider is configured. Add at least one API key.');
    err.kind = 'unconfigured';
    throw err;
  }

  let current = state;
  const failures = [];

  for (const attempt of attempts) {
    const { provider, key, keyIndex } = attempt;
    const { url, init } = buildRequest(provider, key, { messages, system, temperature, maxTokens });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const kind = classifyFailure({ status: res.status, body });
        current = recordFailure(current, { providerId: provider.id, keyIndex, kind, now, message: body });
        onStateChange?.(current);
        failures.push({ provider: provider.id, kind, status: res.status, message: body.slice(0, 240) });
        continue;
      }

      const json = await res.json().catch(() => null);
      const text = extractText(provider, json);
      if (!text) {
        current = recordFailure(current, { providerId: provider.id, keyIndex, kind: 'server', now, message: 'empty completion' });
        onStateChange?.(current);
        failures.push({ provider: provider.id, kind: 'empty', status: res.status, message: 'empty completion' });
        continue;
      }

      current = recordSuccess(current, provider.id);
      onStateChange?.(current);
      return { text, provider: provider.id, label: provider.label, model: provider.model, attempts: failures, state: current };
    } catch (error) {
      clearTimeout(timer);
      const kind = error?.name === 'AbortError' ? 'network' : classifyFailure({ status: 0, body: String(error?.message || '') });
      current = recordFailure(current, { providerId: provider.id, keyIndex, kind, now, message: String(error?.message || error) });
      onStateChange?.(current);
      failures.push({ provider: provider.id, kind, status: 0, message: String(error?.message || error).slice(0, 240) });
    }
  }

  const aggregate = new AggregateError(
    failures.map((f) => new Error(`${f.provider}: ${f.kind}${f.status ? ` (${f.status})` : ''}`)),
    `All ${failures.length} AI attempt(s) failed.`
  );
  aggregate.failures = failures;
  aggregate.state = current;
  throw aggregate;
}

/* ---------------------------------------------------------------- reporting */

export function healthReport(state = emptyState(), keys = {}, now = Date.now()) {
  return PROVIDERS.map((p) => {
    const s = providerState(state, p.id);
    const configured = (keys[p.id] || []).length;
    const disabled = (keys[p.id] || []).filter((_, i) => state.keysDisabled?.[`${p.id}:${i}`]).length;
    const cooling = s.cooldownUntil > now ? Math.ceil((s.cooldownUntil - now) / 1000) : 0;
    return {
      id: p.id,
      label: p.label,
      model: p.model,
      configured,
      disabled,
      usable: Math.max(0, configured - disabled),
      coolingForSeconds: cooling,
      ready: configured - disabled > 0 && !cooling,
      lastError: s.lastError
    };
  });
}

/** Where the key lives determines how exposed it is. Say so; never imply safety. */
export function describeKeyRisk(mode) {
  if (mode === 'edge') {
    return {
      mode: 'edge',
      safe: true,
      message: 'Keys are held in Supabase secrets and every call is proxied by the ai-router function. Nothing reaches the browser.'
    };
  }
  return {
    mode: 'browser',
    safe: false,
    message:
      'Keys are read from this build’s environment and are visible to anyone with devtools. Fine for local development; never ship a production build with keys in VITE_ variables.'
  };
}
