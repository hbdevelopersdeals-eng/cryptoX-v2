import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Globe2, Languages, MapPin, Phone, Ruler, Search } from 'lucide-react';
import { Card } from '../components/ui.jsx';
import { CountrySelect, PhoneField } from '../components/GlobalFields.jsx';
import { CurrencyPanel, TimePanel, LocationPanel } from '../components/GlobalPanels.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { LANGUAGES, NUMBERING_SYSTEMS, languageByCode } from '../lib/locales.js';
import { coverage } from '../lib/translate.js';
import {
  validatePostal, usesPostalCodes, postalRule, subdivisionsFor, citiesFor, formatAddress, addressFormat
} from '../lib/address.js';
import { countryByCode, COUNTRIES, REGIONS } from '../lib/countries.js';
import { separators, datePattern, formatCurrency } from '../lib/localeFormat.js';
import { SEO_LIMITATION, hreflangLinks, SITE_URL } from '../lib/seo.js';
import { DELIVERY_CHANNELS, renderAll } from '../lib/transactional.js';
import { UNAVAILABLE_RULES } from '../lib/alertExtras.js';

const Field = ({ label, children }) => (
  <div>
    <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
    {children}
  </div>
);

export default function Region() {
  const i18n = useI18n();
  const {
    t, lang, dir, rtl, stats, region, measurement, numbering, timeZone, detected,
    setLang, setRegion, setNumbering, setMeasurement, tables,
    fmtNumber, fmtCurrency, fmtDate, fmtTime, fmtMeasure
  } = i18n;

  const [subdivision, setSubdivision] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [phone, setPhone] = useState('');
  const [langQuery, setLangQuery] = useState('');

  const country = countryByCode(region);
  const subs = subdivisionsFor(region);
  const cities = citiesFor(region);
  const postalState = validatePostal(region, postal);
  const usesPostal = usesPostalCodes(region);

  const addressLines = useMemo(() => formatAddress({
    name: 'Ali Khan',
    line1: '12 Market Road',
    city,
    state: subdivision,
    postal,
    country: country?.name || ''
  }, region), [city, subdivision, postal, country, region]);

  const filteredLanguages = useMemo(() => {
    const q = langQuery.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter((l) => l.code.toLowerCase().includes(q)
      || l.label.toLowerCase().includes(q)
      || l.nativeLabel.toLowerCase().includes(q));
  }, [langQuery]);

  const previews = renderAll(lang, tables, { name: 'Ali', count: 2, gender: 'female', symbol: 'BTC', price: 100000 });
  const alternates = hreflangLinks({ baseUrl: SITE_URL, path: '/region', languages: LANGUAGES.map((l) => l.code) });
  const active = languageByCode(lang);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Globe2 size={18} className="text-primary" /> {t('region.title')}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('region.subtitle')}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {COUNTRIES.length} countries and territories · {Object.keys(REGIONS).length} world regions · {LANGUAGES.length} languages
        </p>
      </div>

      {/* Detected defaults */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs">
            <p className="font-medium">{t('region.detected', { country: countryByCode(detected.region)?.name || '—' })}</p>
            <p className="mt-0.5 text-muted-foreground">
              {t('lang.detected')}: <span className="font-mono">{detected.lang}</span>
              {detected.timeZone ? <> · <span className="font-mono">{detected.timeZone}</span></> : null}
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost !h-8 !px-3 !text-[11px]"
            onClick={() => {
              setLang(detected.lang);
              if (detected.region) setRegion(detected.region);
            }}
          >
            {t('region.applyDetected')}
          </button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Country, subdivisions, city, postal */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <MapPin size={15} className="text-primary" /> {t('region.country')}
          </h2>

          <CountrySelect value={region} onChange={setRegion} label={t('region.country')} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('region.subdivision')}>
              {subs.length ? (
                <select
                  value={subdivision}
                  onChange={(e) => setSubdivision(e.target.value)}
                  className="input-dark !h-10 w-full"
                  aria-label={t('region.subdivision')}
                >
                  <option value="">{t('region.selectSubdivision')}</option>
                  {subs.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input
                  value={subdivision}
                  onChange={(e) => setSubdivision(e.target.value)}
                  className="input-dark !h-10 w-full"
                  placeholder={t('region.subdivision')}
                  aria-label={t('region.subdivision')}
                />
              )}
              <p className="mt-1 text-[10px] text-muted-foreground">
                {subs.length ? `${subs.length} listed` : 'No list for this country — free text'}
              </p>
            </Field>

            <Field label={t('region.city')}>
              {cities.length ? (
                <select
                  value={cities.includes(city) ? city : ''}
                  onChange={(e) => setCity(e.target.value)}
                  className="input-dark !h-10 w-full"
                  aria-label={t('region.city')}
                >
                  <option value="">{t('region.selectCity')}</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : null}
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={`input-dark !h-10 w-full ${cities.length ? 'mt-2' : ''}`}
                placeholder={t('region.cityName')}
                aria-label={t('region.cityName')}
              />
            </Field>
          </div>

          <Field label={postalRule(region)?.label || t('region.postalCode')}>
            <input
              value={postal}
              onChange={(e) => setPostal(e.target.value)}
              className="input-dark !h-10 w-full"
              placeholder={postalRule(region)?.fmt || (usesPostal ? '' : '—')}
              aria-label={t('region.postalCode')}
              aria-invalid={postalState.ok === false}
            />
            <p className="mt-1 text-[11px]">
              {!usesPostal ? (
                <span className="text-muted-foreground">{t('address.noPostalCode', { country: country?.name || '' })}</span>
              ) : postalState.ok === true ? (
                <span className="text-emerald-400">{postalRule(region)?.fmt}</span>
              ) : postalState.ok === false ? (
                <span className="text-down">{t('address.invalidPostal', { country: country?.name || '' })}</span>
              ) : (
                <span className="text-muted-foreground">No format rule for {country?.name} — not validated</span>
              )}
            </p>
          </Field>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              {t('address.preview', { country: country?.name || '' })} · <span className="font-mono">{addressFormat(region).key}</span>
            </p>
            {addressLines.length ? (
              <address className="text-xs not-italic leading-relaxed">
                {addressLines.map((line) => <div key={line}>{line}</div>)}
              </address>
            ) : <p className="text-xs text-muted-foreground">—</p>}
          </div>
        </Card>

        {/* Language */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Languages size={15} className="text-primary" /> {t('lang.title')}
          </h2>

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">
              {active?.label} · <span dir="rtl">{active?.nativeLabel}</span>
            </p>
            <p className="mt-1 text-muted-foreground">
              {t('lang.coverage', { translated: stats.translated, total: stats.total, percent: stats.percent })}
              {' · '}{t('lang.direction')}: {rtl ? t('lang.rtl') : t('lang.ltr')}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary" style={{ width: `${stats.percent}%` }} />
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {t('lang.draftNotice')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Search size={13} className="text-muted-foreground" />
            <input
              value={langQuery}
              onChange={(e) => setLangQuery(e.target.value)}
              placeholder={t('common.search')}
              aria-label={t('lang.interface')}
              className="input-dark !h-9 w-full !text-[12px]"
            />
          </div>

          <ul className="max-h-64 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
            {filteredLanguages.map((l) => {
              const c = coverage(tables, l.code);
              return (
                <li key={l.code}>
                  <button
                    type="button"
                    onClick={() => setLang(l.code)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${l.code === lang ? 'bg-accent' : ''}`}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">{l.code}</span>
                    <span>{l.label}</span>
                    {l.dir === 'rtl' ? <span className="chip !px-1.5 !text-[9px]">RTL</span> : null}
                    <span className="ml-auto text-[10px] text-muted-foreground">{c.percent}%</span>
                    {l.code === lang ? <Check size={12} className="text-primary" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <Field label={t('lang.numbering')}>
            <select
              value={numbering}
              onChange={(e) => setNumbering(e.target.value)}
              className="input-dark !h-10 w-full"
              aria-label={t('lang.numbering')}
            >
              {NUMBERING_SYSTEMS.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </Field>

          <p className="text-[11px] text-muted-foreground">
            {t('lang.fallbackNote', { fallback: 'English' })} · {t('lang.sourceNote')}
          </p>
        </Card>
      </div>

      {/* Phone */}
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Phone size={15} className="text-primary" /> {t('phone.title')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <PhoneField value={phone} onChange={setPhone} region={region} />
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">{t('phone.stored', { e164: phone || '+…' })}</p>
            <p className="mt-1 text-muted-foreground">
              Stored in E.164 — a single international format with no spaces or punctuation, so one column
              holds every country.
            </p>
          </div>
        </div>
      </Card>

      {/* Formatting previews */}
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Ruler size={15} className="text-primary" /> {t('region.numberFormat')} · {t('region.dateFormat')}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-muted-foreground">{t('number.sample')}</p>
            <p className="num mt-1 text-sm">{fmtNumber(1234567.89, { digits: 2 })}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t('number.decimalSeparator')}: <span className="font-mono">"{separators(lang, numbering).decimal}"</span>
              {' · '}{t('number.thousandsSeparator')}: <span className="font-mono">"{separators(lang, numbering).group}"</span>
            </p>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-muted-foreground">{t('region.dateFormat')}</p>
            <p className="num mt-1 text-sm">{fmtDate(Date.now())}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              <span className="font-mono">{datePattern(lang)}</span> · {fmtTime(Date.now())}
            </p>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-muted-foreground">{t('number.currency')}</p>
            <p className="num mt-1 text-sm">{fmtCurrency(1234.5, { currency: country?.currency || 'USD' })}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{country?.currency || 'USD'}</p>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-muted-foreground">{t('region.measurement')}</p>
            <p className="num mt-1 text-sm">{fmtMeasure(1, 'km')}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {measurement === 'metric' ? t('region.metric') : t('region.imperial')}
            </p>
            <div className="mt-2 flex gap-1">
              {['metric', 'imperial'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMeasurement(m)}
                  className={`rounded-md px-2 py-0.5 text-[10px] ${measurement === m ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Localized SEO */}
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">{t('seo.hreflang', { count: alternates.length })}</h2>
        <div className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-3">
          <pre className="text-[10px] leading-relaxed text-muted-foreground">
{alternates.slice(0, 6).map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`).join('\n')}
{alternates.length > 6 ? `\n… ${alternates.length - 6} more` : ''}
          </pre>
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {SEO_LIMITATION}
        </p>
      </Card>

      {/* Notification copy + real channel status */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">{t('notify.alertTriggered')} · {t('notify.digestSubject')}</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            {previews.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.id} · {p.channel}</p>
                <p className="mt-1 text-xs font-medium">{p.subject}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {DELIVERY_CHANNELS.map((ch) => (
              <div key={ch.id} className="flex items-start gap-2 p-2.5">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                  ch.status === 'live' ? 'bg-emerald-500/15 text-emerald-400'
                    : ch.status === 'needs-setup' ? 'bg-amber-400/15 text-amber-300'
                      : 'bg-muted text-muted-foreground'}`}
                >
                  {ch.status.toUpperCase()}
                </span>
                <div>
                  <p className="text-[11px] font-medium">{ch.label}</p>
                  <p className="text-[10px] text-muted-foreground">{ch.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">{t('notify.deliveryNote')}</p>
      </Card>

      {/* Rule types the checklist names that this build cannot evaluate, listed
          rather than hidden so nobody builds a rule that can never fire. */}
      <Card className="!p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle size={15} className="text-amber-400" /> Not Available In This Build
            <span className="text-xs font-normal text-muted-foreground">({UNAVAILABLE_RULES.length})</span>
          </p>
        </div>
        <div className="divide-y divide-border/60">
          {UNAVAILABLE_RULES.map((x) => (
            <div key={x.id} className="px-4 py-3">
              <p className="text-xs font-medium">{x.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{x.reason}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Sections 3–5: currency, time zone and location infrastructure. */}
      <CurrencyPanel />
      <TimePanel />
      <LocationPanel />
    </div>
  );
}
