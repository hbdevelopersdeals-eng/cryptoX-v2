import '@testing-library/jest-dom/vitest';

// Node may expose a disabled global Storage getter that shadows jsdom storage.
// Use a deterministic in-memory Storage implementation in tests only.
class TestStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { const value = this.#data.get(String(key)); return value === undefined ? null : value; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
  clear() { this.#data.clear(); }
}
const testLocalStorage = new TestStorage();
const testSessionStorage = new TestStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testLocalStorage });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: testSessionStorage });
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: testLocalStorage });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: testSessionStorage });
}
/* ---- jsdom gaps used by the app ---- */

// ResizeObserver (charts, tables)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || RO;

// matchMedia (reduced motion queries)
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; }
  });
}

// Canvas 2D context (CandleChart) â€” no-op proxy that returns functions/plain objects
const ctxNoop = () => {
  const target = {
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    canvas: { width: 300, height: 150 }
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => {};
    }
  });
};
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function () { return ctxNoop(); };
}

// WebSocket stub so providers don't crash in tests
if (!globalThis.WebSocket) {
  globalThis.WebSocket = class {
    constructor() { this.readyState = 0; setTimeout(() => this.onopen && this.onopen(), 0); }
    send() {}
    close() {}
  };
}

// navigator.clipboard (share buttons)
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async () => {} },
    configurable: true
  });
}

// WebCrypto: jsdom often exposes crypto without subtle, so back it with Node's.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
}
if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = (arr) => {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
  };
}

// scrollTo stub for jsdom
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}

// quiet expected act() noise unless DEBUG_TESTS is set
if (!process.env.DEBUG_TESTS) {
  const origError = console.error;
  console.error = (...args) => {
    const first = String(args[0] || '');
    if (first.includes('not wrapped in act')) return;
    origError(...args);
  };
}
