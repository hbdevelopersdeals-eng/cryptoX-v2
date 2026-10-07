/* Country-aware postal, subdivision and address formatting.
 *
 * Coverage policy: we validate only where we know the real rule. A country with
 * no entry degrades to "no format rule" — it never gets a guessed pattern, and
 * it is never told its address is invalid. Guessing a postal regex would reject
 * valid addresses, which is worse than accepting a malformed one.
 */

/* ---------------------------------------------------------------------------
 * Postal codes
 * ------------------------------------------------------------------------ */

/** Countries that do not use postal codes at all. */
export const NO_POSTAL_CODES = new Set([
  'AE', 'AG', 'AN', 'AO', 'AW', 'BF', 'BI', 'BJ', 'BO', 'BS', 'BW', 'BZ', 'CD',
  'CF', 'CG', 'CK', 'CM', 'CO', 'CR', 'CV', 'DJ', 'DM', 'EC', 'ER', 'FJ', 'GA',
  'GD', 'GH', 'GM', 'GN', 'GQ', 'GT', 'GY', 'HK', 'JM', 'KE', 'KI', 'KM', 'KP',
  'LA', 'LY', 'ML', 'MO', 'MR', 'MW', 'NA', 'NR', 'NU', 'PA', 'QA', 'RW', 'SB',
  'SC', 'SL', 'SO', 'SR', 'ST', 'SY', 'TF', 'TK', 'TL', 'TO', 'TT', 'TV', 'TZ',
  'UG', 'VU', 'YE', 'ZW'
]);

/* `p` is anchored and tested against the uppercased, space-stripped value.
 * `fmt` documents the canonical shape for the input hint. */
export const POSTAL_RULES = {
  US: { p: /^\d{5}(-\d{4})?$/, fmt: '12345 or 12345-6789', label: 'ZIP code' },
  CA: { p: /^[A-Z]\d[A-Z]\d[A-Z]\d$/, fmt: 'A1A 1A1', label: 'Postal code' },
  GB: { p: /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/, fmt: 'SW1A 1AA', label: 'Postcode' },
  IE: { p: /^[A-Z]\d{2}[A-Z\d]{4}$/, fmt: 'D02 X285', label: 'Eircode' },
  DE: { p: /^\d{5}$/, fmt: '10115', label: 'Postleitzahl' },
  FR: { p: /^\d{5}$/, fmt: '75001', label: 'Code postal' },
  IT: { p: /^\d{5}$/, fmt: '00118', label: 'CAP' },
  ES: { p: /^\d{5}$/, fmt: '28001', label: 'Código postal' },
  PT: { p: /^\d{4}-\d{3}$/, fmt: '1000-001', label: 'Código postal' },
  NL: { p: /^\d{4}[A-Z]{2}$/, fmt: '1011 AB', label: 'Postcode' },
  BE: { p: /^\d{4}$/, fmt: '1000', label: 'Postcode' },
  AT: { p: /^\d{4}$/, fmt: '1010', label: 'Postleitzahl' },
  CH: { p: /^\d{4}$/, fmt: '8001', label: 'Postleitzahl' },
  DK: { p: /^\d{4}$/, fmt: '1050', label: 'Postnummer' },
  NO: { p: /^\d{4}$/, fmt: '0150', label: 'Postnummer' },
  SE: { p: /^\d{3}\d{2}$/, fmt: '111 22', label: 'Postnummer' },
  FI: { p: /^\d{5}$/, fmt: '00100', label: 'Postinumero' },
  PL: { p: /^\d{2}-\d{3}$/, fmt: '00-001', label: 'Kod pocztowy' },
  CZ: { p: /^\d{3}\d{2}$/, fmt: '110 00', label: 'PSČ' },
  SK: { p: /^\d{3}\d{2}$/, fmt: '811 01', label: 'PSČ' },
  HU: { p: /^\d{4}$/, fmt: '1011', label: 'Irányítószám' },
  RO: { p: /^\d{6}$/, fmt: '010011', label: 'Cod poștal' },
  GR: { p: /^\d{3}\d{2}$/, fmt: '105 58', label: 'Ταχυδρομικός κώδικας' },
  RU: { p: /^\d{6}$/, fmt: '101000', label: 'Почтовый индекс' },
  UA: { p: /^\d{5}$/, fmt: '01001', label: 'Поштовий індекс' },
  TR: { p: /^\d{5}$/, fmt: '06050', label: 'Posta kodu' },
  IN: { p: /^\d{6}$/, fmt: '110001', label: 'PIN code' },
  PK: { p: /^\d{5}$/, fmt: '44000', label: 'Postal code' },
  BD: { p: /^\d{4}$/, fmt: '1000', label: 'Postal code' },
  LK: { p: /^\d{5}$/, fmt: '00100', label: 'Postal code' },
  NP: { p: /^\d{5}$/, fmt: '44600', label: 'Postal code' },
  CN: { p: /^\d{6}$/, fmt: '100000', label: '邮政编码' },
  JP: { p: /^\d{3}-\d{4}$/, fmt: '100-0001', label: '郵便番号' },
  KR: { p: /^\d{5}$/, fmt: '03051', label: '우편번호' },
  TW: { p: /^\d{3}(\d{2})?$/, fmt: '100 or 10001', label: '郵遞區號' },
  SG: { p: /^\d{6}$/, fmt: '018956', label: 'Postal code' },
  MY: { p: /^\d{5}$/, fmt: '50000', label: 'Postcode' },
  ID: { p: /^\d{5}$/, fmt: '10110', label: 'Kode pos' },
  TH: { p: /^\d{5}$/, fmt: '10110', label: 'รหัสไปรษณีย์' },
  VN: { p: /^\d{6}$/, fmt: '100000', label: 'Mã bưu chính' },
  PH: { p: /^\d{4}$/, fmt: '1000', label: 'ZIP code' },
  AU: { p: /^\d{4}$/, fmt: '2000', label: 'Postcode' },
  NZ: { p: /^\d{4}$/, fmt: '6011', label: 'Postcode' },
  BR: { p: /^\d{5}-?\d{3}$/, fmt: '01310-100', label: 'CEP' },
  MX: { p: /^\d{5}$/, fmt: '06000', label: 'Código postal' },
  AR: { p: /^[A-Z]?\d{4}[A-Z]{0,3}$/, fmt: 'C1425ABC', label: 'Código postal' },
  CL: { p: /^\d{7}$/, fmt: '8320000', label: 'Código postal' },
  ZA: { p: /^\d{4}$/, fmt: '0001', label: 'Postal code' },
  NG: { p: /^\d{6}$/, fmt: '100001', label: 'Postal code' },
  EG: { p: /^\d{5}$/, fmt: '11511', label: 'Postal code' },
  SA: { p: /^\d{5}(-\d{4})?$/, fmt: '11564', label: 'Postal code' },
  IL: { p: /^\d{5,7}$/, fmt: '6100001', label: 'Postal code' },
  IR: { p: /^\d{5}-?\d{5}$/, fmt: '11369-43131', label: 'کد پستی' }
};

/** The validation rule for a country, or null when we have no rule. */
export const postalRule = (region) => POSTAL_RULES[region] || null;

export const usesPostalCodes = (region) => !!region && !NO_POSTAL_CODES.has(region);

/**
 * Validate a postal code.
 * Returns { ok, reason } where ok is null when the country has no rule —
 * null means "we cannot judge this", which the UI must not render as an error.
 */
export function validatePostal(region, value) {
  if (!region) return { ok: null, reason: 'no-region' };
  if (NO_POSTAL_CODES.has(region)) return { ok: false, reason: 'country-uses-no-postal-codes' };
  const rule = POSTAL_RULES[region];
  if (!rule) return { ok: null, reason: 'no-rule-for-country' };
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const normalised = raw.toUpperCase().replace(/\s+/g, '');
  return { ok: rule.p.test(normalised), reason: rule.p.test(normalised) ? 'valid' : 'format-mismatch' };
}

/* ---------------------------------------------------------------------------
 * Address formats
 * ------------------------------------------------------------------------ */

/**
 * Line templates per country. Field keys map to the address form, and a comma
 * inside a line means "join with the locale's list separator".
 * `postalFirst` marks the East-Asian order where the postcode leads.
 */
const FORMATS = {
  us: { lines: [['name'], ['line1'], ['line2'], ['city', 'state', 'postal'], ['country']] },
  ca: { lines: [['name'], ['line1'], ['line2'], ['city', 'state', 'postal'], ['country']] },
  au: { lines: [['name'], ['line1'], ['line2'], ['city', 'state', 'postal'], ['country']] },
  nz: { lines: [['name'], ['line1'], ['line2'], ['city', 'postal'], ['country']] },
  gb: { lines: [['name'], ['line1'], ['line2'], ['city'], ['postal'], ['country']] },
  ie: { lines: [['name'], ['line1'], ['line2'], ['city'], ['state', 'postal'], ['country']] },
  de: { lines: [['name'], ['line1'], ['line2'], ['postal', 'city'], ['country']] },
  fr: { lines: [['name'], ['line1'], ['line2'], ['postal', 'city'], ['country']] },
  nl: { lines: [['name'], ['line1'], ['line2'], ['postal', 'city'], ['country']] },
  eu: { lines: [['name'], ['line1'], ['line2'], ['postal', 'city'], ['country']] },
  es: { lines: [['name'], ['line1'], ['line2'], ['postal', 'city'], ['country']] },
  it: { lines: [['name'], ['line1'], ['line2'], ['postal', 'city', 'state'], ['country']] },
  pl: { lines: [['name'], ['line1'], ['line2'], ['postal', 'city'], ['country']] },
  ru: { lines: [['name'], ['line1'], ['line2'], ['postal', 'city', 'state'], ['country']] },
  in: { lines: [['name'], ['line1'], ['line2'], ['city', 'state', 'postal'], ['country']] },
  pk: { lines: [['name'], ['line1'], ['line2'], ['city', 'state', 'postal'], ['country']] },
  latam: { lines: [['name'], ['line1'], ['line2'], ['postal', 'city', 'state'], ['country']] },
  jp: { lines: [['country'], ['postal'], ['state', 'city'], ['line1'], ['line2'], ['name']] },
  cn: { lines: [['country'], ['postal'], ['state', 'city'], ['line1'], ['line2'], ['name']] },
  kr: { lines: [['country'], ['postal'], ['state', 'city'], ['line1'], ['line2'], ['name']] },
  tw: { lines: [['country'], ['postal'], ['state', 'city'], ['line1'], ['line2'], ['name']] },
  sg: { lines: [['name'], ['line1'], ['line2'], ['city', 'postal'], ['country']] },
  ae: { lines: [['name'], ['line1'], ['line2'], ['city', 'state'], ['country']] }
};

const FORMAT_FOR = {
  US: 'us', CA: 'ca', AU: 'au', NZ: 'nz', GB: 'gb', IE: 'ie',
  DE: 'de', FR: 'fr', NL: 'nl', BE: 'nl', AT: 'de', CH: 'de', LU: 'nl',
  ES: 'es', IT: 'it', PT: 'es', PL: 'pl', RU: 'ru', UA: 'ru', BY: 'ru',
  IN: 'in', PK: 'pk', BD: 'in', LK: 'in', NP: 'in',
  MX: 'latam', BR: 'latam', AR: 'latam', CL: 'latam', CO: 'latam', PE: 'latam',
  JP: 'jp', CN: 'cn', KR: 'kr', TW: 'tw', SG: 'sg', MY: 'sg',
  AE: 'ae', SA: 'ae', QA: 'ae', KW: 'ae', BH: 'ae', OM: 'ae'
};

/** Countries using the EU postal-before-city convention. */
const EU_DEFAULT = new Set([
  'DK', 'NO', 'SE', 'FI', 'IS', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'EE',
  'LV', 'LT', 'GR', 'MT', 'CY'
]);
EU_DEFAULT.forEach((r) => { FORMAT_FOR[r] = FORMAT_FOR[r] || 'eu'; });

export const addressFormat = (region) => {
  const key = FORMAT_FOR[region] || 'us';
  return { key, lines: FORMATS[key].lines };
};

/** Does this country write the postcode on the same line as the city? */
export const postalOnCityLine = (region) => {
  const { lines } = addressFormat(region);
  return lines.some((line) => line.includes('postal') && line.length > 1);
};

/**
 * Render an address using the country's convention.
 * Empty fields are dropped rather than leaving stray commas. Returns an array
 * of lines; joining is left to the caller so it can use <br> or a textarea.
 */
export function formatAddress(parts = {}, region = 'US') {
  const { lines } = addressFormat(region);
  const value = (key) => String(parts[key] ?? '').trim();
  return lines
    .map((line) => line
      .map(value)
      .filter(Boolean)
      .join(', '))
    .filter(Boolean);
}

/* ---------------------------------------------------------------------------
 * Subdivisions and cities
 *
 * Only first-level subdivisions for markets we can list accurately. A country
 * absent here returns [] so the UI falls back to a free-text field instead of
 * showing a wrong list.
 * ------------------------------------------------------------------------ */

export const SUBDIVISIONS = {
  US: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'],
  CA: ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon'],
  AU: ['Australian Capital Territory', 'New South Wales', 'Northern Territory', 'Queensland', 'South Australia', 'Tasmania', 'Victoria', 'Western Australia'],
  IN: ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry'],
  PK: ['Azad Kashmir', 'Balochistan', 'Gilgit-Baltistan', 'Islamabad Capital Territory', 'Khyber Pakhtunkhwa', 'Punjab', 'Sindh'],
  AE: ['Abu Dhabi', 'Ajman', 'Dubai', 'Fujairah', 'Ras Al Khaimah', 'Sharjah', 'Umm Al Quwain'],
  SA: ['Al Bahah', 'Al Jawf', 'Al Madinah', 'Al Qassim', 'Asir', 'Eastern Province', 'Ha\'il', 'Jazan', 'Makkah', 'Najran', 'Northern Borders', 'Riyadh', 'Tabuk'],
  GB: ['England', 'Scotland', 'Wales', 'Northern Ireland'],
  DE: ['Baden-Württemberg', 'Bavaria', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hesse', 'Lower Saxony', 'Mecklenburg-Vorpommern', 'North Rhine-Westphalia', 'Rhineland-Palatinate', 'Saarland', 'Saxony', 'Saxony-Anhalt', 'Schleswig-Holstein', 'Thuringia'],
  BR: ['Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro', 'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'],
  CN: ['Anhui', 'Beijing', 'Chongqing', 'Fujian', 'Gansu', 'Guangdong', 'Guangxi', 'Guizhou', 'Hainan', 'Hebei', 'Heilongjiang', 'Henan', 'Hubei', 'Hunan', 'Inner Mongolia', 'Jiangsu', 'Jiangxi', 'Jilin', 'Liaoning', 'Ningxia', 'Qinghai', 'Shaanxi', 'Shandong', 'Shanghai', 'Shanxi', 'Sichuan', 'Tianjin', 'Tibet', 'Xinjiang', 'Yunnan', 'Zhejiang'],
  JP: ['Aichi', 'Akita', 'Aomori', 'Chiba', 'Ehime', 'Fukui', 'Fukuoka', 'Fukushima', 'Gifu', 'Gunma', 'Hiroshima', 'Hokkaido', 'Hyogo', 'Ibaraki', 'Ishikawa', 'Iwate', 'Kagawa', 'Kagoshima', 'Kanagawa', 'Kochi', 'Kumamoto', 'Kyoto', 'Mie', 'Miyagi', 'Miyazaki', 'Nagano', 'Nagasaki', 'Nara', 'Niigata', 'Oita', 'Okayama', 'Okinawa', 'Osaka', 'Saga', 'Saitama', 'Shiga', 'Shimane', 'Shizuoka', 'Tochigi', 'Tokushima', 'Tokyo', 'Tottori', 'Toyama', 'Wakayama', 'Yamagata', 'Yamaguchi', 'Yamanashi'],
  MY: ['Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Labuan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak', 'Perlis', 'Putrajaya', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu'],
  ID: ['Bali', 'Banten', 'Central Java', 'Central Kalimantan', 'Central Sulawesi', 'East Java', 'East Kalimantan', 'East Nusa Tenggara', 'Gorontalo', 'Jakarta', 'Jambi', 'Lampung', 'North Maluku', 'North Sulawesi', 'North Sumatra', 'Papua', 'Riau', 'South Kalimantan', 'South Sulawesi', 'South Sumatra', 'Southeast Sulawesi', 'West Java', 'West Kalimantan', 'West Nusa Tenggara', 'West Papua', 'West Sulawesi', 'West Sumatra', 'Yogyakarta']
};

export const subdivisionsFor = (region) => SUBDIVISIONS[region] || [];

/** Cities for the markets where a short list is genuinely useful. */
export const CITIES = {
  PK: ['Karachi', 'Lahore', 'Faisalabad', 'Rawalpindi', 'Gujranwala', 'Peshawar', 'Multan', 'Hyderabad', 'Islamabad', 'Quetta'],
  IN: ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Ahmedabad', 'Chennai', 'Kolkata', 'Pune', 'Jaipur', 'Surat'],
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Al Ain', 'Ajman', 'Ras Al Khaimah'],
  SA: ['Riyadh', 'Jeddah', 'Makkah', 'Madinah', 'Dammam', 'Khobar'],
  US: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose'],
  GB: ['London', 'Birmingham', 'Manchester', 'Glasgow', 'Liverpool', 'Leeds', 'Edinburgh', 'Bristol'],
  DE: ['Berlin', 'Hamburg', 'München', 'Köln', 'Frankfurt am Main', 'Stuttgart', 'Düsseldorf'],
  FR: ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes'],
  ES: ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Zaragoza', 'Málaga'],
  IT: ['Roma', 'Milano', 'Napoli', 'Torino', 'Palermo', 'Bologna'],
  NL: ['Amsterdam', 'Rotterdam', 'Den Haag', 'Utrecht', 'Eindhoven'],
  BR: ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza', 'Belo Horizonte'],
  MX: ['Ciudad de México', 'Guadalajara', 'Monterrey', 'Puebla', 'Tijuana'],
  CN: ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Hangzhou', 'Wuhan'],
  JP: ['Tokyo', 'Yokohama', 'Osaka', 'Nagoya', 'Sapporo', 'Fukuoka', 'Kyoto'],
  KR: ['Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon', 'Gwangju'],
  SG: ['Singapore'],
  MY: ['Kuala Lumpur', 'George Town', 'Johor Bahru', 'Ipoh', 'Kota Kinabalu', 'Kuching'],
  ID: ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Semarang', 'Makassar', 'Denpasar'],
  TH: ['Bangkok', 'Chiang Mai', 'Pattaya', 'Phuket', 'Khon Kaen'],
  VN: ['Hà Nội', 'Hồ Chí Minh City', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'],
  TR: ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana'],
  RU: ['Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань'],
  PL: ['Warszawa', 'Kraków', 'Łódź', 'Wrocław', 'Poznań', 'Gdańsk'],
  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra'],
  CA: ['Toronto', 'Montréal', 'Vancouver', 'Calgary', 'Ottawa', 'Edmonton'],
  EG: ['Cairo', 'Alexandria', 'Giza', 'Luxor', 'Port Said'],
  NG: ['Lagos', 'Abuja', 'Kano', 'Ibadan', 'Port Harcourt'],
  ZA: ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth'],
  BD: ['Dhaka', 'Chattogram', 'Khulna', 'Rajshahi', 'Sylhet'],
  IR: ['تهران', 'مشهد', 'اصفهان', 'شیراز', 'تبریز'],
  IL: ['Jerusalem', 'Tel Aviv', 'Haifa', 'Be\'er Sheva']
};

export const citiesFor = (region) => CITIES[region] || [];

export const hasCityList = (region) => citiesFor(region).length > 0;
