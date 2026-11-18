import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  redact,
  safeUrl,
  buildReport,
  shouldSend,
  telemetryMode,
  reportError,
  getErrorLog,
  clearErrorLog,
  resetDeliveryStats,
  deliveryStats
} from './telemetry.js';

/* Error reports leave the browser, so what they carry is a privacy decision, not
 * a formatting one. A reset token lives in this app's query string; an email can
 * live in a message. These tests pin the sanitising, the delivery cap and the
 * honest "local-only" mode.
 */

describe('redact', () => {
  it('removes emails, JWTs, keys and long hex runs', () => {
    expect(redact('user a.b+c@example.co.uk failed')).toBe('user [redacted-email] failed');
    expect(redact('key sb_publishable_abcdefghijklmnop')).toBe('key [redacted-key]');
    expect(redact('token eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl')).toBe('token [redacted-jwt]');
    expect(redact('hash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('hash [redacted-hex]');
  });

  it('leaves ordinary prose alone', () => {
    expect(redact('Failed to fetch candles for BTCUSDT')).toBe('Failed to fetch candles for BTCUSDT');
    expect(redact(undefined)).toBe(undefined);
  });
});

describe('safeUrl', () => {
  it('drops query and fragment, which is where a token would be', () => {
    expect(safeUrl('https://cryptox-v2.site.accio.ai/reset-password?token=abc123#frag')).toBe(
      'https://cryptox-v2.site.accio.ai/reset-password'
    );
  });

  it('returns empty for a non-URL rather than echoing it', () => {
    expect(safeUrl('not a url')).toBe('');
    expect(safeUrl('')).toBe('');
  });
});

describe('buildReport', () => {
  it('keeps context keys at the top level, because the status page reads them', () => {
    const report = buildReport(new Error('boom'), { kind: 'feed.poll', symbol: 'BTCUSDT' }, { href: 'https://x/y?t=1' });
    expect(report.kind).toBe('feed.poll');
    expect(report.symbol).toBe('BTCUSDT');
    expect(report.url).toBe('https://x/y');
    expect(report.error.message).toBe('boom');
  });

  it('caps a stack instead of shipping a whole bundle path list', () => {
    const error = new Error('deep');
    error.stack = 'x'.repeat(5000);
    const report = buildReport(error, {});
    expect(report.error.stack.length).toBeLessThanOrEqual(2000);
  });

  it('redacts a secret that reached the message', () => {
    const report = buildReport(new Error('bad key sb_publishable_abcdefghijklmnop'), {});
    expect(report.error.message).not.toContain('sb_publishable_');
  });
});

describe('shouldSend', () => {
  it('collapses a repeating error inside the window', () => {
    const state = { count: 0, fingerprints: new Map() };
    const entry = { t: 1000, error: { name: 'TypeError', message: 'x is undefined' } };
    expect(shouldSend(entry, state)).toBe(true);
    expect(shouldSend({ ...entry, t: 1500 }, state)).toBe(false);
    expect(shouldSend({ ...entry, t: 40_000 }, state)).toBe(true);
  });

  it('stops at the session cap', () => {
    const state = { count: 0, fingerprints: new Map() };
    for (let i = 0; i < 25; i += 1) {
      shouldSend({ t: i * 60_000, error: { name: 'E', message: `m${i}` } }, state);
    }
    expect(state.count).toBe(20);
  });
});

describe('telemetryMode', () => {
  it('is local-only when no collector is configured, and says so', () => {
    const mode = telemetryMode('');
    expect(mode.mode).toBe('local-only');
    expect(mode.note).toMatch(/only in this tab/i);
  });

  it('refuses a non-https collector instead of downgrading', () => {
    expect(telemetryMode('http://collector.example').mode).toBe('refused');
    expect(telemetryMode('https://collector.example/errors').mode).toBe('remote');
  });
});

describe('reportError', () => {
  beforeEach(() => {
    clearErrorLog();
    resetDeliveryStats();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearErrorLog();
    resetDeliveryStats();
  });

  it('buffers locally and never throws on a weird value', () => {
    expect(() => reportError({ odd: true }, { kind: 'test' })).not.toThrow();
    const log = getErrorLog();
    expect(log).toHaveLength(1);
    expect(log[0].kind).toBe('test');
    expect(deliveryStats().sent).toBe(0);
    expect(deliveryStats().endpoint).toBe('local-only');
  });

  it('keeps the buffer bounded', () => {
    for (let i = 0; i < 80; i += 1) reportError(new Error(`e${i}`), { kind: 'loop' });
    expect(getErrorLog().length).toBeLessThanOrEqual(50);
  });
});
