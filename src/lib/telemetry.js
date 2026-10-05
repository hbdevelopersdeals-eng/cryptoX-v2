/* Lightweight, dependency-free error telemetry.
 * Sinks: console, an in-memory ring buffer (works with no backend), and an
 * optional HTTP endpoint provided via VITE_ERROR_ENDPOINT.
 * A host page can also subscribe by defining window.__CX_ON_ERROR__.
 */

export const APP_VERSION = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_APP_VERSION) || 'dev';
export const BUILD_STAMP = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_STAMP) || 'unknown';

const MAX_BUFFER = 50;
const buffer = [];
let installed = false;

export function getErrorLog() {
  return [...buffer];
}

export function clearErrorLog() {
  buffer.length = 0;
}

function safeSerialize(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (depth > 2) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 8).map((v) => safeSerialize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).slice(0, 20)) out[k] = safeSerialize(value[k], depth + 1);
    return out;
  }
  return String(value);
}

function send(endpoint, payload) {
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    /* telemetry must never throw */
  }
}

export function reportError(error, context = {}) {
  const entry = {
    t: Date.now(),
    app: APP_VERSION,
    build: BUILD_STAMP,
    url: typeof location !== 'undefined' ? location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    ...safeSerialize(context)
  };
  const e = error instanceof Error ? error : new Error(String(error));
  entry.error = { name: e.name, message: e.message, stack: e.stack };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  try {
    // eslint-disable-next-line no-console
    console.error('[CryptoX]', e.message, context);
  } catch { /* noop */ }

  try {
    if (typeof window !== 'undefined' && typeof window.__CX_ON_ERROR__ === 'function') {
      window.__CX_ON_ERROR__(entry);
    }
  } catch { /* noop */ }

  const endpoint = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ERROR_ENDPOINT;
  if (endpoint) send(endpoint, entry);
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
