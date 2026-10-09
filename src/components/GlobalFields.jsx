import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';
import { COUNTRIES, countryByCode, searchCountries } from '../lib/countries.js';
import { parsePhone, sanitiseInput, formatNational } from '../lib/phone.js';

/*
 * A searchable country picker.
 *
 * The native <select> with 249 options is unusable on a phone, so this is a
 * combobox: type to filter on name, ISO alpha-2, alpha-3 or dialling prefix.
 * Keyboard support follows the ARIA combobox pattern (Down/Up to move,
 * Enter to choose, Escape to close).
 */
export function CountrySelect({
  value,
  onChange,
  label,
  id = 'country-select',
  placeholder,
  compact = false
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);

  const selected = countryByCode(value);
  const results = useMemo(() => searchCountries(query, 300), [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  const choose = (code) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && results[active]) {
        e.preventDefault();
        choose(results[active].alpha2);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      {label ? <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={id}>{label}</label> : null}
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-list`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`input-dark flex w-full items-center justify-between gap-2 text-left ${compact ? '!h-9 !text-[12px]' : '!h-10'}`}
      >
        <span className="truncate">
          {selected ? (
            <>
              <span className="font-mono text-[11px] text-muted-foreground">{selected.alpha2}</span>
              <span className="ml-2">{compact ? selected.name : `${selected.name} · +${selected.dial}`}</span>
            </>
          ) : (placeholder || t('region.selectCountry'))}
        </span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={13} className="text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('region.searchCountry')}
              aria-label={t('region.searchCountry')}
              className="w-full bg-transparent text-xs outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary placeholder:text-muted-foreground"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label={t('common.reset')}>
                <X size={13} className="text-muted-foreground" />
              </button>
            ) : null}
          </div>
          <ul id={`${id}-list`} role="listbox" className="max-h-72 overflow-auto py-1">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">{t('region.noResults')}</li>
            ) : results.map((c, i) => (
              <li key={c.alpha2} role="option" aria-selected={c.alpha2 === value}>
                <button
                  type="button"
                  onClick={() => choose(c.alpha2)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${i === active ? 'bg-accent' : ''}`}
                >
                  <span className="font-mono text-[10px] text-muted-foreground">{c.alpha2}</span>
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">+{c.dial}</span>
                  {c.alpha2 === value ? <Check size={12} className="text-primary" /> : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
            {COUNTRIES.length} countries and territories
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Phone entry that stores E.164.
 *
 * Validation is deliberately three-state: valid, invalid, and "cannot tell".
 * A country without a known numbering-length rule shows a neutral note instead
 * of a red error, because rejecting a correct number is worse than accepting a
 * malformed one.
 */
export function PhoneField({ value, onChange, region, label, id = 'phone' }) {
  const { t } = useI18n();
  const parsed = useMemo(() => parsePhone(value, region), [value, region]);

  const state = !value
    ? 'empty'
    : parsed.valid ? 'valid'
      : parsed.confident === false ? 'unknown' : 'invalid';

  const tone = {
    empty: 'text-muted-foreground',
    valid: 'text-emerald-400',
    unknown: 'text-amber-300',
    invalid: 'text-down'
  }[state];

  const country = countryByCode(region);

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={id}>
        {label || t('phone.label')}
      </label>
      <div className="flex items-stretch gap-2">
        <span className="flex h-10 shrink-0 items-center rounded-lg border border-border bg-muted/40 px-2.5 font-mono text-xs text-muted-foreground">
          {country ? `+${country.dial}` : t('phone.countryCode')}
        </span>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          value={value || ''}
          onChange={(e) => onChange(sanitiseInput(e.target.value))}
          placeholder={country?.alpha2 === 'US' ? '(415) 555-2671' : '300 1234567'}
          aria-invalid={state === 'invalid'}
          className="input-dark !h-10 w-full"
        />
      </div>

      <p className={`mt-1.5 text-[11px] ${tone}`} role="status">
        {state === 'valid' ? t('phone.stored', { e164: parsed.e164 }) : null}
        {state === 'invalid' ? t('phone.invalid', { country: country?.name || '' }) : null}
        {state === 'unknown' ? `${parsed.e164} · no length rule for ${country?.name || region}` : null}
        {state === 'empty' && parsed.national ? null : null}
      </p>

      {state === 'valid' && parsed.national ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatNational(parsed.e164, parsed.region)}
        </p>
      ) : null}
    </div>
  );
}
