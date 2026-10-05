// Tiny typed localStorage helpers

export function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable */
  }
}

export function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

// Simple event bus so multiple components react to storage changes in same tab
const listeners = {};
export function onStore(key, fn) {
  (listeners[key] = listeners[key] || []).push(fn);
  return () => {
    listeners[key] = (listeners[key] || []).filter((f) => f !== fn);
  };
}
export function emitStore(key) {
  (listeners[key] || []).forEach((f) => f());
}
export function setStore(key, value) {
  lsSet(key, value);
  emitStore(key);
}
export function useStoreValue(key) {
  return lsGet(key, null);
}
