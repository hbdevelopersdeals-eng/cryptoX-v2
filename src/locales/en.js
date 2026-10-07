/* English — the source-of-truth catalog.
 *
 * Every other catalog mirrors this key set exactly. `translationKeys()` derives
 * the canonical list from this object, so a key added here is automatically
 * reported as missing in every other language rather than silently rendering
 * untranslated.
 *
 * Value shapes:
 *   'text'                      plain string, {placeholders} allowed
 *   { one: '…', other: '…' }    plural forms, selected by CLDR category
 *   { male: '…', female: '…' }  gender variants, selected by the `gender` var
 */

export default {
  'app.tagline': 'Real-time crypto markets, charting and trading lab',

  'nav.markets': 'Markets',
  'nav.marketIntel': 'Market Intelligence',
  'nav.dataSources': 'Data Sources',
  'nav.rsi': 'RSI Scanner',
  'nav.portfolio': 'Portfolio',
  'nav.watchlist': 'Watchlist',
  'nav.alerts': 'Alerts',
  'nav.tools': 'Trading & Tools',
  'nav.charting': 'Pro Charting',
  'nav.exchange': 'Exchange (Paper)',
  'nav.derivatives': 'Derivatives (Paper)',
  'nav.strategies': 'Strategy Engine',
  'nav.paper': 'Paper Trader',
  'nav.calculator': 'Calculator',
  'nav.news': 'Market Pulse',
  'nav.status': 'System Status',
  'nav.region': 'Region & Language',

  'common.signOut': 'Sign out',
  'common.search': 'Search coins',
  'common.language': 'Language',
  'common.currency': 'Currency',
  'common.live': 'Live',
  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.saved': 'Saved',
  'common.reset': 'Reset',
  'common.preview': 'Preview',
  'common.sample': 'Sample',

  'region.title': 'Region & Language',
  'region.subtitle': 'Country, language, formatting and measurement preferences',
  'region.country': 'Country or territory',
  'region.selectCountry': 'Select a country or territory',
  'region.searchCountry': 'Search by name, code or dialling prefix',
  'region.noResults': 'No countries match your search',
  'region.detected': 'Detected from your browser: {country}',
  'region.applyDetected': 'Use detected settings',
  'region.subdivision': 'State / province / region',
  'region.selectSubdivision': 'Select a state or province',
  'region.city': 'City',
  'region.selectCity': 'Select a city',
  'region.otherCity': 'Other — type it below',
  'region.cityName': 'City name',
  'region.postalCode': 'Postal code',
  'region.timeZone': 'Time zone',
  'region.measurement': 'Measurement system',
  'region.metric': 'Metric (kg, km, °C)',
  'region.imperial': 'Imperial (lb, mi, °F)',
  'region.numberFormat': 'Number format',
  'region.dateFormat': 'Date format',

  'lang.title': 'Language',
  'lang.interface': 'Interface language',
  'lang.detected': 'Detected from your browser',
  'lang.fallbackNote': 'Missing translations fall back to {fallback}',
  'lang.coverage': '{translated} of {total} strings translated ({percent}%)',
  'lang.draftNotice': 'This translation was machine-drafted and has not been reviewed by a native speaker.',
  'lang.reviewed': 'Reviewed by a native speaker',
  'lang.direction': 'Text direction',
  'lang.ltr': 'Left to right',
  'lang.rtl': 'Right to left',
  'lang.numbering': 'Digit style',
  'lang.sourceNote': 'English is the source language; all other catalogs fall back to it.',

  'address.title': 'Delivery address',
  'address.fullName': 'Full name',
  'address.line1': 'Address line 1',
  'address.line2': 'Address line 2 (optional)',
  'address.city': 'City',
  'address.state': 'State / province',
  'address.postal': 'Postal code',
  'address.country': 'Country',
  'address.preview': 'Formatted for {country}',
  'address.invalidPostal': 'That does not look like a valid postal code for {country}',
  'address.noPostalCode': '{country} does not use postal codes',
  'address.required': 'This field is required',

  'phone.title': 'Phone number',
  'phone.label': 'Phone number',
  'phone.countryCode': 'Country code',
  'phone.invalid': 'That does not look like a valid phone number for {country}',
  'phone.stored': 'Stored as {e164}',

  'number.sample': 'Sample',
  'number.decimalSeparator': 'Decimal separator',
  'number.thousandsSeparator': 'Thousands separator',
  'number.currency': 'Currency format',

  'plural.alertCount': { one: '{count} alert', other: '{count} alerts' },
  'plural.coinCount': { one: '{count} coin', other: '{count} coins' },
  'plural.itemCount': { one: '{count} item', other: '{count} items' },

  'gender.welcome': { male: 'Welcome back, sir', female: 'Welcome back, madam', other: 'Welcome back' },

  'seo.title': 'CryptoX — real-time crypto markets and analytics',
  'seo.description': 'Live crypto prices, pro charting, derivatives analytics and a paper trading lab.',
  'seo.hreflang': 'This page declares {count} language alternates',

  'notify.alertTriggered': 'Alert triggered',
  'notify.priceAbove': '{symbol} rose above {price}',
  'notify.digestSubject': 'Your CryptoX market digest',
  'notify.digestBody': 'Here is what moved while you were away, {name}.',
  'notify.deliveryNote': 'In-app delivery works now. Email, SMS and messaging need a server-side key.'
};
