/* Lightweight, dependency-free error telemetry.
 *
 * Sinks: console, an in-memory ring buffer (works with no backend), and an
 * optional HTTPS endpoint provided via VITE_ERROR_ENDPOINT. A host page can also
 * subscribe by defining window.__CX_ON_ERROR__.
 *
 * WHAT CHANGED AND WHY. The endpoint used to receive the raw entry, including
 * `location.href`. On this app that URL can carry a reset token or an email in a
 * query string, and a stack trace can carry a value the user typed. Sending that
 * to a third-party collector turns an error report into a data-protection
 * incident, so the payload is now sanitised before it leaves the browser:
 *
 *   · origin + path only, no query, no fragment
 *   · emails, long hex/base64 runs and anything shaped like a key are redacted
 *   · stacks are capped, and the payload is capped at 20 reports per session
 *   · an endpoint that is not https is refused rather than silently downgraded
 *
 * Honesty rule: with no endpoint configured the report stays local, and
 * `telemetryMode()` says so. A status page that shows "0 errors" from an empty
 * buffer must not be mistaken for "no errors anywhere".
 */

export const APP_VERSION = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_APP_VERSION) || 'dev';
export const BUILD_STAMP = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_STAMP) || 'unknown';

const MAX_BUFFER = 50;
const MAX_SENT = 20;
const MAX_STACK = 2000;
const DEDUPE_WINDOW_MS = 30_000;

const buffer = [];
const sent = { count: 0, fingerprints: new Map() };
let installed = false;

const configuredEndpoint = () => {
  const value = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ERROR_ENDPOINT;
  return typeof value === 'string' ? value.trim() : '';
};

/** Where reports go, stated plainly for the status page. */
export function telemetryMode(endpoint = configuredEndpoint()) {
  if (!endpoint) return { mode: 'local-only', endpoint: null, note: 'No collector configured: errors exist only in this tab.' };
  if (!/^https:\/\//i.test(endpoint)) return { mode: 'refused', endpoint: null, note: 'Collector URL is not https; reports stay local.' };
  return { mode: 'remote', endpoint, note: 'Errors are sent to the configured collector, sanitised.' };
}

/* ---------------------------------------------------------------------------
 * Sanitising
 * ------------------------------------------------------------------------ */

const REDACTIONS = [
  // Anything shaped like a credential.
  [/\b(sb_[a-z]+_[A-Za-z0-9_-]{10,})\b/gi, '[redacted-key]'],
  [/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, '[redacted-jwt]'],
  [/\b[a-f0-9]{32,}\b/gi, '[redacted-hex]'],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[redacted-blob]'],
  // Personal data that commonly lands in a message.
  [/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, '[redacted-email]']
];

export function redact(value) {
  if (typeof value !== 'string' || !value) return value;
  return REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

/** Origin + path. Query and fragment are dropped, not escaped: a token in a
 *  query string is the most likely secret an error report could carry. */
export function safeUrl(href = '') {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

function safeSerialize(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return redact(value.slice(0, 500));
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: redact(value.message), stack: capStack(value.stack) };
  if (depth > 2) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 8).map((v) => safeSerialize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).slice(0, 20)) out[k] = safeSerialize(value[k], depth + 1);
    return out;
  }
  return redact(String(value));
}

const capStack = (stack) => (typeof stack === 'string' ? redact(stack.slice(0, MAX_STACK)) : undefined);

/** Build the payload that may leave the browser. Pure, so it can be tested. */
export function buildReport(error, context = {}, { href = typeof location !== 'undefined' ? location.href : '', userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '' } = {}) {
  const e = error instanceof Error ? error : new Error(String(error));
  return {
    t: Date.now(),
    app: APP_VERSION,
    build: BUILD_STAMP,
    url: safeUrl(href),
    userAgent: redact(String(userAgent || '').slice(0, 200)),
    // Context keys stay at the top level: the status page renders `e.kind`, and
    // nesting them under `context` silently blanked that column.
    ...(safeSerialize(context) || {}),
    error: { name: e.name, message: redact(e.message), stack: capStack(e.stack) }
  };
}

/* ---------------------------------------------------------------------------
 * Delivery
 * ------------------------------------------------------------------------ */

function deliver(endpoint, payload) {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      return true;
    }
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    return true;
  } catch {
    /* telemetry must never throw */
    return false;
  }
}

/**
 * Should this report be sent? Caps volume and collapses a repeating error, so a
 * render loop cannot turn one bug into ten thousand requests (or one bill).
 */
export function shouldSend(entry, state = sent) {
  if (state.count >= MAX_SENT) return false;
  const fingerprint = `${entry.error?.name || ''}:${entry.error?.message || ''}`;
  const last = state.fingerprints.get(fingerprint);
  // `undefined` means first sighting, which always goes out. Comparing against a
  // 0 default would swallow a report whose clock is near zero.
  if (last !== undefined && entry.t - last < DEDUPE_WINDOW_MS) return false;
  state.fingerprints.set(fingerprint, entry.t);
  state.count += 1;
  return true;
}

/** Counters for the status page, and for tests that must not leak state. */
export function deliveryStats() {
  return { sent: sent.count, cap: MAX_SENT, endpoint: telemetryMode().mode };
}

export function resetDeliveryStats() {
  sent.count = 0;
  sent.fingerprints.clear();
}

export function getErrorLog() {
  return [...buffer];
}

export function clearErrorLog() {
  buffer.length = 0;
}

export function reportError(error, context = {}) {
  const entry = buildReport(error, context);
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  try {
    // eslint-disable-next-line no-console
    console.error('[CryptoX]', entry.error.message, context);
  } catch { /* noop */ }

  try {
    if (typeof window !== 'undefined' && typeof window.__CX_ON_ERROR__ === 'function') {
      window.__CX_ON_ERROR__(entry);
    }
  } catch { /* noop */ }

  const { mode, endpoint } = telemetryMode();
  if (mode === 'remote' && shouldSend(entry)) deliver(endpoint, entry);

  return entry;
}

export function initTelemetry() {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  const onError = (ev) => reportError(ev.error || ev.message, { kind: 'window.error', source: ev.filename, line: ev.lineno });
  const onRejection = (ev) => reportError(ev.reason, { kind: 'unhandledrejection' });
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
