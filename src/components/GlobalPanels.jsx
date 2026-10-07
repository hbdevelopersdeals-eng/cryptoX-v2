import React, { useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Clock, Download, MapPin, Navigation, Shield, Trash2 } from 'lucide-react';
import { Card } from './ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useCurrency } from '../lib/currency.jsx';
import { CURRENCIES, currencyByCode, decimalsFor, symbolFor, searchCurrencies, toMinorUnits, currencyName } from '../lib/currencies.js';
import { roundToCurrency } from '../lib/rates.js';
import { priceLine, buildPriceBook, currencyAvailability, cashIncrementFor, CONVERSION_DISCLAIMER, PRICING_DISCLAIMER } from '../lib/pricing.js';
import {
  ZONE_LIST, isValidZone, offsetMinutes, offsetLabel, gmtLabel, isDST, zoneAbbreviation,
  resolveWallTime, toStorage, fromUTC, findTransitions, formatRelative, planReminder,
  buildICS, CALENDAR_INTEGRATION, RECURRENCE_LIMITATION, UTC
} from '../lib/time.js';
import {
  PRECISION_LEVELS, RETENTION_POLICIES, applyPrecision, redactLocation, validateLocation,
  geocode, reverseGeocode, geolocationPermission, requestPosition, timezoneForLocation,
  formatPlace, PERMISSION_HELP, LOCATION_PRIVACY, GEOCODE_PROVIDERS,
  isExpired, purgeExpired, retentionById, deleteLocation
} from '../lib/location.js';
import { countryByCode } from '../lib/countries.js';
import { loadSecurity } from '../lib/securityStore.js';

const Row = ({ label, value, mono = true }) => (
  <div className="flex items-baseline justify-between gap-3 py-1">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span className={`text-[11px] ${mono ? 'font-mono' : ''} text-right`}>{value}</span>
  </div>
);

/* ------------------------------------------------------------------ currency */

export function CurrencyPanel() {
  const { t, region, lang } = useI18n();
  const currency = useCurrency();
  const [query, setQuery] = useState('');
  const [amount, setAmount] = useState('100');

  /* The merchant's own currency: what the business actually settles in, as
   * opposed to what the viewer happens to display. The two are different
   * numbers and the price book shows both, or the disclaimer below is a lie. */
  const settlementDefault = useMemo(() => {
    const state = loadSecurity();
    const org = state.organizations.find((o) => o.id === state.activeOrgId) || state.organizations[0];
    return org?.currency || 'USD';
  }, []);
  const [settlement, setSettlement] = useState(settlementDefault);

  const matches = useMemo(() => searchCurrencies(query, 60), [query]);
  const active = currencyByCode(currency.code);
  const table = { base: 'USD', rates: currency.rates };
  const numeric = Number(amount) || 0;

  const book = useMemo(() => buildPriceBook({
    amount: numeric, settlementCurrency: settlement,
    currencies: [settlement, currency.code, 'USD', 'EUR', 'GBP', 'JPY', 'INR', 'PKR', 'AED'], rateTable: table
  }), [numeric, currency.rates, settlement, currency.code]);

  const availability = useMemo(
    () => currencyAvailability({ country: region, rateTable: table }),
    [region, currency.rates]
  );

  const stale = currency.stale;

  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Banknote size={15} className="text-primary" /> Currency
        <span className="text-xs font-normal text-muted-foreground">
          {CURRENCIES.length} ISO 4217 currencies
        </span>
      </h2>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search currency by code or name"
            aria-label="Search currency"
            className="input-dark !h-9 w-full !text-[12px]"
          />
          <select
            value={currency.code}
            onChange={(e) => currency.setCode(e.target.value)}
            aria-label="Currency"
            size={6}
            className="input-dark w-full !text-[12px]"
          >
            {matches.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {currencyName(c.code, lang)}
              </option>
            ))}
          </select>

          <Row label="Symbol" value={symbolFor(currency.code)} />
          <Row label="Minor unit" value={`${decimalsFor(currency.code)} decimals`} />
          <Row label="Amount" value={
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Amount in USD"
              className="input-dark !h-7 !w-24 !px-2 !text-[11px]"
            />
          } mono={false} />
        </div>

        <div className="space-y-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[11px] font-medium">Conversion</p>
            <p className="num mt-1 text-sm">{currency.format(100)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {table.rates?.USD === 1 && active ? `1 USD = ${(table.rates[currency.code] ?? 1).toFixed(4)} ${currency.code}` : null}
            </p>
            <div className="mt-2 space-y-0.5">
              <Row label="Source" value={currency.source} />
              <Row label="Provider" value={currency.provider || '—'} />
              <Row label="Published" value={currency.asOf ? String(currency.asOf).slice(0, 19).replace('T', ' ') : 'not published'} />
            </div>
            {stale ? (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                These rates are a fallback, not a live quote. Do not use them for settlement.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] font-medium">Rounding to the minor unit</p>
            <div className="mt-1 space-y-0.5">
              <Row label="1.005" value={String(roundToCurrency(1.005, currency.code))} />
              <Row label="-1.235" value={String(roundToCurrency(-1.235, currency.code))} />
              <Row label="Cash increment" value={cashIncrementFor(currency.code) ?? 'none'} />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-medium">Multi-currency price book · {numeric}</p>
          <select
            value={settlement}
            onChange={(e) => setSettlement(e.target.value)}
            aria-label="Settlement currency"
            className="input-dark !h-7 !w-28 !text-[11px]"
          >
            {[settlement, 'USD', 'EUR', 'GBP', 'JPY', 'INR', 'PKR', 'AED']
              .filter((c, i, a) => a.indexOf(c) === i && currencyByCode(c))
              .map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="text-[10px] text-muted-foreground">
            settlement · you display {currency.code}
          </span>
        </div>
        <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {book.map((line) => (
            <Row
              key={line.currency}
              label={line.currency}
              value={line.ok ? String(line.displayAmounts.gross) : `unavailable (${line.reason})`}
            />
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">{PRICING_DISCLAIMER.rounding}</p>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-[11px] font-medium">
          Availability in {countryByCode(region)?.name || region}
        </p>
        <div className="mt-1 space-y-0.5">
          <Row label="Local" value={availability.locals.join(', ') || '—'} />
          <Row label="Supported" value={availability.supported.join(', ')} />
          <Row label="Unavailable" value={availability.unavailable.join(', ') || 'none'} />
        </div>
        {availability.missingRateNote ? (
          <p className="mt-1.5 text-[11px] text-amber-300">{availability.missingRateNote}</p>
        ) : null}
      </div>

      <p className="text-[10px] text-muted-foreground">{CONVERSION_DISCLAIMER}</p>
    </Card>
  );
}

/* ---------------------------------------------------------------------- time */

export function TimePanel() {
  const { t, lang, timeZone } = useI18n();
  const [zone, setZone] = useState(() => (isValidZone(timeZone) ? timeZone : 'Asia/Karachi'));
  const [wall, setWall] = useState('2026-10-07T09:00');

  const valid = isValidZone(zone);
  const offset = valid ? offsetMinutes(zone, new Date()) : null;
  const dst = valid ? isDST(zone, new Date()) : false;
  const transitions = useMemo(
    () => (valid ? findTransitions(zone, Date.UTC(new Date().getUTCFullYear(), 0, 1), Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)) : []),
    [zone, valid]
  );

  const parsed = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
    if (!m) return null;
    return {
      year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
      hour: Number(m[4]), minute: Number(m[5])
    };
  }, [wall]);

  const resolved = parsed && valid ? resolveWallTime(zone, parsed) : null;
  const reminder = parsed && valid ? planReminder({ wall: parsed, zone, leadMinutes: 15 }) : null;

  const zones = useMemo(() => {
    const grouped = ZONE_LIST.reduce((acc, z) => {
      const area = z.includes('/') ? z.split('/')[0] : 'UTC';
      (acc[area] = acc[area] || []).push(z);
      return acc;
    }, {});
    return Object.keys(grouped).sort().map((area) => ({ area, zones: grouped[area] }));
  }, []);

  const downloadIcs = () => {
    if (!resolved?.instant) return;
    const end = new Date(resolved.instant.getTime() + 30 * 60000);
    const ics = buildICS({
      events: [{
        start: resolved.instant, end,
        summary: 'CryptoX reminder', zone,
        description: `Scheduled for ${fromUTC(resolved.instant, zone, { dateStyle: 'full', timeStyle: 'short' })}`
      }]
    });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cryptox-reminder.ics';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Clock size={15} className="text-primary" /> Time zone
        <span className="text-xs font-normal text-muted-foreground">IANA zones · stored in UTC</span>
      </h2>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            aria-label="Time zone"
            size={7}
            className="input-dark w-full !text-[12px]"
          >
            {zones.map((g) => (
              <optgroup key={g.area} label={g.area}>
                {g.zones.map((z) => (
                  <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <Row label="Offset" value={`${offsetLabel(offset)} (${gmtLabel(zone)})`} />
            <Row label="Abbreviation" value={zoneAbbreviation(zone)} />
            <Row label="Daylight saving" value={dst ? 'active now' : 'not active'} />
            <Row label="Transitions this year" value={transitions.length} />
            {transitions.map((tr) => (
              <Row key={tr.at} label={tr.at.slice(0, 10)} value={`${tr.deltaMinutes > 0 ? '+' : ''}${tr.deltaMinutes} min`} />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="wall-time">
              Local wall time
            </label>
            <input
              id="wall-time"
              type="datetime-local"
              value={wall}
              onChange={(e) => setWall(e.target.value)}
              className="input-dark !h-10 w-full"
            />
          </div>

          <div className="rounded-lg border border-border p-3">
            {resolved?.instant ? (
              <>
                <Row label="Stored (UTC)" value={toStorage(resolved.instant)} />
                <Row label="Local display" value={fromUTC(resolved.instant, zone, { dateStyle: 'medium', timeStyle: 'short' })} />
                <Row label="Reminder (−15 min)" value={reminder?.reminderUtc || '—'} />
                <Row label="Ambiguity" value={resolved.kind} />
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {valid ? 'Enter a valid local time.' : 'That zone is not in the IANA database.'}
              </p>
            )}

            {resolved?.kind === 'ambiguous' ? (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                This local time happens twice (the clocks went back). Pick which one — storing the
                wrong one schedules the event an hour out.
              </p>
            ) : null}
            {resolved?.kind === 'nonexistent' ? (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-down">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                This local time never happens — the clocks jumped forward past it.
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={downloadIcs}
            disabled={!resolved?.instant}
            className="btn-ghost !h-8 !px-3 !text-[11px] disabled:opacity-40"
          >
            <Download size={12} className="mr-1.5" /> Download .ics
          </button>
          <p className="text-[10px] text-muted-foreground">
            {CALENDAR_INTEGRATION.note} {CALENDAR_INTEGRATION.limitations.join(' · ')}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <Row label="Relative time preview" value={formatRelative(Date.now() - 3 * 60000, { lang })} />
        <p className="mt-1 text-[10px] text-muted-foreground">{RECURRENCE_LIMITATION}</p>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ location */

export function LocationPanel() {
  const { t } = useI18n();
  const [precision, setPrecision] = useState('approx');
  const [retention, setRetention] = useState('manual');
  const [permission, setPermission] = useState('unknown');
  const [status, setStatus] = useState(null);
  const [coords, setCoords] = useState(null);
  const [place, setPlace] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  /* Saved locations, so retention and deletion are demonstrable rather than
   * described. Nothing here is sent anywhere. */
  const [records, setRecords] = useState([]);

  const stored = useMemo(
    () => redactLocation({ coordinates: coords, city: place?.name, country: place?.country, timezone: place?.timezone }, { precision }),
    [coords, place, precision]
  );

  const validation = useMemo(() => validateLocation({
    country: place?.country || null, city: place?.name || '', timezone: place?.timezone || null, coordinates: coords
  }), [place, coords]);

  const zoneInfo = useMemo(
    () => timezoneForLocation({ timezone: place?.timezone, country: place?.country, coordinates: coords }),
    [place, coords]
  );

  const checkPermission = async () => {
    const state = await geolocationPermission();
    setPermission(state);
    return state;
  };

  const useMyLocation = async () => {
    setBusy(true);
    setStatus(null);
    const state = await checkPermission();
    if (state === 'denied') {
      setStatus({ kind: 'error', text: PERMISSION_HELP.denied });
      setBusy(false);
      return;
    }
    const pos = await requestPosition({ precise: precision === 'exact' });
    if (!pos.ok) {
      setStatus({ kind: 'error', text: PERMISSION_HELP[pos.reason] || `Location failed: ${pos.reason}` });
      setBusy(false);
      return;
    }
    // Reduce to the chosen precision BEFORE anything is kept or reverse-geocoded.
    setCoords(applyPrecision(pos.coordinates, precision));
    const reversed = await reverseGeocode(pos.coordinates, { language: 'en' });
    if (reversed.ok) setPlace(reversed.result);
    else setStatus({ kind: 'warn', text: `Location found, but reverse geocoding failed (${reversed.reason}).` });
    setBusy(false);
  };

  const search = async () => {
    setBusy(true);
    setStatus(null);
    const out = await geocode(query, { language: 'en' });
    setResults(out.results);
    if (!out.ok) setStatus({ kind: 'warn', text: `No provider returned a match (${out.reason}).` });
    setBusy(false);
  };

  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MapPin size={15} className="text-primary" /> Location
        <span className="text-xs font-normal text-muted-foreground">optional · client-side only</span>
      </h2>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] font-medium">Precision</p>
            <div className="mt-2 space-y-1">
              {PRECISION_LEVELS.map((p) => (
                <label key={p.id} className="flex items-start gap-2 text-[11px]">
                  <input
                    type="radio"
                    name="precision"
                    value={p.id}
                    checked={precision === p.id}
                    onChange={() => setPrecision(p.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{p.label}</span>
                    <span className="ml-1.5 text-muted-foreground">{p.approx}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] font-medium">Retention</p>
            <select
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              aria-label="Retention"
              className="input-dark mt-1.5 !h-9 w-full !text-[12px]"
            >
              {RETENTION_POLICIES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {retentionById(retention).note
                || `Kept for ${retentionById(retention).days} days, then purged automatically.`}
            </p>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium">Saved locations ({records.length})</p>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={!place && !coords}
                  onClick={() => {
                    setRecords([{
                      ...redactLocation({ city: place?.name, country: place?.country, timezone: place?.timezone, coordinates: coords }, { precision }),
                      id: `loc_${Date.now()}`,
                      retention
                    }, ...records]);
                  }}
                  className="btn-ghost !h-6 !px-2 !text-[10px] disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const out = purgeExpired(records);
                    setRecords(out.kept);
                    setStatus({ kind: 'warn', text: `Purged ${out.purgedCount} expired record(s).` });
                  }}
                  className="btn-ghost !h-6 !px-2 !text-[10px]"
                >
                  Purge expired
                </button>
              </div>
            </div>
            {records.length ? (
              <div className="mt-2 divide-y divide-border/60">
                {records.map((r) => {
                  const expired = isExpired(r);
                  return (
                    <div key={r.id} className="flex items-center gap-2 py-1.5 text-[10px]">
                      <span className="flex-1 truncate">{r.city || r.country || '—'} · {r.precision} · {r.retention}</span>
                      <span className={expired ? 'text-amber-300' : 'text-muted-foreground'}>{expired ? 'expired' : 'active'}</span>
                      <button
                        type="button"
                        aria-label={`Delete ${r.city || r.country}`}
                        onClick={() => setRecords(records.map((x) => (x.id === r.id ? deleteLocation(x) : x)).filter(Boolean))}
                        className="text-muted-foreground hover:text-down"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Nothing saved. &ldquo;Save&rdquo; stores the redacted value only — coordinates already reduced to the chosen precision.
              </p>
            )}
            <button
              type="button"
              disabled={!records.length}
              onClick={() => { setRecords([]); setCoords(null); setPlace(null); setStatus({ kind: 'warn', text: 'All saved location data deleted.' }); }}
              className="btn-ghost mt-2 !h-6 !px-2 !text-[10px] text-down disabled:opacity-40"
            >
              Delete everything
            </button>
          </div>

          <button
            type="button"
            onClick={useMyLocation}
            disabled={busy}
            className="btn-ghost !h-9 !px-3 !text-[11px] disabled:opacity-40"
          >
            <Navigation size={12} className="mr-1.5" /> Use my location
          </button>
          <p className="text-[10px] text-muted-foreground">
            Permission: <span className="font-mono">{permission}</span> — {PERMISSION_HELP[permission] || ''}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a city, e.g. Karachi"
              aria-label="Search a place"
              className="input-dark !h-9 w-full !text-[12px]"
            />
            <button type="button" onClick={search} disabled={busy} className="btn-ghost !h-9 !px-3 !text-[11px]">
              Search
            </button>
          </div>

          {results.length ? (
            <ul className="max-h-40 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => { setPlace(r); setCoords(applyPrecision(r.coordinates, precision)); }}
                    className="w-full px-3 py-1.5 text-left text-[11px]"
                  >
                    {formatPlace(r)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[11px] font-medium">What would be stored</p>
            <div className="mt-1 space-y-0.5">
              <Row label="Place" value={place ? formatPlace(place) : '—'} mono={false} />
              <Row label="Coordinates" value={stored.coordinates ? `${stored.coordinates.lat}, ${stored.coordinates.lon}` : 'not stored'} />
              <Row label="Precision" value={stored.precision} />
              <Row label="Retention" value={retention} />
              <Row label="Time zone" value={zoneInfo.zone} />
            </div>
            {zoneInfo.needsConfirmation ? (
              <p className="mt-1.5 text-[11px] text-amber-300">{zoneInfo.note}</p>
            ) : null}
          </div>

          {validation.errors.length ? (
            <p className="text-[11px] text-down">{validation.errors.map((e) => `${e.field}: ${e.reason}`).join(' · ')}</p>
          ) : null}
          {validation.warnings.length ? (
            <p className="text-[11px] text-muted-foreground">
              {validation.warnings.map((w) => `${w.field}: ${w.note || w.reason}`).join(' · ')}
            </p>
          ) : null}

          {status ? (
            <p className={`text-[11px] ${status.kind === 'error' ? 'text-down' : 'text-amber-300'}`}>{status.text}</p>
          ) : null}
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <Shield size={11} className="mt-0.5 shrink-0" />
        {LOCATION_PRIVACY.statement}
      </p>
      <p className="text-[10px] text-muted-foreground">
        Providers: {GEOCODE_PROVIDERS.map((p) => p.label).join(', ')}. {LOCATION_PRIVACY.providerNote}
      </p>
    </Card>
  );
}
