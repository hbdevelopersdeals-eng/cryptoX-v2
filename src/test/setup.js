import '@testing-library/jest-dom/vitest';

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

// Canvas 2D context (CandleChart) — no-op proxy that returns functions/plain objects
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
