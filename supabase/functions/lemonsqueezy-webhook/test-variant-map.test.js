import { describe, it, expect } from 'vitest';
import { testVariantMap, planForVariant, VARIANT_TO_PLAN } from './handler.js';

/* The webhook reads the SAME env JSON the checkout writes, but backwards. A
 * test purchase carries a test variant id, so without this every test event
 * would be ignored as variant-unknown and the test would prove nothing. */

const TEST_ID = '2269340';

describe('webhook: test variant mapping', () => {
  it('inverts the shared map for lookup', () => {
    const map = testVariantMap({ LEMONSQUEEZY_TEST_VARIANTS: JSON.stringify({ 'pro:monthly': TEST_ID }) });
    expect(map).toEqual({ [TEST_ID]: { planId: 'pro', cycle: 'monthly' } });
    expect(planForVariant(TEST_ID, map)).toMatchObject({ ok: true, planId: 'pro', cycle: 'monthly' });
  });

  it('does not resolve a live variant id against the test map', () => {
    const map = testVariantMap({ LEMONSQUEEZY_TEST_VARIANTS: JSON.stringify({ 'pro:monthly': TEST_ID }) });
    expect(planForVariant('2230904', map)).toMatchObject({ ok: false, reason: 'variant-unknown' });
  });

  it('returns an empty map when the variable is absent or broken', () => {
    expect(testVariantMap({})).toEqual({});
    expect(testVariantMap({ LEMONSQUEEZY_TEST_VARIANTS: 'not json' })).toEqual({});
    expect(testVariantMap({ LEMONSQUEEZY_TEST_VARIANTS: '{}' })).toEqual({});
  });

  it('ignores entries that are not a plan and a cycle', () => {
    const map = testVariantMap({ LEMONSQUEEZY_TEST_VARIANTS: JSON.stringify({ nonsense: '1', 'pro:monthly': TEST_ID }) });
    expect(map).toEqual({ [TEST_ID]: { planId: 'pro', cycle: 'monthly' } });
  });

  it('still resolves live variants from the default map', () => {
    expect(planForVariant('2230904')).toMatchObject({ ok: true, planId: 'pro', cycle: 'monthly' });
    expect(Object.keys(VARIANT_TO_PLAN)).toHaveLength(6);
  });
});
