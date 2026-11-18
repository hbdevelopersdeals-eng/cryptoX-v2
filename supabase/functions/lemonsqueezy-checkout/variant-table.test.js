import { describe, it, expect } from 'vitest';
import { variantFor, variantTable, VARIANTS } from './handler.js';

/* Test and live are different storefronts with different variant ids. These
 * cases pin which table is used, and — more importantly — that test mode never
 * silently borrows a live id. */

const TEST_ID = '2269340'; // the test-mode mirror's Pro Monthly variant

const testEnv = (map) => ({
  LEMONSQUEEZY_TEST_MODE: 'true',
  ...(map === undefined ? {} : { LEMONSQUEEZY_TEST_VARIANTS: JSON.stringify(map) })
});

describe('checkout: which variant table applies', () => {
  it('uses the live table when test mode is off', () => {
    expect(variantTable({})).toEqual(VARIANTS);
    expect(variantFor('pro', 'monthly', {}).id).toBe('2230904');
  });

  it('uses the test ids when test mode is on with a map', () => {
    const env = testEnv({ 'pro:monthly': TEST_ID });
    expect(variantFor('pro', 'monthly', env).id).toBe(TEST_ID);
    expect(variantTable(env).map((v) => v.plan + ':' + v.cycle)).toEqual(['pro:monthly']);
  });

  it('sells nothing in test mode without a map — never a live id', () => {
    // The failure this prevents: a "test" purchase that quietly charges a real
    // card because the live variant id was used as a fallback.
    expect(variantTable(testEnv())).toEqual([]);
    expect(variantFor('pro', 'monthly', testEnv())).toBeNull();
  });

  it('sells nothing when the map cannot be parsed', () => {
    const env = { LEMONSQUEEZY_TEST_MODE: 'true', LEMONSQUEEZY_TEST_VARIANTS: 'not json' };
    expect(variantTable(env)).toEqual([]);
    expect(variantFor('pro', 'monthly', env)).toBeNull();
  });

  it('ignores a plan the test map does not cover', () => {
    const env = testEnv({ 'pro:monthly': TEST_ID });
    expect(variantFor('enterprise', 'annual', env)).toBeNull();
  });

  it('still refuses a plan or cycle that is not sellable', () => {
    const env = testEnv({ 'pro:monthly': TEST_ID });
    expect(variantFor('free', 'monthly', env)).toBeNull();
    expect(variantFor('pro', 'weekly', env)).toBeNull();
  });
});
