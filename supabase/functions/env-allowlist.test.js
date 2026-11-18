import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/* Both edge entrypoints build the handler's `env` from an explicit allow-list.
 * That is the right call — the function should only ever see settings it is
 * meant to use — but it means a secret can be saved in the dashboard and remain
 * completely invisible to the handler.
 *
 * That is not hypothetical: the test-mode switch was saved, the store showed
 * test mode on, and the function kept producing live checkouts because the
 * variable was never passed through. These assertions make that omission fail a
 * test instead of a payment run.
 */

const declared = (path) => {
  const src = readFileSync(path, 'utf8');
  return new Set([...src.matchAll(/Deno\.env\.get\('([A-Z0-9_]+)'\)/g)].map((m) => m[1]));
};

describe('edge entrypoints expose every setting the handler reads', () => {
  it('checkout passes the test-mode settings through', () => {
    const got = declared('supabase/functions/lemonsqueezy-checkout/index.ts');
    for (const key of [
      'LEMONSQUEEZY_API_KEY',
      'LEMONSQUEEZY_TEST_MODE',
      'LEMONSQUEEZY_TEST_API_KEY',
      'LEMONSQUEEZY_TEST_VARIANTS',
      'CHECKOUT_REDIRECT_URL',
      'DEPLOYMENT_LIVE'
    ]) {
      expect(got.has(key), `checkout index.ts must read ${key}`).toBe(true);
    }
  });

  it('webhook passes the test-mode settings through', () => {
    const got = declared('supabase/functions/lemonsqueezy-webhook/index.ts');
    for (const key of [
      'LEMONSQUEEZY_WEBHOOK_SECRET',
      'LEMONSQUEEZY_TEST_MODE',
      'LEMONSQUEEZY_TEST_VARIANTS',
      'LEMONSQUEEZY_TEST_PRODUCT_ID',
      'DEPLOYMENT_LIVE'
    ]) {
      expect(got.has(key), `webhook index.ts must read ${key}`).toBe(true);
    }
  });
});
