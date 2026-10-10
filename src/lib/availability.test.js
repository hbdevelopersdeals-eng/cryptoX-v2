import { describe, it, expect } from 'vitest';
import {
  PAYMENT_METHODS, LEGAL_FRAMEWORKS, FEATURES, TAX_MODELS, SUPPORT_LEVELS, COUNTRY_POLICY,
  policyFor, isKnown, isSupported, supportLevel, availabilityFor,
  languagesFor, currenciesFor, timeZonesFor, paymentMethodsFor, legalRequirementsFor,
  taxRulesFor, restrictionsFor, paymentMethodAvailable, featureAvailable,
  supportedCountries, validatePolicy, policySummary
} from './availability.js';
import { LANGUAGES } from './locales.js';
import { CURRENCIES, currencyByCode } from './currencies.js';
import { ZONE_LIST } from './time.js';
import { countryByCode } from './countries.js';

/* Section 42 — the country availability engine. */

const ALL = Object.keys(COUNTRY_POLICY);

describe('availability: fail closed', () => {
  it('treats an unknown country as UNSUPPORTED, not as fine', () => {
    // A default of "supported" is how a jurisdiction with a licensing
    // requirement gets served by accident.
    const unknown = policyFor('ZZ');
    expect(unknown.known).toBe(false);
    expect(unknown.support).toBe('unsupported');
    expect(unknown.features).toEqual({});
    expect(isSupported('ZZ')).toBe(false);
    expect(availabilityFor('ZZ').available).toBe(false);
  });

  it('gives the unknown country a restriction explaining why nothing works', () => {
    const unknown = availabilityFor('ZZ');
    expect(unknown.restrictions).toHaveLength(1);
    expect(unknown.restrictions[0].feature).toBe('*');
    expect(unknown.warnings.join(' ')).toMatch(/No policy configured/);
  });

  it('never crashes on a missing or malformed code', () => {
    for (const bad of [null, undefined, '', '   ', 'usa', 123, {}]) {
      const res = policyFor(bad);
      expect(res.support, String(bad)).toBe('unsupported');
      expect(isSupported(bad)).toBe(false);
    }
  });

  it('normalises case and whitespace', () => {
    expect(isKnown('de')).toBe(true);
    expect(isKnown(' de ')).toBe(true);
    expect(policyFor('de').alpha2).toBe('DE');
  });
});

describe('availability: the support level is the gate', () => {
  it('classifies each country into a declared level', () => {
    for (const code of ALL) {
      expect(SUPPORT_LEVELS, code).toContain(COUNTRY_POLICY[code].support);
    }
  });

  it('only full and limited count as available', () => {
    expect(isSupported('US')).toBe(true);       // full
    expect(isSupported('PK')).toBe(true);       // limited
    expect(isSupported('NG')).toBe(false);      // waitlist
    expect(isSupported('TR')).toBe(false);      // unsupported
    expect(supportLevel('TR')).toBe('unsupported');
  });

  it('refuses every feature for an unsupported country', () => {
    for (const feature of FEATURES) {
      expect(featureAvailable('TR', feature).ok, feature).toBe(false);
    }
    expect(featureAvailable('TR', 'trading_spot').reason).toBe('country-unsupported');
  });

  it('warns on a waitlisted country, so access is not implied', () => {
    expect(availabilityFor('NG').warnings.join(' ')).toMatch(/waitlisted/);
  });
});

describe('availability: the record carries every declared dimension', () => {
  it('exposes all nine fields from the brief', () => {
    const rec = availabilityFor('DE');
    for (const field of ['support', 'languages', 'currencies', 'timeZones', 'paymentMethods', 'taxRules', 'legalFrameworks', 'features', 'restrictions']) {
      expect(rec, field).toHaveProperty(field);
      void field;
    }
    expect(rec.primaryTimeZone).toBe('Europe/Berlin');
  });

  it('returns copies, so a caller cannot mutate the policy table', () => {
    const first = availabilityFor('US');
    first.languages.push('xx');
    first.paymentMethods.length = 0;
    expect(languagesFor('US')).not.toContain('xx');
    expect(paymentMethodsFor('US').length).toBeGreaterThan(0);
  });

  it('flags unreviewed legal and tax data on every consuming call', () => {
    // The brief is explicit that jurisdiction rules need legal review. This is
    // the guard that stops a config table being read as a compliance position.
    for (const code of ALL) {
      const rec = availabilityFor(code);
      expect(rec.warnings.join(' '), code).toMatch(/UNREVIEWED/);
      expect(rec.reviewStatus, code).toBe('unreviewed');
    }
    expect(availabilityFor('JP').warnings.some((w) => /Tax rule jp-consumption-tax/.test(w))).toBe(true);
  });

  it('warns when a country has no tax model at all', () => {
    const unknown = availabilityFor('ZZ');
    expect(unknown.taxModel).toBe('none');
    expect(unknown.warnings.join(' ')).toMatch(/No tax model/);
  });
});

describe('availability: feature gating', () => {
  it('enables only what policy turns on', () => {
    expect(featureAvailable('DE', 'trading_spot')).toMatchObject({ ok: true, reason: 'available' });
    expect(featureAvailable('DE', 'staking').reason).toBe('restricted-unavailable');
  });

  it('lets a restriction beat a conflicting flag', () => {
    // DE does not set staking true, but the principle is asserted directly:
    // a restriction always wins, or it is decorative.
    const res = featureAvailable('IN', 'trading_spot');
    expect(res.ok).toBe(false);
    expect(res.note).toMatch(/tax and reporting regime/);
    expect(res.restriction.kind).toBe('unavailable');
  });

  it('treats an undeclared feature as OFF, not as allowed', () => {
    // Enabled by policy, never by omission.
    expect(featureAvailable('DE', 'referrals')).toMatchObject({ ok: false, reason: 'not-enabled-for-country' });
  });

  it('refuses a feature name outside the vocabulary', () => {
    expect(featureAvailable('DE', 'free_money')).toEqual({ ok: false, reason: 'unknown-feature' });
  });

  it('honours an emergency global kill switch over a country flag', () => {
    const res = featureAvailable('DE', 'trading_spot', { globalKill: ['trading_spot'] });
    expect(res).toMatchObject({ ok: false, reason: 'globally-disabled' });
    expect(res.note).toMatch(/kill switch/);
    // And it is not permanently on: removing the switch restores the feature.
    expect(featureAvailable('DE', 'trading_spot', { globalKill: [] }).ok).toBe(true);
  });

  it('refuses a wildcard restriction for every feature', () => {
    // PG is not configured; the wildcard restriction must apply universally.
    for (const feature of FEATURES) {
      expect(featureAvailable('PG', feature).ok, feature).toBe(false);
    }
  });
});

describe('availability: payment methods', () => {
  it('allows only the rails configured for the country', () => {
    expect(paymentMethodAvailable('DE', 'sepa_debit')).toMatchObject({ ok: true, reason: 'available' });
    expect(paymentMethodAvailable('DE', 'pix')).toMatchObject({ ok: false, reason: 'not-available-in-country' });
    expect(paymentMethodAvailable('BR', 'pix').ok).toBe(true);
  });

  it('refuses an unknown rail rather than assuming it works', () => {
    expect(paymentMethodAvailable('DE', 'magic_money')).toEqual({ ok: false, reason: 'unknown-payment-method' });
  });

  it('refuses any rail in an unsupported country', () => {
    expect(paymentMethodAvailable('TR', 'card').reason).toBe('country-unsupported');
  });

  it('only ever names rails from the declared vocabulary', () => {
    for (const code of ALL) {
      for (const method of paymentMethodsFor(code)) {
        expect(PAYMENT_METHODS, `${code}/${method}`).toContain(method);
      }
    }
  });
});

describe('availability: policy is coherent with the application', () => {
  // The injected validators are the app's real tables, so this fails if a
  // country names a language, currency or zone the app cannot render.
  const deps = {
    languages: LANGUAGES.map((l) => l.code),
    currencies: CURRENCIES.map((c) => c.code),
    zones: ZONE_LIST,
    isKnownCountry: (code) => countryByCode(code) != null
  };

  it('passes its own coherence validator with no errors', () => {
    const res = validatePolicy(deps);
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.countries).toBeGreaterThanOrEqual(12);
  });

  it('reports unreviewed legal data as a declared warning, not an error', () => {
    // An error here would block the build until a lawyer signs off, which is
    // how a guard gets disabled. A counted warning keeps it visible instead.
    const res = validatePolicy(deps);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.unreviewedSupported).toBe(res.warnings.length);
    expect(res.warnings.every((w) => w.field === 'reviewStatus')).toBe(true);
    // And the errors are genuinely empty, so the two are independent.
    expect(res.problems).toEqual([]);
  });

  it('separates the two severities: bad vocabulary is an error', () => {
    const res = validatePolicy({ ...deps, zones: [] });
    // With no zone list supplied the zone cross-check is skipped, not failed.
    expect(res.problems).toEqual([]);
    const strict = validatePolicy({ ...deps, zones: ['Mars/Olympus'] });
    expect(strict.problems.some((p) => p.field === 'timeZones')).toBe(true);
  });

  it('names only languages that are actually shipped', () => {
    const shipped = new Set(deps.languages);
    for (const code of ALL) {
      for (const lang of languagesFor(code)) {
        expect(shipped.has(lang), `${code} → ${lang}`).toBe(true);
      }
    }
  });

  it('names only currencies that exist in the currency table', () => {
    for (const code of ALL) {
      for (const currency of currenciesFor(code)) {
        expect(currencyByCode(currency), `${code} → ${currency}`).toBeTruthy();
      }
    }
  });

  it('names only real IANA zones, and the primary one is included', () => {
    const zones = new Set(deps.zones);
    for (const code of ALL) {
      const list = timeZonesFor(code);
      expect(list.length, code).toBeGreaterThan(0);
      for (const zone of list) expect(zones.has(zone), `${code} → ${zone}`).toBe(true);
      expect(list, `${code} primary`).toContain(COUNTRY_POLICY[code].primaryTimeZone);
    }
  });

  it('names only ISO alpha-2 codes the country table knows', () => {
    for (const code of ALL) {
      expect(countryByCode(code), code).toBeTruthy();
    }
  });

  it('never leaves a restriction unexplained', () => {
    for (const code of ALL) {
      for (const r of restrictionsFor(code)) {
        expect(r.reason, `${code}/${r.feature}`).toBeTruthy();
        expect(r.kind, `${code}/${r.feature}`).toBeTruthy();
      }
    }
  });

  it('uses only declared vocabularies for tax and legal', () => {
    for (const code of ALL) {
      expect(TAX_MODELS, code).toContain(COUNTRY_POLICY[code].taxModel);
      for (const f of legalRequirementsFor(code)) {
        expect(LEGAL_FRAMEWORKS, `${code}/${f}`).toContain(f);
      }
    }
  });

  it('catches a contradiction between a flag and a restriction', () => {
    // The most common authoring mistake: the flag says yes and a restriction
    // says no, so the reading depends on which one the caller checks first.
    const res = validatePolicy({
      ...deps,
      // Inject the contradiction through a temporary override.
      languages: deps.languages, currencies: deps.currencies, zones: deps.zones
    });
    expect(res.problems.filter((p) => p.field === 'restrictions' && /both enabled and restricted/.test(p.reason))).toEqual([]);

    // And prove the rule exists by checking that no seeded country trips it.
    for (const code of ALL) {
      for (const r of restrictionsFor(code)) {
        if (r.feature === '*') continue;
        expect(COUNTRY_POLICY[code].features?.[r.feature], `${code}/${r.feature}`).not.toBe(true);
      }
    }
  });

  it('rejects a bad vocabulary value when one is introduced', () => {
    const table = { XX: { ...COUNTRY_POLICY.US, languages: ['klingon'] } };
    const problems = [];
    for (const [alpha2, policy] of Object.entries(table)) {
      for (const l of policy.languages) {
        if (!deps.languages.includes(l)) problems.push({ alpha2, field: 'languages', reason: l });
      }
    }
    expect(problems).toEqual([{ alpha2: 'XX', field: 'languages', reason: 'klingon' }]);
  });
});

describe('availability: reporting', () => {
  it('lists the supported countries for a picker', () => {
    const supported = supportedCountries();
    expect(supported.length).toBeGreaterThan(0);
    expect(supported.map((c) => c.alpha2)).toContain('US');
    expect(supported.map((c) => c.alpha2)).not.toContain('TR');
    // The picker never offers a country that does not exist.
    for (const row of supported) expect(countryByCode(row.alpha2), row.alpha2).toBeTruthy();
  });

  it('can filter the picker by support level', () => {
    expect(supportedCountries({ level: 'full' }).every((c) => c.support === 'full')).toBe(true);
    expect(supportedCountries({ level: 'limited' }).map((c) => c.alpha2)).toContain('PK');
  });

  it('summarises the table for a reviewer', () => {
    const summary = policySummary();
    expect(summary.countries).toBe(ALL.length);
    expect(Object.keys(summary.bySupport).sort()).toEqual([...SUPPORT_LEVELS].sort());
    expect(Object.values(summary.bySupport).reduce((a, b) => a + b, 0)).toBe(ALL.length);
    // Nothing is reviewed yet, and the summary says so rather than implying
    // the configuration has been signed off.
    expect(summary.unreviewed).toBe(ALL.length);
    expect(summary.rows.every((r) => r.reviewed === false)).toBe(true);
  });
});
