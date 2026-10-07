/* ISO 4217 currency data.
 *
 * `code -> [numeric, name, symbol, decimals]`. The country list is NOT duplicated
 * here: every country in countries.js already carries its currency, so
 * `countriesForCurrency` inverts that table. One source of truth, no drift.
 *
 * `symbol` is the conventional glyph. Where a currency has no distinct glyph we
 * store its code, because inventing a symbol is worse than showing the code.
 * `decimals` is the ISO minor-unit exponent — JPY has 0, KWD has 3, CLF has 4.
 */

import { COUNTRIES } from './countries.js';

/* The ISO 4217 minor-unit exponent, explicitly. Anything absent defaults to 2. */
export const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF', 'XAG', 'XAU', 'XPT', 'XPD'
]);

export const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export const FOUR_DECIMAL = new Set(['CLF', 'UYW']);

/* [code, numeric, name, symbol] */
const RAW = [
  ['AED', '784', 'UAE Dirham', 'د.إ'], ['AFN', '971', 'Afghan Afghani', '؋'],
  ['ALL', '008', 'Albanian Lek', 'L'], ['AMD', '051', 'Armenian Dram', '֏'],
  ['ANG', '532', 'Netherlands Antillean Guilder', 'ƒ'], ['AOA', '973', 'Angolan Kwanza', 'Kz'],
  ['ARS', '032', 'Argentine Peso', 'AR$'], ['AUD', '036', 'Australian Dollar', 'A$'],
  ['AWG', '533', 'Aruban Florin', 'ƒ'], ['AZN', '944', 'Azerbaijani Manat', '₼'],
  ['BAM', '977', 'Bosnia-Herzegovina Convertible Mark', 'KM'], ['BBD', '052', 'Barbadian Dollar', 'Bds$'],
  ['BDT', '050', 'Bangladeshi Taka', '৳'], ['BGN', '975', 'Bulgarian Lev', 'лв'],
  ['BHD', '048', 'Bahraini Dinar', 'د.ب'], ['BIF', '108', 'Burundian Franc', 'FBu'],
  ['BMD', '060', 'Bermudan Dollar', 'BD$'], ['BND', '096', 'Brunei Dollar', 'B$'],
  ['BOB', '068', 'Bolivian Boliviano', 'Bs'], ['BRL', '986', 'Brazilian Real', 'R$'],
  ['BSD', '044', 'Bahamian Dollar', 'B$'], ['BTN', '064', 'Bhutanese Ngultrum', 'Nu.'],
  ['BWP', '072', 'Botswanan Pula', 'P'], ['BYN', '933', 'Belarusian Ruble', 'Br'],
  ['BZD', '084', 'Belize Dollar', 'BZ$'], ['CAD', '124', 'Canadian Dollar', 'C$'],
  ['CDF', '976', 'Congolese Franc', 'FC'], ['CHF', '756', 'Swiss Franc', 'CHF'],
  ['CLP', '152', 'Chilean Peso', 'CL$'], ['CNY', '156', 'Chinese Yuan', '¥'],
  ['COP', '170', 'Colombian Peso', 'CO$'], ['CRC', '188', 'Costa Rican Colón', '₡'],
  ['CUP', '192', 'Cuban Peso', '₱'], ['CVE', '132', 'Cape Verdean Escudo', 'Esc'],
  ['CZK', '203', 'Czech Koruna', 'Kč'], ['DJF', '262', 'Djiboutian Franc', 'Fdj'],
  ['DKK', '208', 'Danish Krone', 'kr'], ['DOP', '214', 'Dominican Peso', 'RD$'],
  ['DZD', '012', 'Algerian Dinar', 'د.ج'], ['EGP', '818', 'Egyptian Pound', 'E£'],
  ['ERN', '232', 'Eritrean Nakfa', 'Nfk'], ['ETB', '230', 'Ethiopian Birr', 'Br'],
  ['EUR', '978', 'Euro', '€'], ['FJD', '242', 'Fijian Dollar', 'FJ$'],
  ['FKP', '238', 'Falkland Islands Pound', 'FK£'], ['GBP', '826', 'British Pound', '£'],
  ['GEL', '981', 'Georgian Lari', '₾'], ['GHS', '936', 'Ghanaian Cedi', '₵'],
  ['GIP', '292', 'Gibraltar Pound', 'GI£'], ['GMD', '270', 'Gambian Dalasi', 'D'],
  ['GNF', '324', 'Guinean Franc', 'FG'], ['GTQ', '320', 'Guatemalan Quetzal', 'Q'],
  ['GYD', '328', 'Guyanaese Dollar', 'GY$'], ['HKD', '344', 'Hong Kong Dollar', 'HK$'],
  ['HNL', '340', 'Honduran Lempira', 'L'], ['HTG', '332', 'Haitian Gourde', 'G'],
  ['HUF', '348', 'Hungarian Forint', 'Ft'], ['IDR', '360', 'Indonesian Rupiah', 'Rp'],
  ['ILS', '376', 'Israeli New Shekel', '₪'], ['INR', '356', 'Indian Rupee', '₹'],
  ['IQD', '368', 'Iraqi Dinar', 'د.ع'], ['IRR', '364', 'Iranian Rial', '﷼'],
  ['ISK', '352', 'Icelandic Króna', 'kr'], ['JMD', '388', 'Jamaican Dollar', 'J$'],
  ['JOD', '400', 'Jordanian Dinar', 'د.ا'], ['JPY', '392', 'Japanese Yen', '¥'],
  ['KES', '404', 'Kenyan Shilling', 'KSh'], ['KGS', '417', 'Kyrgystani Som', 'с'],
  ['KHR', '116', 'Cambodian Riel', '៛'], ['KMF', '174', 'Comorian Franc', 'CF'],
  ['KPW', '408', 'North Korean Won', '₩'], ['KRW', '410', 'South Korean Won', '₩'],
  ['KWD', '414', 'Kuwaiti Dinar', 'د.ك'], ['KYD', '136', 'Cayman Islands Dollar', 'CI$'],
  ['KZT', '398', 'Kazakhstani Tenge', '₸'], ['LAK', '418', 'Laotian Kip', '₭'],
  ['LBP', '422', 'Lebanese Pound', 'ل.ل'], ['LKR', '144', 'Sri Lankan Rupee', 'Rs'],
  ['LRD', '430', 'Liberian Dollar', 'L$'], ['LSL', '426', 'Lesotho Loti', 'L'],
  ['LYD', '434', 'Libyan Dinar', 'ل.د'], ['MAD', '504', 'Moroccan Dirham', 'د.م.'],
  ['MDL', '498', 'Moldovan Leu', 'L'], ['MGA', '969', 'Malagasy Ariary', 'Ar'],
  ['MKD', '807', 'Macedonian Denar', 'ден'], ['MMK', '104', 'Myanmar Kyat', 'K'],
  ['MNT', '496', 'Mongolian Tugrik', '₮'], ['MOP', '446', 'Macanese Pataca', 'MOP$'],
  ['MRU', '929', 'Mauritanian Ouguiya', 'UM'], ['MUR', '480', 'Mauritian Rupee', '₨'],
  ['MVR', '462', 'Maldivian Rufiyaa', 'Rf'], ['MWK', '454', 'Malawian Kwacha', 'MK'],
  ['MXN', '484', 'Mexican Peso', 'MX$'], ['MYR', '458', 'Malaysian Ringgit', 'RM'],
  ['MZN', '943', 'Mozambican Metical', 'MT'], ['NAD', '516', 'Namibian Dollar', 'N$'],
  ['NGN', '566', 'Nigerian Naira', '₦'], ['NIO', '558', 'Nicaraguan Córdoba', 'C$'],
  ['NOK', '578', 'Norwegian Krone', 'kr'], ['NPR', '524', 'Nepalese Rupee', '₨'],
  ['NZD', '554', 'New Zealand Dollar', 'NZ$'], ['OMR', '512', 'Omani Rial', 'ر.ع.'],
  ['PAB', '590', 'Panamanian Balboa', 'B/.'], ['PEN', '604', 'Peruvian Sol', 'S/'],
  ['PGK', '598', 'Papua New Guinean Kina', 'K'], ['PHP', '608', 'Philippine Peso', '₱'],
  ['PKR', '586', 'Pakistani Rupee', '₨'], ['PLN', '985', 'Polish Zloty', 'zł'],
  ['PYG', '600', 'Paraguayan Guarani', '₲'], ['QAR', '634', 'Qatari Rial', 'ر.ق'],
  ['RON', '946', 'Romanian Leu', 'lei'], ['RSD', '941', 'Serbian Dinar', 'дин'],
  ['RUB', '643', 'Russian Ruble', '₽'], ['RWF', '646', 'Rwandan Franc', 'FRw'],
  ['SAR', '682', 'Saudi Riyal', 'ر.س'], ['SBD', '090', 'Solomon Islands Dollar', 'SI$'],
  ['SCR', '690', 'Seychellois Rupee', '₨'], ['SDG', '938', 'Sudanese Pound', 'ج.س'],
  ['SEK', '752', 'Swedish Krona', 'kr'], ['SGD', '702', 'Singapore Dollar', 'S$'],
  ['SHP', '654', 'Saint Helena Pound', 'SH£'], ['SLE', '925', 'Sierra Leonean Leone', 'Le'],
  ['SOS', '706', 'Somali Shilling', 'Sh'], ['SRD', '968', 'Surinamese Dollar', 'SR$'],
  ['SSP', '728', 'South Sudanese Pound', 'SS£'], ['STN', '930', 'São Tomé and Príncipe Dobra', 'Db'],
  ['SVC', '222', 'Salvadoran Colón', '₡'], ['SYP', '760', 'Syrian Pound', 'S£'],
  ['SZL', '748', 'Swazi Lilangeni', 'E'], ['THB', '764', 'Thai Baht', '฿'],
  ['TJS', '972', 'Tajikistani Somoni', 'ЅМ'], ['TMT', '934', 'Turkmenistani Manat', 'm'],
  ['TND', '788', 'Tunisian Dinar', 'د.ت'], ['TOP', '776', 'Tongan Paʻanga', 'T$'],
  ['TRY', '949', 'Turkish Lira', '₺'], ['TTD', '780', 'Trinidad and Tobago Dollar', 'TT$'],
  ['TWD', '901', 'New Taiwan Dollar', 'NT$'], ['TZS', '834', 'Tanzanian Shilling', 'TSh'],
  ['UAH', '980', 'Ukrainian Hryvnia', '₴'], ['UGX', '800', 'Ugandan Shilling', 'USh'],
  ['USD', '840', 'US Dollar', '$'], ['UYU', '858', 'Uruguayan Peso', '$U'],
  ['UZS', '860', 'Uzbekistani Som', 'soʻm'], ['VES', '928', 'Venezuelan Bolívar', 'Bs'],
  ['VND', '704', 'Vietnamese Dong', '₫'], ['VUV', '548', 'Vanuatu Vatu', 'VT'],
  ['WST', '882', 'Samoan Tala', 'WS$'], ['XAF', '950', 'Central African CFA Franc', 'FCFA'],
  ['XCD', '951', 'East Caribbean Dollar', 'EC$'], ['XOF', '952', 'West African CFA Franc', 'CFA'],
  ['XPF', '953', 'CFP Franc', '₣'], ['YER', '886', 'Yemeni Rial', '﷼'],
  ['ZAR', '710', 'South African Rand', 'R'], ['ZMW', '967', 'Zambian Kwacha', 'ZK'],
  ['ZWL', '932', 'Zimbabwean Dollar', 'Z$'],
  // Metals and funds, quoted with no minor unit.
  ['XAG', '961', 'Silver', 'XAG'], ['XAU', '959', 'Gold', 'XAU'], ['XDR', '960', 'IMF Special Drawing Rights', 'XDR']
];

export const decimalsFor = (code) => {
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  if (FOUR_DECIMAL.has(code)) return 4;
  return 2;
};

export const CURRENCIES = RAW.map(([code, numeric, name, symbol]) => ({
  code,
  numeric,
  name,
  symbol,
  decimals: decimalsFor(code),
  searchText: `${code} ${numeric} ${name}`.toLowerCase()
}));

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** A currency, or null. Never silently substitutes another currency. */
export const currencyByCode = (code) =>
  (typeof code === 'string' ? BY_CODE.get(code.toUpperCase()) : null) || null;

export const isKnownCurrency = (code) => !!currencyByCode(code);

/**
 * The conventional glyph for a currency, for badges and labels that are NOT
 * passed through Intl.NumberFormat. Formatted amounts should let Intl decide:
 * CLDR writes some currencies as their code (PKR, CHF) because the glyph is
 * ambiguous or absent, and Intl also handles placement per locale.
 */
export const symbolFor = (code) => currencyByCode(code)?.symbol || code || '';

/** Currencies a country's residents actually use. */
export const currenciesForCountry = (region) =>
  [...new Set(COUNTRIES.filter((c) => c.alpha2 === region).map((c) => c.currency))]
    .filter((code) => BY_CODE.has(code));

/** The primary currency for a country, or USD when the country is unknown. */
export const defaultCurrencyFor = (region) => currenciesForCountry(region)[0] || 'USD';

/** Every country and territory whose primary currency is this code. */
export const countriesForCurrency = (code) =>
  COUNTRIES.filter((c) => c.currency === code).map((c) => c.alpha2).sort();

export function searchCurrencies(query, limit = 60) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return CURRENCIES.slice(0, limit);
  const exact = [];
  const starts = [];
  const contains = [];
  for (const c of CURRENCIES) {
    if (c.code.toLowerCase() === q) exact.push(c);
    else if (c.code.toLowerCase().startsWith(q) || c.name.toLowerCase().startsWith(q)) starts.push(c);
    else if (c.searchText.includes(q)) contains.push(c);
  }
  return [...exact, ...starts, ...contains].slice(0, limit);
}

/**
 * The currency's name in a language, from the platform's own language list.
 * Intl.DisplayNames covers most of the 25 launch languages; when it cannot
 * answer we return the English name rather than an ISO code.
 */
export function currencyName(code, lang = 'en') {
  const entry = currencyByCode(code);
  if (!entry) return code;
  try {
    const dn = new Intl.DisplayNames([lang], { type: 'currency' });
    return dn.of(code) || entry.name;
  } catch {
    return entry.name;
  }
}

/** Format a number of minor units back into a major-unit decimal. */
export const fromMinorUnits = (amount, code) => {
  const d = decimalsFor(code);
  return d === 0 ? Number(amount) : Number(amount) / 10 ** d;
};

/** Convert a major-unit amount into integer minor units, the safe settlement form. */
export const toMinorUnits = (amount, code) => Math.round(Number(amount) * 10 ** decimalsFor(code));
