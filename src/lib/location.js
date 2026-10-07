/* Location infrastructure: structured places, geocoding abstraction, privacy
 * controls and retention.
 *
 * Privacy is the primary design constraint, not an afterthought:
 *  - Coordinates are stored at a precision the user chooses. "Approximate" is
 *    a real, first-class mode, not a rounding afterthought.
 *  - Precise position is never requested automatically. The caller must ask, and
 *    the permission state is surfaced before the prompt appears.
 *  - Every retention policy is explicit and purging is a pure function of the
 *    record plus "now", so it is testable and auditable.
 */

import { countryByCode } from './countries.js';
import { subdivisionsFor, citiesFor, validatePostal } from './address.js';
import { isValidZone, UTC } from './time.js';

/* ---------------------------------------------------------------------------
 * The place model
 * ------------------------------------------------------------------------ */

export const LOCATION_FIELDS = [
  { key: 'country', label: 'Country', required: true },
  { key: 'state', label: 'State / province' },
  { key: 'region', label: 'Region' },
  { key: 'city', label: 'City' },
  { key: 'district', label: 'District' },
  { key: 'postal', label: 'Postal code' },
  { key: 'timezone', label: 'Time zone' },
  { key: 'coordinates', label: 'Coordinates' }
];

export const emptyLocation = () => ({
  country: null, state: '', region: '', city: '', district: '',
  postal: '', timezone: null, coordinates: null, precision: 'none'
});

/* ---------------------------------------------------------------------------
 * Precision and privacy
 * ------------------------------------------------------------------------ */

/**
 * Precision levels. `decimals` is the number of decimal places kept, which is a
 * distance on the ground:
 *   4 dp ≈ 11 m · 3 dp ≈ 110 m · 2 dp ≈ 1.1 km · 1 dp ≈ 11 km · 0 ≈ 111 km
 * `city` drops coordinates entirely and keeps only the named place.
 */
export const PRECISION_LEVELS = [
  { id: 'none', label: 'No location', decimals: null, keepCoords: false, approx: 'Not stored' },
  { id: 'city', label: 'City only', decimals: null, keepCoords: false, approx: '~10 km — city name kept, coordinates discarded' },
  { id: 'approx', label: 'Approximate (1 km)', decimals: 2, keepCoords: true, approx: '~1 km' },
  { id: 'coarse', label: 'Coarse (11 km)', decimals: 1, keepCoords: true, approx: '~11 km' },
  { id: 'exact', label: 'Precise', decimals: 6, keepCoords: true, approx: 'metres' }
];

export const precisionById = (id) => PRECISION_LEVELS.find((p) => p.id === id) || PRECISION_LEVELS[0];

/*
 * Round by shifting the decimal in string space, then back.
 * Number('24.8607345e6') is exactly 24860734.5, whereas 24.8607345 * 1e6 is
 * 24860734.499999996 — so the naive version rounds DOWN and disagrees with the
 * decimal answer. Coordinates are a boundary-heavy input, so this matters.
 */
const roundTo = (value, decimals) => {
  const n = Number(value);
  if (!Number.isFinite(n) || decimals == null) return null;
  const [mantissa, exponent] = String(n).split('e');
  const scaled = Number(`${mantissa}e${(exponent ? Number(exponent) : 0) + decimals}`);
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  const [m2, e2] = String(rounded).split('e');
  return Number(`${m2}e${(e2 ? Number(e2) : 0) - decimals}`);
};

/**
 * Reduce coordinates to the chosen precision.
 * Returns null (not a rounded value) when the level keeps no coordinates —
 * a rounded 0 is a real location in the Gulf of Guinea, not "unknown".
 */
export function applyPrecision(coordinates, levelId = 'approx') {
  const level = precisionById(levelId);
  if (!coordinates || !level.keepCoords) return null;
  const lat = roundTo(coordinates.lat ?? coordinates.latitude, level.decimals);
  const lon = roundTo(coordinates.lon ?? coordinates.longitude, level.decimals);
  if (lat == null || lon == null) return null;
  return { lat, lon };
}

/**
 * Snap coordinates to a grid cell so a point is indistinguishable from any
 * other point in the same cell. Rounding alone still leaks position when two
 * readings differ across a boundary; snapping to a cell centre does not.
 */
export function snapToGrid(coordinates, cellKm = 1) {
  if (!coordinates) return null;
  const lat = Number(coordinates.lat ?? coordinates.latitude);
  const lon = Number(coordinates.lon ?? coordinates.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const latStep = cellKm / 111.32;
  const snappedLat = Math.round(lat / latStep) * latStep;

  /*
   * The longitude step is derived from the SNAPPED latitude, so every point in
   * the same row shares one column width. Computing it from each point's own
   * latitude gave two readings a metre apart slightly different steps, and they
   * could land in different cells — the opposite of what snapping is for.
   */
  const lonStep = cellKm / (111.32 * Math.max(0.01, Math.cos((snappedLat * Math.PI) / 180)));
  return { lat: snappedLat, lon: Math.round(lon / lonStep) * lonStep };
}

/** Rough distance in km between two points (equirectangular; fine at this scale). */
export function distanceKm(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.lat ?? a.latitude);
  const lon1 = Number(a.lon ?? a.longitude);
  const lat2 = Number(b.lat ?? b.latitude);
  const lon2 = Number(b.lon ?? b.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------------------------------------------------------------------------
 * Retention and deletion
 * ------------------------------------------------------------------------ */

export const RETENTION_POLICIES = [
  { id: 'session', label: 'Session only', days: 0, note: 'Forgotten when the tab closes.' },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '1y', label: '1 year', days: 365 },
  { id: 'manual', label: 'Until I delete it', days: null, note: 'Kept until you remove it yourself.' }
];

export const retentionById = (id) => RETENTION_POLICIES.find((p) => p.id === id) || RETENTION_POLICIES[0];

/** Has a stored location outlived its policy? Pure, so it can be audited. */
export function isExpired(record, now = Date.now()) {
  if (!record?.storedAt) return false;
  const policy = retentionById(record.retention || 'manual');
  if (policy.days == null) return false;
  if (policy.days === 0) return true; // session-only: never persists
  const age = now - new Date(record.storedAt).getTime();
  return age > policy.days * 86400000;
}

export function purgeExpired(records = [], now = Date.now()) {
  const kept = [];
  const purged = [];
  records.forEach((r) => (isExpired(r, now) ? purged.push(r) : kept.push(r)));
  return { kept, purged, purgedCount: purged.length };
}

/**
 * Redact a location for storage. Named fields are kept unless `dropNames` is
 * set; coordinates are reduced to the requested precision.
 */
export function redactLocation(location = {}, { precision = 'approx', dropNames = false, now = Date.now() } = {}) {
  const level = precisionById(precision);
  return {
    country: location.country || null,
    state: dropNames ? '' : (location.state || ''),
    region: dropNames ? '' : (location.region || ''),
    city: dropNames ? '' : (location.city || ''),
    district: dropNames ? '' : (location.district || ''),
    postal: dropNames ? '' : (location.postal || ''),
    timezone: location.timezone || null,
    coordinates: applyPrecision(location.coordinates, level.id),
    precision: level.id,
    retention: location.retention || 'manual',
    storedAt: new Date(now).toISOString()
  };
}

/** Full deletion: the record is replaced, not flagged. Nothing is retained. */
export function deleteLocation(record, { keepCountry = false } = {}) {
  if (!record) return null;
  if (!keepCountry) return null;
  return { country: record.country, precision: 'none', coordinates: null, deleted: true, storedAt: new Date().toISOString() };
}

export const LOCATION_PRIVACY = {
  statement:
    'Location is optional. Precise coordinates are requested only when you press the button, are kept at the '
    + 'precision you choose, and are removed on the schedule you pick. Nothing is sent to CryptoX servers — '
    + 'geocoding calls go directly from your browser to the provider.',
  providers: ['Open-Meteo Geocoding', 'OpenStreetMap Nominatim'],
  providerNote:
    'Both providers are public and keyless, so a geocoding request reveals your search text (or the coordinates you '
    + 'reverse-geocode) to that provider. CryptoX does not proxy or log it.',
  neverStoredPreciselyByDefault: true
};

/* ---------------------------------------------------------------------------
 * Permission handling
 * ------------------------------------------------------------------------ */

export const PERMISSION_STATES = ['granted', 'denied', 'prompt', 'unsupported', 'unknown'];

/**
 * Read the geolocation permission WITHOUT triggering a prompt.
 * Returns 'unsupported' when the Permissions API is absent (Safari), which is
 * not the same as 'prompt' and must be labelled differently.
 */
export async function geolocationPermission(nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav?.geolocation) return 'unsupported';
  try {
    if (!nav.permissions?.query) return 'prompt';
    const status = await nav.permissions.query({ name: 'geolocation' });
    return PERMISSION_STATES.includes(status.state) ? status.state : 'unknown';
  } catch {
    return 'prompt';
  }
}

export const PERMISSION_HELP = {
  granted: 'Location access is allowed.',
  denied: 'Location access is blocked. Enable it in your browser site settings to continue.',
  prompt: 'Your browser will ask for permission when you press the button.',
  unsupported: 'This browser cannot report permission state before asking; it will prompt on request.',
  unknown: 'Permission state could not be determined.'
};

/**
 * Request the current position once.
 * `enableHighAccuracy` is only true for the precise mode — asking for
 * high accuracy when the user chose "approximate" wastes battery and is a
 * privacy downgrade dressed up as a technical default.
 */
export function requestPosition({
  precise = false, timeoutMs = 10000, maxAgeMs = 60000, geo = typeof navigator === 'undefined' ? null : navigator.geolocation
} = {}) {
  return new Promise((resolve) => {
    if (!geo?.getCurrentPosition) {
      resolve({ ok: false, reason: 'unsupported' });
      return;
    }
    geo.getCurrentPosition(
      (pos) => resolve({
        ok: true,
        coordinates: { lat: pos.coords.latitude, lon: pos.coords.longitude },
        accuracyMetres: pos.coords.accuracy ?? null,
        at: new Date().toISOString()
      }),
      (err) => resolve({
        ok: false,
        reason: err?.code === 1 ? 'denied' : err?.code === 2 ? 'unavailable' : err?.code === 3 ? 'timeout' : 'failed',
        message: err?.message || null
      }),
      { enableHighAccuracy: precise, timeout: timeoutMs, maximumAge: maxAgeMs }
    );
  });
}

/* ---------------------------------------------------------------------------
 * Geocoding abstraction
 * ------------------------------------------------------------------------ */

export const GEOCODE_PERMISSION_NOTE =
  'Geocoding is a network call to a public provider. It is the only place coordinates leave the browser.';

/* Pure parsers, so the provider payloads are tested against real captures. */
export const parseOpenMeteo = (json) => {
  if (!json?.results?.length) return [];
  return json.results.map((r) => ({
    id: `om:${r.id}`,
    name: r.name,
    country: r.country_code || null,
    countryName: r.country || null,
    state: r.admin1 || '',
    region: r.admin2 || '',
    district: r.admin3 || '',
    timezone: r.timezone || null,
    coordinates: { lat: r.latitude, lon: r.longitude },
    population: r.population ?? null,
    source: 'open-meteo'
  }));
};

export const parseNominatim = (json) => {
  const list = Array.isArray(json) ? json : (json ? [json] : []);
  return list.filter(Boolean).map((r) => {
    const a = r.address || {};
    return {
      id: `osm:${r.osm_type || 'x'}${r.osm_id || r.place_id}`,
      name: a.city || a.town || a.village || a.county || r.name || '',
      country: (a.country_code || '').toUpperCase() || null,
      countryName: a.country || null,
      state: a.state || a.region || '',
      region: a.county || '',
      district: a.suburb || a.city_district || a.district || '',
      timezone: null,
      coordinates: { lat: Number(r.lat), lon: Number(r.lon) },
      displayName: r.display_name || '',
      source: 'nominatim'
    };
  });
};

export const GEOCODE_PROVIDERS = [
  {
    id: 'open-meteo',
    label: 'Open-Meteo Geocoding',
    keyless: true,
    supportsForward: true,
    supportsReverse: false,
    // Returns the IANA timezone, which is why it leads for forward lookups.
    url: ({ query, count = 8, language = 'en' }) =>
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${count}&language=${encodeURIComponent(language.split('-')[0])}&format=json`,
    parse: parseOpenMeteo
  },
  {
    id: 'nominatim',
    label: 'OpenStreetMap Nominatim',
    keyless: true,
    supportsForward: true,
    supportsReverse: true,
    url: ({ query, count = 5, language = 'en' }) =>
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${count}&addressdetails=1&accept-language=${encodeURIComponent(language)}`,
    reverseUrl: ({ lat, lon, language = 'en' }) =>
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=${encodeURIComponent(language)}`,
    parse: parseNominatim
  }
];

export const geocodeProviderById = (id) => GEOCODE_PROVIDERS.find((p) => p.id === id) || null;

const withTimeout = async (url, { fetchImpl, timeoutMs = 8000, accept = 'application/json' }) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { headers: { accept }, ...(controller ? { signal: controller.signal } : {}) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Forward geocode with provider failover. Returns [] on failure — never a
 * fabricated place, and never the user's own text echoed back as a result.
 */
export async function geocode(query, {
  language = 'en', count = 8, fetchImpl = typeof fetch === 'function' ? fetch : null,
  providers = ['open-meteo', 'nominatim'], timeoutMs = 8000
} = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return { ok: false, reason: 'query-too-short', results: [], errors: [] };
  if (!fetchImpl) return { ok: false, reason: 'no-fetch-available', results: [], errors: [] };

  const errors = [];
  for (const id of providers) {
    const provider = geocodeProviderById(id);
    if (!provider?.supportsForward) continue;
    try {
      const json = await withTimeout(provider.url({ query: q, count, language }), { fetchImpl, timeoutMs });
      const results = provider.parse(json);
      if (results.length) return { ok: true, provider: id, results, errors };
      errors.push({ provider: id, error: 'no matches' });
    } catch (err) {
      errors.push({ provider: id, error: err?.message || 'failed' });
    }
  }
  return { ok: false, reason: 'no-provider-returned-results', results: [], errors };
}

/**
 * Reverse geocode coordinates to a place. Only providers that support reverse
 * are tried; the rest are skipped rather than being silently queried wrong.
 */
export async function reverseGeocode(coordinates, {
  language = 'en', fetchImpl = typeof fetch === 'function' ? fetch : null, timeoutMs = 8000
} = {}) {
  const lat = Number(coordinates?.lat ?? coordinates?.latitude);
  const lon = Number(coordinates?.lon ?? coordinates?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ok: false, reason: 'invalid-coordinates', result: null, errors: [] };
  }
  if (!fetchImpl) return { ok: false, reason: 'no-fetch-available', result: null, errors: [] };

  const errors = [];
  for (const provider of GEOCODE_PROVIDERS.filter((p) => p.supportsReverse)) {
    try {
      const json = await withTimeout(provider.reverseUrl({ lat, lon, language }), { fetchImpl, timeoutMs });
      const [result] = provider.parse(json);
      if (result) return { ok: true, provider: provider.id, result, errors };
      errors.push({ provider: provider.id, error: 'no result' });
    } catch (err) {
      errors.push({ provider: provider.id, error: err?.message || 'failed' });
    }
  }
  return { ok: false, reason: 'no-provider-returned-results', result: null, errors };
}

/* ---------------------------------------------------------------------------
 * Time zone from location
 * ------------------------------------------------------------------------ */

/* Countries that span several zones cannot be answered from the country alone. */
export const MULTI_ZONE_COUNTRIES = new Set([
  'US', 'CA', 'RU', 'AU', 'BR', 'MX', 'CN', 'ID', 'KZ', 'MN', 'AR', 'CL', 'ES',
  'PT', 'FR', 'NZ', 'EC', 'MY', 'PH', 'UA', 'AQ'
]);

/*
 * A coarse country → zone default. Correct for single-zone countries; for
 * multi-zone countries it is a starting point that MUST be overridden by the
 * user or by a geocoder result, which is why `source` is returned.
 */
const COUNTRY_ZONE = {
  PK: 'Asia/Karachi', IN: 'Asia/Kolkata', BD: 'Asia/Dhaka', LK: 'Asia/Colombo',
  NP: 'Asia/Kathmandu', AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar',
  KW: 'Asia/Kuwait', BH: 'Asia/Bahrain', OM: 'Asia/Muscat', IR: 'Asia/Tehran',
  IL: 'Asia/Jerusalem', TR: 'Europe/Istanbul', GB: 'Europe/London',
  IE: 'Europe/Dublin', DE: 'Europe/Berlin', FR: 'Europe/Paris', ES: 'Europe/Madrid',
  IT: 'Europe/Rome', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels',
  CH: 'Europe/Zurich', AT: 'Europe/Vienna', SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', GR: 'Europe/Athens',
  PT: 'Europe/Lisbon', RU: 'Europe/Moscow', UA: 'Europe/Kyiv', RO: 'Europe/Bucharest',
  EG: 'Africa/Cairo', NG: 'Africa/Lagos', KE: 'Africa/Nairobi', ZA: 'Africa/Johannesburg',
  MA: 'Africa/Casablanca', GH: 'Africa/Accra', ET: 'Africa/Addis_Ababa',
  CN: 'Asia/Shanghai', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh',
  PH: 'Asia/Manila', HK: 'Asia/Hong_Kong', TW: 'Asia/Taipei',
  AU: 'Australia/Sydney', NZ: 'Pacific/Auckland', BR: 'America/Sao_Paulo',
  MX: 'America/Mexico_City', AR: 'America/Argentina/Buenos_Aires',
  CO: 'America/Bogota', PE: 'America/Lima', CL: 'America/Santiago',
  CA: 'America/Toronto', US: 'America/New_York'
};

/**
 * Best time zone for a location.
 * Order of trust: an explicit zone > a geocoder-supplied zone > the country
 * default. `confident` is false for multi-zone countries resolved by default,
 * so the UI can ask instead of quietly applying the wrong one.
 */
export function timezoneForLocation({ timezone, country, coordinates } = {}) {
  if (isValidZone(timezone)) return { zone: timezone, source: 'explicit', confident: true };
  if (!country) return { zone: UTC, source: 'utc-default', confident: false };
  const zone = COUNTRY_ZONE[country];
  if (!zone) return { zone: UTC, source: 'unknown-country', confident: false };
  return {
    zone,
    source: 'country-default',
    confident: !MULTI_ZONE_COUNTRIES.has(country),
    needsConfirmation: MULTI_ZONE_COUNTRIES.has(country),
    note: MULTI_ZONE_COUNTRIES.has(country)
      ? `${country} spans multiple time zones; this is a default and should be confirmed.`
      : null,
    coordinates: coordinates ? applyPrecision(coordinates, 'city') : undefined
  };
}

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

/**
 * Validate a structured location.
 * Subdivisions and cities are only checked where we actually hold a list —
 * a country without one accepts free text, because rejecting an unknown
 * province name would block valid addresses.
 */
export function validateLocation(location = {}) {
  const errors = [];
  const warnings = [];

  if (!location.country || !countryByCode(location.country)) {
    errors.push({ field: 'country', reason: 'required' });
  }

  if (location.country && location.state) {
    const subs = subdivisionsFor(location.country);
    if (subs.length && !subs.includes(location.state)) {
      warnings.push({ field: 'state', reason: 'not-in-list', note: 'Accepted as free text.' });
    }
  }

  if (location.country && location.city) {
    const cities = citiesFor(location.country);
    if (cities.length && !cities.includes(location.city)) {
      warnings.push({ field: 'city', reason: 'not-in-list', note: 'Accepted as free text.' });
    }
  }

  if (location.country && location.postal) {
    const postal = validatePostal(location.country, location.postal);
    if (postal.ok === false) errors.push({ field: 'postal', reason: postal.reason });
    // ok === null means there is no rule; that is not an error.
  }

  if (location.timezone && !isValidZone(location.timezone)) {
    errors.push({ field: 'timezone', reason: 'invalid-iana-zone' });
  }

  if (location.coordinates) {
    const lat = Number(location.coordinates.lat ?? location.coordinates.latitude);
    const lon = Number(location.coordinates.lon ?? location.coordinates.longitude);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) errors.push({ field: 'coordinates', reason: 'latitude-out-of-range' });
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) errors.push({ field: 'coordinates', reason: 'longitude-out-of-range' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** A single-line label for a place, most specific first. */
export function formatPlace(place = {}) {
  return [place.district, place.city, place.state, place.countryName || countryByCode(place.country)?.name]
    .filter(Boolean)
    .join(', ');
}
