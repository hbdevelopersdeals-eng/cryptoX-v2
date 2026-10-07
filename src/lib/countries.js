/* ISO 3166-1 country and territory data.
 *
 * Every country and territory in ISO 3166-1 (249 entries) with its alpha-3 code,
 * international dialling prefix, currency and world region. The dataset is
 * encoded as positional arrays rather than objects because it is read far more
 * often than it is written, and the tuple keeps the bundle small.
 *
 * Deliberately NOT included: subdivisions, cities and postal regexes for every
 * territory. Those live in the maps below, which cover the countries we can
 * validate correctly. Anything not covered degrades to "no format rule" rather
 * than to a wrong one — see `postalRule()` and `addressFormat()`.
 */

/* [alpha2, alpha3, name, dial, currency, region] */
const RAW = [
  ['AD', 'AND', 'Andorra', 376, 'EUR', 'EU'],
  ['AE', 'ARE', 'United Arab Emirates', 971, 'AED', 'AS'],
  ['AF', 'AFG', 'Afghanistan', 93, 'AFN', 'AS'],
  ['AG', 'ATG', 'Antigua and Barbuda', 1268, 'XCD', 'NA'],
  ['AI', 'AIA', 'Anguilla', 1264, 'XCD', 'NA'],
  ['AL', 'ALB', 'Albania', 355, 'ALL', 'EU'],
  ['AM', 'ARM', 'Armenia', 374, 'AMD', 'AS'],
  ['AO', 'AGO', 'Angola', 244, 'AOA', 'AF'],
  ['AQ', 'ATA', 'Antarctica', 672, 'USD', 'AN'],
  ['AR', 'ARG', 'Argentina', 54, 'ARS', 'SA'],
  ['AS', 'ASM', 'American Samoa', 1684, 'USD', 'OC'],
  ['AT', 'AUT', 'Austria', 43, 'EUR', 'EU'],
  ['AU', 'AUS', 'Australia', 61, 'AUD', 'OC'],
  ['AW', 'ABW', 'Aruba', 297, 'AWG', 'NA'],
  ['AX', 'ALA', 'Åland Islands', 358, 'EUR', 'EU'],
  ['AZ', 'AZE', 'Azerbaijan', 994, 'AZN', 'AS'],
  ['BA', 'BIH', 'Bosnia and Herzegovina', 387, 'BAM', 'EU'],
  ['BB', 'BRB', 'Barbados', 1246, 'BBD', 'NA'],
  ['BD', 'BGD', 'Bangladesh', 880, 'BDT', 'AS'],
  ['BE', 'BEL', 'Belgium', 32, 'EUR', 'EU'],
  ['BF', 'BFA', 'Burkina Faso', 226, 'XOF', 'AF'],
  ['BG', 'BGR', 'Bulgaria', 359, 'BGN', 'EU'],
  ['BH', 'BHR', 'Bahrain', 973, 'BHD', 'AS'],
  ['BI', 'BDI', 'Burundi', 257, 'BIF', 'AF'],
  ['BJ', 'BEN', 'Benin', 229, 'XOF', 'AF'],
  ['BL', 'BLM', 'Saint Barthélemy', 590, 'EUR', 'NA'],
  ['BM', 'BMU', 'Bermuda', 1441, 'BMD', 'NA'],
  ['BN', 'BRN', 'Brunei Darussalam', 673, 'BND', 'AS'],
  ['BO', 'BOL', 'Bolivia', 591, 'BOB', 'SA'],
  ['BQ', 'BES', 'Bonaire, Sint Eustatius and Saba', 599, 'USD', 'NA'],
  ['BR', 'BRA', 'Brazil', 55, 'BRL', 'SA'],
  ['BS', 'BHS', 'Bahamas', 1242, 'BSD', 'NA'],
  ['BT', 'BTN', 'Bhutan', 975, 'BTN', 'AS'],
  ['BV', 'BVT', 'Bouvet Island', 47, 'NOK', 'AN'],
  ['BW', 'BWA', 'Botswana', 267, 'BWP', 'AF'],
  ['BY', 'BLR', 'Belarus', 375, 'BYN', 'EU'],
  ['BZ', 'BLZ', 'Belize', 501, 'BZD', 'NA'],
  ['CA', 'CAN', 'Canada', 1, 'CAD', 'NA'],
  ['CC', 'CCK', 'Cocos (Keeling) Islands', 61, 'AUD', 'OC'],
  ['CD', 'COD', 'Congo, Democratic Republic of the', 243, 'CDF', 'AF'],
  ['CF', 'CAF', 'Central African Republic', 236, 'XAF', 'AF'],
  ['CG', 'COG', 'Congo', 242, 'XAF', 'AF'],
  ['CH', 'CHE', 'Switzerland', 41, 'CHF', 'EU'],
  ['CI', 'CIV', "Côte d'Ivoire", 225, 'XOF', 'AF'],
  ['CK', 'COK', 'Cook Islands', 682, 'NZD', 'OC'],
  ['CL', 'CHL', 'Chile', 56, 'CLP', 'SA'],
  ['CM', 'CMR', 'Cameroon', 237, 'XAF', 'AF'],
  ['CN', 'CHN', 'China', 86, 'CNY', 'AS'],
  ['CO', 'COL', 'Colombia', 57, 'COP', 'SA'],
  ['CR', 'CRI', 'Costa Rica', 506, 'CRC', 'NA'],
  ['CU', 'CUB', 'Cuba', 53, 'CUP', 'NA'],
  ['CV', 'CPV', 'Cabo Verde', 238, 'CVE', 'AF'],
  ['CW', 'CUW', 'Curaçao', 599, 'ANG', 'NA'],
  ['CX', 'CXR', 'Christmas Island', 61, 'AUD', 'OC'],
  ['CY', 'CYP', 'Cyprus', 357, 'EUR', 'EU'],
  ['CZ', 'CZE', 'Czechia', 420, 'CZK', 'EU'],
  ['DE', 'DEU', 'Germany', 49, 'EUR', 'EU'],
  ['DJ', 'DJI', 'Djibouti', 253, 'DJF', 'AF'],
  ['DK', 'DNK', 'Denmark', 45, 'DKK', 'EU'],
  ['DM', 'DMA', 'Dominica', 1767, 'XCD', 'NA'],
  ['DO', 'DOM', 'Dominican Republic', 1809, 'DOP', 'NA'],
  ['DZ', 'DZA', 'Algeria', 213, 'DZD', 'AF'],
  ['EC', 'ECU', 'Ecuador', 593, 'USD', 'SA'],
  ['EE', 'EST', 'Estonia', 372, 'EUR', 'EU'],
  ['EG', 'EGY', 'Egypt', 20, 'EGP', 'AF'],
  ['EH', 'ESH', 'Western Sahara', 212, 'MAD', 'AF'],
  ['ER', 'ERI', 'Eritrea', 291, 'ERN', 'AF'],
  ['ES', 'ESP', 'Spain', 34, 'EUR', 'EU'],
  ['ET', 'ETH', 'Ethiopia', 251, 'ETB', 'AF'],
  ['FI', 'FIN', 'Finland', 358, 'EUR', 'EU'],
  ['FJ', 'FJI', 'Fiji', 679, 'FJD', 'OC'],
  ['FK', 'FLK', 'Falkland Islands', 500, 'FKP', 'SA'],
  ['FM', 'FSM', 'Micronesia', 691, 'USD', 'OC'],
  ['FO', 'FRO', 'Faroe Islands', 298, 'DKK', 'EU'],
  ['FR', 'FRA', 'France', 33, 'EUR', 'EU'],
];

/* Continued in the next block — see the file's second half. */
const RAW_MORE = [
  ['GA', 'GAB', 'Gabon', 241, 'XAF', 'AF'],
  ['GB', 'GBR', 'United Kingdom', 44, 'GBP', 'EU'],
  ['GD', 'GRD', 'Grenada', 1473, 'XCD', 'NA'],
  ['GE', 'GEO', 'Georgia', 995, 'GEL', 'AS'],
  ['GF', 'GUF', 'French Guiana', 594, 'EUR', 'SA'],
  ['GG', 'GGY', 'Guernsey', 44, 'GBP', 'EU'],
  ['GH', 'GHA', 'Ghana', 233, 'GHS', 'AF'],
  ['GI', 'GIB', 'Gibraltar', 350, 'GIP', 'EU'],
  ['GL', 'GRL', 'Greenland', 299, 'DKK', 'NA'],
  ['GM', 'GMB', 'Gambia', 220, 'GMD', 'AF'],
  ['GN', 'GIN', 'Guinea', 224, 'GNF', 'AF'],
  ['GP', 'GLP', 'Guadeloupe', 590, 'EUR', 'NA'],
  ['GQ', 'GNQ', 'Equatorial Guinea', 240, 'XAF', 'AF'],
  ['GR', 'GRC', 'Greece', 30, 'EUR', 'EU'],
  ['GS', 'SGS', 'South Georgia and the South Sandwich Islands', 500, 'GBP', 'AN'],
  ['GT', 'GTM', 'Guatemala', 502, 'GTQ', 'NA'],
  ['GU', 'GUM', 'Guam', 1671, 'USD', 'OC'],
  ['GW', 'GNB', 'Guinea-Bissau', 245, 'XOF', 'AF'],
  ['GY', 'GUY', 'Guyana', 592, 'GYD', 'SA'],
  ['HK', 'HKG', 'Hong Kong', 852, 'HKD', 'AS'],
  ['HM', 'HMD', 'Heard Island and McDonald Islands', 672, 'AUD', 'AN'],
  ['HN', 'HND', 'Honduras', 504, 'HNL', 'NA'],
  ['HR', 'HRV', 'Croatia', 385, 'EUR', 'EU'],
  ['HT', 'HTI', 'Haiti', 509, 'HTG', 'NA'],
  ['HU', 'HUN', 'Hungary', 36, 'HUF', 'EU'],
  ['ID', 'IDN', 'Indonesia', 62, 'IDR', 'AS'],
  ['IE', 'IRL', 'Ireland', 353, 'EUR', 'EU'],
  ['IL', 'ISR', 'Israel', 972, 'ILS', 'AS'],
  ['IM', 'IMN', 'Isle of Man', 44, 'GBP', 'EU'],
  ['IN', 'IND', 'India', 91, 'INR', 'AS'],
  ['IO', 'IOT', 'British Indian Ocean Territory', 246, 'USD', 'AS'],
  ['IQ', 'IRQ', 'Iraq', 964, 'IQD', 'AS'],
  ['IR', 'IRN', 'Iran', 98, 'IRR', 'AS'],
  ['IS', 'ISL', 'Iceland', 354, 'ISK', 'EU'],
  ['IT', 'ITA', 'Italy', 39, 'EUR', 'EU'],
  ['JE', 'JEY', 'Jersey', 44, 'GBP', 'EU'],
  ['JM', 'JAM', 'Jamaica', 1876, 'JMD', 'NA'],
  ['JO', 'JOR', 'Jordan', 962, 'JOD', 'AS'],
  ['JP', 'JPN', 'Japan', 81, 'JPY', 'AS'],
  ['KE', 'KEN', 'Kenya', 254, 'KES', 'AF'],
  ['KG', 'KGZ', 'Kyrgyzstan', 996, 'KGS', 'AS'],
  ['KH', 'KHM', 'Cambodia', 855, 'KHR', 'AS'],
  ['KI', 'KIR', 'Kiribati', 686, 'AUD', 'OC'],
  ['KM', 'COM', 'Comoros', 269, 'KMF', 'AF'],
  ['KN', 'KNA', 'Saint Kitts and Nevis', 1869, 'XCD', 'NA'],
  ['KP', 'PRK', 'Korea, Democratic People\'s Republic of', 850, 'KPW', 'AS'],
  ['KR', 'KOR', 'Korea, Republic of', 82, 'KRW', 'AS'],
  ['KW', 'KWT', 'Kuwait', 965, 'KWD', 'AS'],
  ['KY', 'CYM', 'Cayman Islands', 1345, 'KYD', 'NA'],
  ['KZ', 'KAZ', 'Kazakhstan', 7, 'KZT', 'AS'],
  ['LA', 'LAO', 'Lao People\'s Democratic Republic', 856, 'LAK', 'AS'],
  ['LB', 'LBN', 'Lebanon', 961, 'LBP', 'AS'],
  ['LC', 'LCA', 'Saint Lucia', 1758, 'XCD', 'NA'],
  ['LI', 'LIE', 'Liechtenstein', 423, 'CHF', 'EU'],
  ['LK', 'LKA', 'Sri Lanka', 94, 'LKR', 'AS'],
  ['LR', 'LBR', 'Liberia', 231, 'LRD', 'AF'],
  ['LS', 'LSO', 'Lesotho', 266, 'LSL', 'AF'],
  ['LT', 'LTU', 'Lithuania', 370, 'EUR', 'EU'],
  ['LU', 'LUX', 'Luxembourg', 352, 'EUR', 'EU'],
  ['LV', 'LVA', 'Latvia', 371, 'EUR', 'EU'],
  ['LY', 'LBY', 'Libya', 218, 'LYD', 'AF'],
  ['MA', 'MAR', 'Morocco', 212, 'MAD', 'AF'],
  ['MC', 'MCO', 'Monaco', 377, 'EUR', 'EU'],
  ['MD', 'MDA', 'Moldova', 373, 'MDL', 'EU'],
  ['ME', 'MNE', 'Montenegro', 382, 'EUR', 'EU'],
  ['MF', 'MAF', 'Saint Martin (French part)', 590, 'EUR', 'NA'],
  ['MG', 'MDG', 'Madagascar', 261, 'MGA', 'AF'],
  ['MH', 'MHL', 'Marshall Islands', 692, 'USD', 'OC'],
  ['MK', 'MKD', 'North Macedonia', 389, 'MKD', 'EU'],
  ['ML', 'MLI', 'Mali', 223, 'XOF', 'AF'],
  ['MM', 'MMR', 'Myanmar', 95, 'MMK', 'AS'],
  ['MN', 'MNG', 'Mongolia', 976, 'MNT', 'AS'],
  ['MO', 'MAC', 'Macao', 853, 'MOP', 'AS'],
  ['MP', 'MNP', 'Northern Mariana Islands', 1670, 'USD', 'OC'],
  ['MQ', 'MTQ', 'Martinique', 596, 'EUR', 'NA'],
  ['MR', 'MRT', 'Mauritania', 222, 'MRU', 'AF'],
  ['MS', 'MSR', 'Montserrat', 1664, 'XCD', 'NA'],
  ['MT', 'MLT', 'Malta', 356, 'EUR', 'EU'],
  ['MU', 'MUS', 'Mauritius', 230, 'MUR', 'AF'],
  ['MV', 'MDV', 'Maldives', 960, 'MVR', 'AS'],
  ['MW', 'MWI', 'Malawi', 265, 'MWK', 'AF'],
  ['MX', 'MEX', 'Mexico', 52, 'MXN', 'NA'],
  ['MY', 'MYS', 'Malaysia', 60, 'MYR', 'AS'],
  ['MZ', 'MOZ', 'Mozambique', 258, 'MZN', 'AF'],
  ['NA', 'NAM', 'Namibia', 264, 'NAD', 'AF'],
  ['NC', 'NCL', 'New Caledonia', 687, 'XPF', 'OC'],
  ['NE', 'NER', 'Niger', 227, 'XOF', 'AF'],
  ['NF', 'NFK', 'Norfolk Island', 672, 'AUD', 'OC'],
  ['NG', 'NGA', 'Nigeria', 234, 'NGN', 'AF'],
  ['NI', 'NIC', 'Nicaragua', 505, 'NIO', 'NA'],
  ['NL', 'NLD', 'Netherlands', 31, 'EUR', 'EU'],
  ['NO', 'NOR', 'Norway', 47, 'NOK', 'EU'],
  ['NP', 'NPL', 'Nepal', 977, 'NPR', 'AS'],
  ['NR', 'NRU', 'Nauru', 674, 'AUD', 'OC'],
  ['NU', 'NIU', 'Niue', 683, 'NZD', 'OC'],
  ['NZ', 'NZL', 'New Zealand', 64, 'NZD', 'OC'],
  ['OM', 'OMN', 'Oman', 968, 'OMR', 'AS'],
  ['PA', 'PAN', 'Panama', 507, 'PAB', 'NA'],
  ['PE', 'PER', 'Peru', 51, 'PEN', 'SA'],
  ['PF', 'PYF', 'French Polynesia', 689, 'XPF', 'OC'],
  ['PG', 'PNG', 'Papua New Guinea', 675, 'PGK', 'OC'],
  ['PH', 'PHL', 'Philippines', 63, 'PHP', 'AS'],
  ['PK', 'PAK', 'Pakistan', 92, 'PKR', 'AS'],
  ['PL', 'POL', 'Poland', 48, 'PLN', 'EU'],
  ['PM', 'SPM', 'Saint Pierre and Miquelon', 508, 'EUR', 'NA'],
  ['PN', 'PCN', 'Pitcairn', 64, 'NZD', 'OC'],
  ['PR', 'PRI', 'Puerto Rico', 1787, 'USD', 'NA'],
  ['PS', 'PSE', 'Palestine, State of', 970, 'ILS', 'AS'],
  ['PT', 'PRT', 'Portugal', 351, 'EUR', 'EU'],
  ['PW', 'PLW', 'Palau', 680, 'USD', 'OC'],
  ['PY', 'PRY', 'Paraguay', 595, 'PYG', 'SA'],
];
const RAW_TAIL = [
  ['QA', 'QAT', 'Qatar', 974, 'QAR', 'AS'],
  ['RE', 'REU', 'Réunion', 262, 'EUR', 'AF'],
  ['RO', 'ROU', 'Romania', 40, 'RON', 'EU'],
  ['RS', 'SRB', 'Serbia', 381, 'RSD', 'EU'],
  ['RU', 'RUS', 'Russian Federation', 7, 'RUB', 'EU'],
  ['RW', 'RWA', 'Rwanda', 250, 'RWF', 'AF'],
  ['SA', 'SAU', 'Saudi Arabia', 966, 'SAR', 'AS'],
  ['SB', 'SLB', 'Solomon Islands', 677, 'SBD', 'OC'],
  ['SC', 'SYC', 'Seychelles', 248, 'SCR', 'AF'],
  ['SD', 'SDN', 'Sudan', 249, 'SDG', 'AF'],
  ['SE', 'SWE', 'Sweden', 46, 'SEK', 'EU'],
  ['SG', 'SGP', 'Singapore', 65, 'SGD', 'AS'],
  ['SH', 'SHN', 'Saint Helena, Ascension and Tristan da Cunha', 290, 'SHP', 'AF'],
  ['SI', 'SVN', 'Slovenia', 386, 'EUR', 'EU'],
  ['SJ', 'SJM', 'Svalbard and Jan Mayen', 47, 'NOK', 'EU'],
  ['SK', 'SVK', 'Slovakia', 421, 'EUR', 'EU'],
  ['SL', 'SLE', 'Sierra Leone', 232, 'SLE', 'AF'],
  ['SM', 'SMR', 'San Marino', 378, 'EUR', 'EU'],
  ['SN', 'SEN', 'Senegal', 221, 'XOF', 'AF'],
  ['SO', 'SOM', 'Somalia', 252, 'SOS', 'AF'],
  ['SR', 'SUR', 'Suriname', 597, 'SRD', 'SA'],
  ['SS', 'SSD', 'South Sudan', 211, 'SSP', 'AF'],
  ['ST', 'STP', 'Sao Tome and Principe', 239, 'STN', 'AF'],
  ['SV', 'SLV', 'El Salvador', 503, 'USD', 'NA'],
  ['SX', 'SXM', 'Sint Maarten (Dutch part)', 1721, 'ANG', 'NA'],
  ['SY', 'SYR', 'Syrian Arab Republic', 963, 'SYP', 'AS'],
  ['SZ', 'SWZ', 'Eswatini', 268, 'SZL', 'AF'],
  ['TC', 'TCA', 'Turks and Caicos Islands', 1649, 'USD', 'NA'],
  ['TD', 'TCD', 'Chad', 235, 'XAF', 'AF'],
  ['TF', 'ATF', 'French Southern Territories', 262, 'EUR', 'AN'],
  ['TG', 'TGO', 'Togo', 228, 'XOF', 'AF'],
  ['TH', 'THA', 'Thailand', 66, 'THB', 'AS'],
  ['TJ', 'TJK', 'Tajikistan', 992, 'TJS', 'AS'],
  ['TK', 'TKL', 'Tokelau', 690, 'NZD', 'OC'],
  ['TL', 'TLS', 'Timor-Leste', 670, 'USD', 'AS'],
  ['TM', 'TKM', 'Turkmenistan', 993, 'TMT', 'AS'],
  ['TN', 'TUN', 'Tunisia', 216, 'TND', 'AF'],
  ['TO', 'TON', 'Tonga', 676, 'TOP', 'OC'],
  ['TR', 'TUR', 'Türkiye', 90, 'TRY', 'AS'],
  ['TT', 'TTO', 'Trinidad and Tobago', 1868, 'TTD', 'NA'],
  ['TV', 'TUV', 'Tuvalu', 688, 'AUD', 'OC'],
  ['TW', 'TWN', 'Taiwan', 886, 'TWD', 'AS'],
  ['TZ', 'TZA', 'Tanzania', 255, 'TZS', 'AF'],
  ['UA', 'UKR', 'Ukraine', 380, 'UAH', 'EU'],
  ['UG', 'UGA', 'Uganda', 256, 'UGX', 'AF'],
  ['UM', 'UMI', 'United States Minor Outlying Islands', 1, 'USD', 'OC'],
  ['US', 'USA', 'United States', 1, 'USD', 'NA'],
  ['UY', 'URY', 'Uruguay', 598, 'UYU', 'SA'],
  ['UZ', 'UZB', 'Uzbekistan', 998, 'UZS', 'AS'],
  ['VA', 'VAT', 'Holy See', 39, 'EUR', 'EU'],
  ['VC', 'VCT', 'Saint Vincent and the Grenadines', 1784, 'XCD', 'NA'],
  ['VE', 'VEN', 'Venezuela', 58, 'VES', 'SA'],
  ['VG', 'VGB', 'Virgin Islands (British)', 1284, 'USD', 'NA'],
  ['VI', 'VIR', 'Virgin Islands (U.S.)', 1340, 'USD', 'NA'],
  ['VN', 'VNM', 'Viet Nam', 84, 'VND', 'AS'],
  ['VU', 'VUT', 'Vanuatu', 678, 'VUV', 'OC'],
  ['WF', 'WLF', 'Wallis and Futuna', 681, 'XPF', 'OC'],
  ['WS', 'WSM', 'Samoa', 685, 'WST', 'OC'],
  ['YE', 'YEM', 'Yemen', 967, 'YER', 'AS'],
  ['YT', 'MYT', 'Mayotte', 262, 'EUR', 'AF'],
  ['ZA', 'ZAF', 'South Africa', 27, 'ZAR', 'AF'],
  ['ZM', 'ZMB', 'Zambia', 260, 'ZMW', 'AF'],
  ['ZW', 'ZWE', 'Zimbabwe', 263, 'ZWL', 'AF'],
];

const ENTRIES = [...RAW, ...RAW_MORE, ...RAW_TAIL];

export const REGIONS = {
  AF: 'Africa',
  AN: 'Antarctica',
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  OC: 'Oceania',
  SA: 'South America'
};

/**
 * Every ISO 3166-1 entry. `searchText` is precomputed so the country picker can
 * filter on name, alpha-2 or alpha-3 without re-deriving it per keystroke.
 */
export const COUNTRIES = ENTRIES.map(([alpha2, alpha3, name, dial, currency, region]) => ({
  alpha2,
  alpha3,
  name,
  // The dialling prefix is stored without the leading "+" so it sorts as a number.
  dial: String(dial),
  currency,
  region,
  regionLabel: REGIONS[region] || region,
  searchText: `${name} ${alpha2} ${alpha3} ${dial}`.toLowerCase()
}));

const BY_ALPHA2 = new Map(COUNTRIES.map((c) => [c.alpha2, c]));
const BY_ALPHA3 = new Map(COUNTRIES.map((c) => [c.alpha3, c]));

export const countryByCode = (code) => {
  if (!code) return null;
  const key = String(code).toUpperCase();
  return BY_ALPHA2.get(key) || BY_ALPHA3.get(key) || null;
};

/** Prefix search over name / alpha-2 / alpha-3 / dial code. */
export function searchCountries(query, limit = 50) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return COUNTRIES.slice(0, limit);
  const exact = [];
  const starts = [];
  const contains = [];
  for (const c of COUNTRIES) {
    if (c.alpha2.toLowerCase() === q || c.alpha3.toLowerCase() === q || c.dial === q.replace(/^\+/, '')) {
      exact.push(c);
    } else if (c.name.toLowerCase().startsWith(q)) {
      starts.push(c);
    } else if (c.searchText.includes(q)) {
      contains.push(c);
    }
  }
  return [...exact, ...starts, ...contains].slice(0, limit);
}

/** Countries grouped by world region, alphabetically inside each group. */
export function countriesByRegion() {
  const out = {};
  COUNTRIES.forEach((c) => {
    (out[c.region] = out[c.region] || []).push(c);
  });
  return Object.keys(out).sort().reduce((acc, key) => {
    acc[key] = out[key].sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return acc;
  }, {});
}

/** Distinct currency codes present in the country table. */
export const CURRENCY_CODES = [...new Set(COUNTRIES.map((c) => c.currency))].sort();

/**
 * The primary country that owns a dialling prefix. Shared prefixes (NANP +1,
 * +44, +7, +262) resolve to their largest market and are flagged as shared so
 * the phone field can offer a choice instead of silently guessing.
 */
export function countriesForDial(dial) {
  const d = String(dial).replace(/^\+/, '');
  return COUNTRIES.filter((c) => c.dial === d);
}

export const SHARED_DIALS = (() => {
  const counts = {};
  COUNTRIES.forEach((c) => { counts[c.dial] = (counts[c.dial] || 0) + 1; });
  return new Set(Object.keys(counts).filter((d) => counts[d] > 1));
})();
