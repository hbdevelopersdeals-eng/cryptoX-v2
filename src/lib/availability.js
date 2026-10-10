/* Country availability engine (Section 42).
 *
 * One place that answers, for a country: is it supported, what languages does
 * it use, which currencies, which time zones, which payment methods, what tax
 * rules, what legal framework, which features, and what is restricted.
 *
 *   Country
 *    ├── supported
 *    ├── languages
 *    ├── currencies
 *    ├── timezone
 *    ├── payment_methods
 *    ├── tax_rules
 *    ├── legal_requirements
 *    ├── feature_availability
 *    └── restrictions
 *
 * HONEST SCOPE — READ THIS BEFORE TRUSTING THE DATA.
 * The ENGINE here is real and tested: fail-closed lookup, vocabulary-validated
 * values, cross-checks against the rest of the app, and a coherence validator.
 * The POLICY DATA is NOT legal advice and is NOT authoritative. Every seeded
 * entry carries `reviewStatus: 'unreviewed'`, and the brief is explicit that
 * "this area requires jurisdiction-specific legal and compliance review before
 * launch". Treating a table in a frontend bundle as a compliance position is
 * exactly the mistake this marker exists to prevent.
 *
 * FAIL CLOSED. An unknown country is UNSUPPORTED, not "probably fine". A
 * default of supported is how a jurisdiction with a licensing requirement gets
 * served by accident.
 */

/* ------------------------------------------------------------- vocabularies */

/** Payment rails the platform can recognise. Not a claim of availability. */
export const PAYMENT_METHODS = [
  'card', 'apple_pay', 'google_pay', 'sepa_debit', 'ach', 'wire',
  'ideal', 'bancontact', 'sofort', 'konbini', 'pix', 'boleto',
  'upi', 'netbanking', 'grabpay', 'paynow', 'kakao_pay',
  'bank_transfer', 'crypto_onchain', 'manual_invoice'
];

/** Legal frameworks the platform can be configured to honour. */
export const LEGAL_FRAMEWORKS = [
  'gdpr', 'uk_gdpr', 'ccpa', 'lgpd', 'pipl', 'dpa_2018', 'popia', 'pdpa_sg',
  'appi_jp', 'kvkk', 'pdpl_ae', 'dpdp_in', 'ndpa_ng', 'pipeda', 'australia_privacy',
  'eu_dac7', 'psd2', 'sca', 'mica', 'fatf_travel_rule', 'dac6'
];

/** Feature switches a country can be gated on. */
export const FEATURES = [
  'signup', 'trading_spot', 'trading_derivatives', 'margin', 'staking',
  'fiat_onramp', 'fiat_offramp', 'card_payments', 'crypto_transfers',
  'custody', 'paper_trading', 'api_access', 'marketing_email', 'sms',
  'push_notifications', 'referrals'
];

/** Tax models the engine understands. `none` is only valid WITH a reason. */
export const TAX_MODELS = ['vat', 'gst', 'sales_tax', 'consumption_tax', 'withholding', 'dst', 'none'];

export const SUPPORT_LEVELS = ['full', 'limited', 'waitlist', 'unsupported'];

/* ------------------------------------------------------------------ helpers */

const upper = (code) => String(code || '').trim().toUpperCase();

/**
 * Per-country policy.
 *
 * Every entry is a CONFIGURATION, not a determination. `reviewStatus` is
 * 'unreviewed' until a qualified reviewer signs it off, and `availabilityFor`
 * surfaces that in `warnings` so a caller cannot consume the record without
 * seeing it.
 */
export const COUNTRY_POLICY = {
  US: {
    support: 'full',
    languages: ['en', 'es'],
    currencies: ['USD'],
    timeZones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
    primaryTimeZone: 'America/New_York',
    paymentMethods: ['card', 'apple_pay', 'google_pay', 'ach', 'wire'],
    taxModel: 'sales_tax',
    taxRules: [{ id: 'us-sales-tax', kind: 'nexus', note: 'State and local nexus rules vary per state.', reviewStatus: 'unreviewed' }],
    legalFrameworks: ['ccpa'],
    features: { trading_spot: true, trading_derivatives: false, margin: false, staking: false, fiat_onramp: true, fiat_offramp: true },
    restrictions: [{ feature: 'trading_derivatives', reason: 'Requires a licensed futures commission merchant.', kind: 'unavailable' }],
    reviewStatus: 'unreviewed'
  },
  GB: {
    support: 'full',
    languages: ['en'],
    currencies: ['GBP'],
    timeZones: ['Europe/London'],
    primaryTimeZone: 'Europe/London',
    paymentMethods: ['card', 'apple_pay', 'google_pay', 'bank_transfer', 'sepa_debit'],
    taxModel: 'vat',
    taxRules: [{ id: 'uk-vat', kind: 'standard', rateBasisPoints: 2000, note: 'VAT registration threshold applies to the seller, not the buyer.', reviewStatus: 'unreviewed' }],
    legalFrameworks: ['uk_gdpr', 'dpa_2018', 'sca'],
    features: { trading_spot: true, fiat_onramp: true, fiat_offramp: true, staking: true },
    restrictions: [],
    reviewStatus: 'unreviewed'
  },
  DE: {
    support: 'full',
    languages: ['de'],
    currencies: ['EUR'],
    timeZones: ['Europe/Berlin'],
    primaryTimeZone: 'Europe/Berlin',
    paymentMethods: ['card', 'sepa_debit', 'sofort', 'apple_pay', 'google_pay', 'bank_transfer'],
    taxModel: 'vat',
    taxRules: [{ id: 'de-vat', kind: 'standard', rateBasisPoints: 1900, note: 'Reduced rate exists for some goods.', reviewStatus: 'unreviewed' }],
    legalFrameworks: ['gdpr', 'psd2', 'sca', 'mica', 'eu_dac7'],
    features: { trading_spot: true, staking: false, fiat_onramp: true, fiat_offramp: true, marketing_email: true },
    restrictions: [{ feature: 'staking', reason: 'MiCA treatment of staking services is under national implementation.', kind: 'unavailable' }],
    reviewStatus: 'unreviewed'
  },
  FR: {
    support: 'full',
    languages: ['fr'],
    currencies: ['EUR'],
    timeZones: ['Europe/Paris'],
    primaryTimeZone: 'Europe/Paris',
    paymentMethods: ['card', 'sepa_debit', 'apple_pay', 'google_pay', 'bank_transfer'],
    taxModel: 'vat',
    taxRules: [{ id: 'fr-vat', kind: 'standard', rateBasisPoints: 2000, reviewStatus: 'unreviewed' }],
    legalFrameworks: ['gdpr', 'psd2', 'sca', 'mica', 'dac6'],
    features: { trading_spot: true, fiat_onramp: true, fiat_offramp: true },
    restrictions: [],
    reviewStatus: 'unreviewed'
  },
  PK: {
    support: 'limited',
    languages: ['en', 'ur'],
    currencies: ['PKR'],
    timeZones: ['Asia/Karachi'],
    primaryTimeZone: 'Asia/Karachi',
    paymentMethods: ['card', 'bank_transfer', 'manual_invoice'],
    taxModel: 'gst',
    taxRules: [{ id: 'pk-gst', kind: 'standard', rateBasisPoints: 1700, reviewStatus: 'unreviewed' }],
    // Deliberately empty: no data-protection framework in the vocabulary covers
    // Pakistan yet, and naming a neighbouring jurisdiction's law would be a
    // fabricated compliance claim rather than an honest gap.
    legalFrameworks: [],
    features: { trading_spot: true, fiat_onramp: true, fiat_offramp: false, card_payments: true },
    restrictions: [
      { feature: 'fiat_offramp', reason: 'Local payment rails for payouts require a domestic banking partner.', kind: 'limited' },
      { feature: 'marketing_email', reason: 'Local commercial-communication consent rules require review.', kind: 'unavailable' }
    ],
    reviewStatus: 'unreviewed'
  },
  AE: {
    support: 'limited',
    languages: ['ar', 'en'],
    currencies: ['AED'],
    timeZones: ['Asia/Dubai'],
    primaryTimeZone: 'Asia/Dubai',
    paymentMethods: ['card', 'apple_pay', 'google_pay', 'wire', 'bank_transfer'],
    taxModel: 'vat',
    taxRules: [{ id: 'ae-vat', kind: 'standard', rateBasisPoints: 500, reviewStatus: 'unreviewed' }],
    legalFrameworks: ['pdpl_ae'],
    features: { trading_spot: true, custody: false, fiat_onramp: true, fiat_offramp: true },
    restrictions: [
      { feature: 'custody', reason: 'Custody activity is licensed by the local regulator.', kind: 'unavailable' }
    ],
    reviewStatus: 'unreviewed'
  },
  JP: {
    support: 'full',
    languages: ['ja'],
    currencies: ['JPY'],
    timeZones: ['Asia/Tokyo'],
    primaryTimeZone: 'Asia/Tokyo',
    paymentMethods: ['card', 'konbini', 'apple_pay', 'google_pay', 'bank_transfer'],
    taxModel: 'consumption_tax',
    taxRules: [{ id: 'jp-consumption-tax', kind: 'standard', rateBasisPoints: 1000, note: 'A reduced rate applies to some categories.', reviewStatus: 'unreviewed' }],
    legalFrameworks: ['appi_jp'],
    features: { trading_spot: true, custody: true, fiat_onramp: true, fiat_offramp: true },
    restrictions: [],
    reviewStatus: 'unreviewed'
  },
  BR: {
    support: 'full',
    languages: ['pt'],
    currencies: ['BRL'],
    timeZones: ['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco'],
    primaryTimeZone: 'America/Sao_Paulo',
    paymentMethods: ['card', 'pix', 'boleto', 'bank_transfer'],
    taxModel: 'consumption_tax',
    taxRules: [{ id: 'br-consumption', kind: 'standard', note: 'Tax reform is transitioning the model; do not hard-code a rate.', reviewStatus: 'unreviewed' }],
    legalFrameworks: ['lgpd'],
    features: { trading_spot: true, fiat_onramp: true, fiat_offramp: true, push_notifications: true },
    restrictions: [],
    reviewStatus: 'unreviewed'
  },
  IN: {
    support: 'limited',
    languages: ['en', 'hi'],
    currencies: ['INR'],
    timeZones: ['Asia/Kolkata'],
    primaryTimeZone: 'Asia/Kolkata',
    paymentMethods: ['upi', 'netbanking', 'card'],
    taxModel: 'gst',
    taxRules: [{ id: 'in-gst', kind: 'split', note: 'CGST/SGST/IGST split depends on the place of supply.', reviewStatus: 'unreviewed' }],
    legalFrameworks: ['dpdp_in'],
    features: { trading_spot: false, fiat_onramp: false, fiat_offramp: false, paper_trading: true },
    restrictions: [
      { feature: 'trading_spot', reason: 'Virtual-digital-asset activity attracts a separate tax and reporting regime.', kind: 'unavailable' },
      { feature: 'fiat_onramp', reason: 'Payment-rail access for VDA businesses requires local review.', kind: 'unavailable' }
    ],
    reviewStatus: 'unreviewed'
  },
  SG: {
    support: 'full',
    languages: ['en', 'zh-Hans', 'ms'],
    currencies: ['SGD'],
    timeZones: ['Asia/Singapore'],
    primaryTimeZone: 'Asia/Singapore',
    paymentMethods: ['card', 'paynow', 'grabpay', 'wire', 'bank_transfer'],
    taxModel: 'gst',
    taxRules: [{ id: 'sg-gst', kind: 'standard', rateBasisPoints: 900, reviewStatus: 'unreviewed' }],
    legalFrameworks: ['pdpa_sg', 'fatf_travel_rule'],
    features: { trading_spot: true, custody: true, fiat_onramp: true, fiat_offramp: true, api_access: true },
    restrictions: [],
    reviewStatus: 'unreviewed'
  },
  NG: {
    support: 'waitlist',
    languages: ['en'],
    currencies: ['NGN'],
    timeZones: ['Africa/Lagos'],
    primaryTimeZone: 'Africa/Lagos',
    paymentMethods: ['card', 'bank_transfer'],
    taxModel: 'vat',
    taxRules: [{ id: 'ng-vat', kind: 'standard', rateBasisPoints: 750, reviewStatus: 'unreviewed' }],
    // Nigeria's own Act — not South Africa's POPIA, which is a different law.
    legalFrameworks: ['ndpa_ng'],
    features: { trading_spot: false, paper_trading: true },
    restrictions: [{ feature: 'fiat_onramp', reason: 'Onboarding is waitlisted pending banking-partner review.', kind: 'waitlist' }],
    reviewStatus: 'unreviewed'
  },
  TR: {
    support: 'unsupported',
    languages: ['tr'],
    currencies: ['TRY'],
    timeZones: ['Europe/Istanbul'],
    primaryTimeZone: 'Europe/Istanbul',
    paymentMethods: [],
    taxModel: 'vat',
    taxRules: [],
    legalFrameworks: ['kvkk'],
    features: {},
    restrictions: [{ feature: 'trading_spot', reason: 'Virtual-asset service providers must be locally licensed.', kind: 'unavailable' }],
    reviewStatus: 'unreviewed'
  }
};

/* --------------------------------------------------------------- lookup */

/** The record for a country, or a fail-closed default. Always returns an object. */
export function policyFor(alpha2) {
  const code = upper(alpha2);
  const found = COUNTRY_POLICY[code];
  if (found) return { alpha2: code, ...found, known: true };
  // Unknown is UNSUPPORTED. A default of "supported" is how a jurisdiction with
  // a licensing requirement gets served by accident.
  return {
    alpha2: code,
    known: false,
    support: 'unsupported',
    languages: [],
    currencies: [],
    timeZones: [],
    primaryTimeZone: null,
    paymentMethods: [],
    taxModel: 'none',
    taxRules: [],
    legalFrameworks: [],
    features: {},
    restrictions: [{ feature: '*', reason: 'No policy is configured for this country, so nothing is enabled.', kind: 'unavailable' }],
    reviewStatus: 'unreviewed'
  };
}

export const isKnown = (alpha2) => COUNTRY_POLICY[upper(alpha2)] != null;
export const isSupported = (alpha2) => ['full', 'limited'].includes(policyFor(alpha2).support);
export const supportLevel = (alpha2) => policyFor(alpha2).support;

/**
 * The full availability record, with the warnings a caller must not ignore.
 * `warnings` is the point: consuming a country record without seeing that its
 * legal position is unreviewed is the failure mode this guards against.
 */
export function availabilityFor(alpha2) {
  const policy = policyFor(alpha2);
  const warnings = [];

  if (!policy.known) warnings.push(`No policy configured for ${policy.alpha2}; treated as unsupported.`);
  if (policy.reviewStatus !== 'reviewed') warnings.push('Legal, tax and restriction entries are UNREVIEWED configuration, not a compliance position.');
  if (policy.support === 'unsupported') warnings.push(`${policy.alpha2} is not supported.`);
  if (policy.support === 'waitlist') warnings.push(`${policy.alpha2} is waitlisted; access is not guaranteed.`);
  for (const rule of policy.taxRules || []) {
    if (rule.reviewStatus !== 'reviewed') warnings.push(`Tax rule ${rule.id} is unreviewed.`);
  }
  if (policy.taxModel === 'none' && !(policy.taxRules || []).some((r) => r.reviewStatus === 'reviewed')) {
    warnings.push('No tax model is configured; charging without one is a compliance risk.');
  }

  return {
    ...policy,
    available: ['full', 'limited'].includes(policy.support),
    languages: [...policy.languages],
    currencies: [...policy.currencies],
    timeZones: [...policy.timeZones],
    paymentMethods: [...policy.paymentMethods],
    legalFrameworks: [...policy.legalFrameworks],
    warnings,
    warningCount: warnings.length
  };
}

/* ---------------------------------------------------------- specific views */

export const languagesFor = (alpha2) => availabilityFor(alpha2).languages;
export const currenciesFor = (alpha2) => availabilityFor(alpha2).currencies;
export const timeZonesFor = (alpha2) => availabilityFor(alpha2).timeZones;
export const paymentMethodsFor = (alpha2) => availabilityFor(alpha2).paymentMethods;
export const legalRequirementsFor = (alpha2) => availabilityFor(alpha2).legalFrameworks;
export const taxRulesFor = (alpha2) => availabilityFor(alpha2).taxRules;
export const restrictionsFor = (alpha2) => availabilityFor(alpha2).restrictions;

/** Is a payment method usable in this country? Unknown methods are refused. */
export function paymentMethodAvailable(alpha2, method) {
  if (!PAYMENT_METHODS.includes(method)) return { ok: false, reason: 'unknown-payment-method' };
  const policy = policyFor(alpha2);
  if (!['full', 'limited'].includes(policy.support)) return { ok: false, reason: 'country-unsupported' };
  const allowed = policy.paymentMethods.includes(method);
  return { ok: allowed, reason: allowed ? 'available' : 'not-available-in-country' };
}

/**
 * Feature availability. A restriction always beats a `features` flag: a country
 * that lists `trading_spot: true` and also restricts it must be refused, or the
 * restriction is decorative.
 */
export function featureAvailable(alpha2, feature, { plan = null, globalKill = [] } = {}) {
  if (!FEATURES.includes(feature)) return { ok: false, reason: 'unknown-feature' };
  if (globalKill.includes(feature)) {
    return { ok: false, reason: 'globally-disabled', note: 'An emergency kill switch is active for this feature.' };
  }

  const policy = policyFor(alpha2);
  if (!['full', 'limited'].includes(policy.support)) return { ok: false, reason: 'country-unsupported' };

  const restricted = (policy.restrictions || []).find((r) => r.feature === feature || r.feature === '*');
  if (restricted) {
    return { ok: false, reason: `restricted-${restricted.kind}`, note: restricted.reason, restriction: restricted };
  }

  // Absent means off. A feature is enabled by policy, never by omission.
  const enabled = policy.features?.[feature] === true;
  if (!enabled) return { ok: false, reason: 'not-enabled-for-country' };

  if (plan && policy.planGates?.[feature] && !policy.planGates[feature].includes(plan)) {
    return { ok: false, reason: 'not-in-plan', allowedPlans: policy.planGates[feature] };
  }

  return { ok: true, reason: 'available' };
}

/** The supported country list, for a picker. */
export function supportedCountries({ level = null } = {}) {
  return Object.entries(COUNTRY_POLICY)
    .filter(([, p]) => (level ? p.support === level : ['full', 'limited'].includes(p.support)))
    .map(([alpha2, p]) => ({ alpha2, support: p.support, languages: p.languages, currencies: p.currencies }));
}

/* ----------------------------------------------------------- coherence */

/**
 * Validate the policy table against the rest of the application.
 *
 * A country whose language is not in the 25 shipped catalogs, or whose currency
 * has no minor unit, or whose time zone is not a real IANA zone, is a bug that
 * otherwise surfaces as a blank label in one country only.
 *
 * `validators` are injected so this module does not import the app's tables —
 * it stays a pure policy engine and the caller supplies the authority.
 */
export function validatePolicy({
  languages = [], currencies = [], zones = [], isKnownCountry = () => true
} = {}) {
  /*
   * Two severities, and the split is the point.
   *
   * `problems` are INCOHERENT CONFIG — a language the app cannot render, a zone
   * that is not real, a restriction contradicting its own flag. Those are code
   * defects and must fail the build.
   *
   * `warnings` are KNOWN, DECLARED GAPS — the legal and tax data has not been
   * reviewed. That is a business state, not a defect, and a validator that
   * refuses to pass until a lawyer signs off is a validator everyone disables.
   * So it is reported loudly and counted, and the count may not grow.
   */
  const problems = [];
  const warnings = [];
  const langSet = new Set(languages);
  const currencySet = new Set(currencies);
  const zoneSet = new Set(zones);

  for (const [alpha2, policy] of Object.entries(COUNTRY_POLICY)) {
    const at = (field, reason) => problems.push({ alpha2, field, reason });

    if (!/^[A-Z]{2}$/.test(alpha2)) at('alpha2', 'Not an ISO 3166-1 alpha-2 code.');
    if (!isKnownCountry(alpha2)) at('alpha2', 'Not a country this application knows.');
    if (!SUPPORT_LEVELS.includes(policy.support)) at('support', `Unknown support level "${policy.support}".`);

    if (!policy.languages?.length) at('languages', 'No language configured.');
    for (const l of policy.languages || []) {
      if (languages.length && !langSet.has(l)) at('languages', `"${l}" is not a shipped language catalog.`);
    }

    if (!policy.currencies?.length) at('currencies', 'No currency configured.');
    for (const c of policy.currencies || []) {
      if (currencies.length && !currencySet.has(c)) at('currencies', `"${c}" is not a known currency.`);
    }

    if (!policy.timeZones?.length) at('timeZones', 'No time zone configured.');
    for (const z of policy.timeZones || []) {
      if (zones.length && !zoneSet.has(z)) at('timeZones', `"${z}" is not a valid IANA zone.`);
    }
    if (policy.primaryTimeZone && !(policy.timeZones || []).includes(policy.primaryTimeZone)) {
      at('primaryTimeZone', 'The primary zone is not in the country’s zone list.');
    }

    for (const m of policy.paymentMethods || []) {
      if (!PAYMENT_METHODS.includes(m)) at('paymentMethods', `"${m}" is not a known payment method.`);
    }
    if (!TAX_MODELS.includes(policy.taxModel)) at('taxModel', `Unknown tax model "${policy.taxModel}".`);
    for (const f of policy.legalFrameworks || []) {
      if (!LEGAL_FRAMEWORKS.includes(f)) at('legalFrameworks', `"${f}" is not a known framework.`);
    }

    for (const [feature, on] of Object.entries(policy.features || {})) {
      if (!FEATURES.includes(feature)) at('features', `"${feature}" is not a known feature.`);
      if (typeof on !== 'boolean') at('features', `"${feature}" is ${typeof on}, not a boolean.`);
    }

    for (const r of policy.restrictions || []) {
      if (r.feature !== '*' && !FEATURES.includes(r.feature)) at('restrictions', `"${r.feature}" is not a known feature.`);
      if (!r.reason) at('restrictions', 'A restriction without a reason is unauditable.');
    }

    // A restriction that contradicts the feature flag is the mistake this
    // catches most often: the flag says yes, the restriction says no.
    for (const r of policy.restrictions || []) {
      if (r.feature !== '*' && policy.features?.[r.feature] === true) {
        at('restrictions', `"${r.feature}" is both enabled and restricted; the restriction wins, so remove the flag.`);
      }
    }

    // Declared gap, not a defect: a supported country whose legal position has
    // not been reviewed. Counted and capped, never silently accepted.
    if (policy.reviewStatus !== 'reviewed' && ['full', 'limited'].includes(policy.support)) {
      warnings.push({ alpha2, field: 'reviewStatus', reason: 'Legal, tax and restriction data is unreviewed configuration, not a compliance position.' });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    /** The ratchet: this count must not grow without a reviewer signing off. */
    unreviewedSupported: warnings.length,
    countries: Object.keys(COUNTRY_POLICY).length
  };
}

/** A label for the reviewer, so an unreviewed country is obvious in the UI. */
export function policySummary() {
  const rows = Object.entries(COUNTRY_POLICY).map(([alpha2, p]) => ({
    alpha2,
    support: p.support,
    languages: p.languages.length,
    currencies: p.currencies.length,
    zones: p.timeZones.length,
    paymentMethods: p.paymentMethods.length,
    restrictions: (p.restrictions || []).length,
    reviewed: p.reviewStatus === 'reviewed'
  }));
  return {
    countries: rows.length,
    bySupport: SUPPORT_LEVELS.reduce((acc, level) => ({ ...acc, [level]: rows.filter((r) => r.support === level).length }), {}),
    unreviewed: rows.filter((r) => !r.reviewed).length,
    rows
  };
}
