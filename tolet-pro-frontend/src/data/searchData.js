/**
 * ─── SHARED SEARCH DATA ──────────────────────────────────────────────────────
 *
 * Single source of truth for search-bar data used by BOTH the desktop hero
 * (HeroSection.jsx) and the mobile home (mobile/MobileHome.jsx).
 *
 * The user explicitly asked us to stop maintaining parallel mobile / desktop
 * implementations. Anything that's the same data on both sides — divisions,
 * districts, suggestion list, property types per purpose, budget ranges —
 * lives here and is imported by both screens.
 *
 *   ▸ Layouts can still differ (mobile: bottom-sheet pickers; desktop:
 *     inline dropdowns) but the underlying data, IDs and URL contract are
 *     identical so PropertyListing receives the same input regardless of
 *     where the search was started.
 *
 *   ▸ The slug + URL format from `toSlug` + `buildSearchUrl` matches the
 *     desktop's HeroSection.handleSearch exactly:
 *       /properties/<slug>?purpose=<rent|buy|commercial>&category=<typeId>&budget=<budgetId>
 */

// ─── DIVISIONS + DISTRICTS ───────────────────────────────────────────────────
// Used by the mobile "Explore Divisions" strip and the Navbar drawer.
export const DIVISIONS = [
  { id: 'dhaka',      name: 'Dhaka',      tagline: 'Capital',     hot: true,
    image: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=900&q=80',
    districts: ['Dhaka','Faridpur','Gazipur','Gopalganj','Kishoreganj','Madaripur','Manikganj','Munshiganj','Narayanganj','Narsingdi','Rajbari','Shariatpur','Tangail'] },
  { id: 'chittagong', name: 'Chattogram', tagline: 'Port City',
    image: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=900&q=80',
    districts: ['Chattogram','Bandarban','Brahmanbaria','Chandpur','Comilla',"Cox's Bazar",'Feni','Khagrachari','Lakshmipur','Noakhali','Rangamati'] },
  { id: 'sylhet',     name: 'Sylhet',     tagline: 'Tea Gardens',
    image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=900&q=80',
    districts: ['Sylhet','Habiganj','Moulvibazar','Sunamganj'] },
  { id: 'rajshahi',   name: 'Rajshahi',   tagline: 'Silk City',
    image: 'https://images.unsplash.com/photo-1449844908441-8829872d2607?w=900&q=80',
    districts: ['Rajshahi','Bogura','Chapainawabganj','Joypurhat','Naogaon','Natore','Pabna','Sirajganj'] },
  { id: 'khulna',     name: 'Khulna',     tagline: 'Mangrove',
    image: 'https://images.unsplash.com/photo-1479839672679-a46483c0e7c8?w=900&q=80',
    districts: ['Khulna','Bagerhat','Chuadanga','Jashore','Jhenaidah','Kushtia','Magura','Meherpur','Narail','Satkhira'] },
  { id: 'barishal',   name: 'Barishal',   tagline: 'Rivers',
    image: 'https://images.unsplash.com/photo-1588600878108-578307a3cc9d?w=900&q=80',
    districts: ['Barishal','Barguna','Bhola','Jhalokati','Patuakhali','Pirojpur'] },
  { id: 'rangpur',    name: 'Rangpur',    tagline: 'North',
    image: 'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=900&q=80',
    districts: ['Rangpur','Dinajpur','Gaibandha','Kurigram','Lalmonirhat','Nilphamari','Panchagarh','Thakurgaon'] },
  { id: 'mymensingh', name: 'Mymensingh', tagline: 'Heritage',
    image: 'https://images.unsplash.com/photo-1518709594023-6eab9bab7b23?w=900&q=80',
    districts: ['Mymensingh','Jamalpur','Netrokona','Sherpur'] },
];

// ─── LOCATION SUGGESTION INDEX ───────────────────────────────────────────────
// Mirrors the desktop HeroSection.allSuggestions. Used by autocomplete in
// the mobile search panel — typing "Pa" surfaces every entry whose title
// contains "pa" (Pabna, Panchagarh, Pirojpur, …).
export const ALL_SUGGESTIONS = [
  // Dhaka core neighbourhoods
  { id: 'gulshan',      title: 'Gulshan, Dhaka',        type: 'Premium Area',    category: 'area' },
  { id: 'banani',       title: 'Banani, Dhaka',         type: 'Popular Search',  category: 'area' },
  { id: 'dhanmondi',    title: 'Dhanmondi, Dhaka',      type: 'Family Hub',      category: 'area' },
  { id: 'bashundhara',  title: 'Bashundhara R/A',       type: 'Residential',     category: 'area' },
  { id: 'uttara',       title: 'Uttara, Dhaka',         type: 'Planned City',    category: 'area' },
  { id: 'mirpur',       title: 'Mirpur, Dhaka',         type: 'Budget Friendly', category: 'area' },
  { id: 'mohammadpur',  title: 'Mohammadpur, Dhaka',    type: 'Residential',     category: 'area' },
  { id: 'rampura',      title: 'Rampura, Dhaka',        type: 'Area',            category: 'area' },
  { id: 'malibagh',     title: 'Malibagh, Dhaka',       type: 'Area',            category: 'area' },
  { id: 'khilgaon',     title: 'Khilgaon, Dhaka',       type: 'Area',            category: 'area' },
  { id: 'badda',        title: 'Badda, Dhaka',          type: 'Area',            category: 'area' },
  { id: 'tejgaon',      title: 'Tejgaon, Dhaka',        type: 'Commercial Zone', category: 'area' },
  { id: 'shyamoli',     title: 'Shyamoli, Dhaka',       type: 'Residential',     category: 'area' },
  { id: 'lalmatia',     title: 'Lalmatia, Dhaka',       type: 'Residential',     category: 'area' },
  { id: 'wari',         title: 'Wari, Dhaka',           type: 'Old Town',        category: 'area' },
  { id: 'azimpur',      title: 'Azimpur, Dhaka',        type: 'Residential',     category: 'area' },
  { id: 'jigatola',     title: 'Jigatola, Dhaka',       type: 'Area',            category: 'area' },
  { id: 'ashulia',      title: 'Ashulia, Dhaka',        type: 'Sub-district',    category: 'district' },
  { id: 'savar',        title: 'Savar, Dhaka',          type: 'Sub-district',    category: 'district' },
  { id: 'nawabganj',    title: 'Nawabganj, Dhaka',      type: 'District',        category: 'district' },
  // Cities / divisions
  { id: 'sylhet',       title: 'Sylhet City',           type: 'Division',        category: 'city' },
  { id: 'chittagong',   title: 'Chattogram City',       type: 'Division',        category: 'city' },
  { id: 'rajshahi',     title: 'Rajshahi City',         type: 'Division',        category: 'city' },
  { id: 'khulna',       title: 'Khulna City',           type: 'Division',        category: 'city' },
  { id: 'barishal',     title: 'Barishal City',         type: 'Division',        category: 'city' },
  { id: 'rangpur',      title: 'Rangpur City',          type: 'Division',        category: 'city' },
  { id: 'mymensingh',   title: 'Mymensingh City',       type: 'Division',        category: 'city' },
  // Common districts that overlap the user's example ("Pabna")
  { id: 'pabna',        title: 'Pabna, Bangladesh',     type: 'District',        category: 'city' },
  { id: 'bogura',       title: 'Bogura, Bangladesh',    type: 'District',        category: 'city' },
  { id: 'cox',          title: "Cox's Bazar",           type: 'Tourist',         category: 'city' },
  { id: 'comilla',      title: 'Comilla',               type: 'District',        category: 'city' },
  // Popular search terms (semantic, not strictly a location)
  { id: 'ps_family',    title: 'Family Apartment Dhaka',type: 'Popular Search',  category: 'search' },
  { id: 'ps_bach',      title: 'Bachelor Flat Mirpur',  type: 'Popular Search',  category: 'search' },
  { id: 'ps_sublet',    title: 'Sublet Room Dhanmondi', type: 'Popular Search',  category: 'search' },
  { id: 'ps_office',    title: 'Office Space Gulshan',  type: 'Popular Search',  category: 'search' },
];

// ─── POPULAR-AREA CHIPS ──────────────────────────────────────────────────────
// Shown on the mobile "Popular Areas" section. Same list the desktop hero
// uses for its `rentBuyChips`.
export const POPULAR_AREAS = [
  'Dhanmondi', 'Gulshan', 'Banani', 'Uttara', 'Bashundhara', 'Mirpur', 'Mohammadpur',
];

// ─── POPULAR-AREA SUB-ZONES ──────────────────────────────────────────────────
// A futuristic bottom-sheet opens when the user taps a popular area on the
// mobile home and lists every sub-zone inside it (Dhanmondi 1, 2, …, Lalmatia,
// Rayer Bazar; Gulshan 1, 2, Niketon, etc.). Picking a sub-zone navigates to
// the listing page filtered by that exact sub-zone. The richer the area, the
// more sub-zones (and homes) appear — matches the user's spec.
export const POPULAR_AREA_SUBZONES = {
  Dhanmondi: [
    { id: 'dhanmondi-1',         name: 'Dhanmondi 1',         tagline: 'Old residential' },
    { id: 'dhanmondi-2',         name: 'Dhanmondi 2',         tagline: 'Family corridor' },
    { id: 'dhanmondi-3',         name: 'Dhanmondi 3',         tagline: 'Lakeside' },
    { id: 'dhanmondi-4-a',       name: 'Dhanmondi 4/A',       tagline: 'Elite block' },
    { id: 'dhanmondi-5',         name: 'Dhanmondi 5',         tagline: 'Residential' },
    { id: 'dhanmondi-6',         name: 'Dhanmondi 6',         tagline: 'Calm streets' },
    { id: 'dhanmondi-7',         name: 'Dhanmondi 7',         tagline: 'Schools & cafes' },
    { id: 'dhanmondi-8',         name: 'Dhanmondi 8',         tagline: 'Family flats' },
    { id: 'dhanmondi-9-a',       name: 'Dhanmondi 9/A',       tagline: 'Prime block' },
    { id: 'dhanmondi-10-a',      name: 'Dhanmondi 10/A',      tagline: 'Quiet lanes' },
    { id: 'dhanmondi-11',        name: 'Dhanmondi 11',        tagline: 'Family hub' },
    { id: 'dhanmondi-12-a',      name: 'Dhanmondi 12/A',      tagline: 'Mid-budget' },
    { id: 'dhanmondi-13',        name: 'Dhanmondi 13',        tagline: 'Calm lanes' },
    { id: 'dhanmondi-15-a',      name: 'Dhanmondi 15/A',      tagline: 'Apartments' },
    { id: 'dhanmondi-27',        name: 'Dhanmondi 27',        tagline: 'Main road' },
    { id: 'dhanmondi-32',        name: 'Dhanmondi 32',        tagline: 'Lakefront' },
    { id: 'lalmatia',            name: 'Lalmatia',            tagline: 'Block A · B · C · D' },
    { id: 'rayer-bazar',         name: 'Rayer Bazar',         tagline: 'Hospital zone' },
    { id: 'jigatola',            name: 'Jigatola',            tagline: 'Budget friendly' },
    { id: 'shankar',             name: 'Shankar',             tagline: 'Bachelor friendly' },
    { id: 'staff-quarter',       name: 'Staff Quarter',       tagline: 'Calm pockets' },
  ],
  Gulshan: [
    { id: 'gulshan-1',           name: 'Gulshan 1',           tagline: 'Diplomatic zone' },
    { id: 'gulshan-2',           name: 'Gulshan 2',           tagline: 'Avenue & circle' },
    { id: 'gulshan-avenue',      name: 'Gulshan Avenue',      tagline: 'Main spine' },
    { id: 'gulshan-niketon',     name: 'Niketon',             tagline: 'Residential lanes' },
    { id: 'gulshan-mohakhali',   name: 'Mohakhali DOHS',      tagline: 'Defence society' },
    { id: 'gulshan-tejgaon',     name: 'Tejgaon-Gulshan Link',tagline: 'Office corridor' },
  ],
  Banani: [
    { id: 'banani-dohs',         name: 'Banani DOHS',         tagline: 'Defence society' },
    { id: 'banani-block-a',      name: 'Banani Block A',      tagline: 'Residential' },
    { id: 'banani-block-b',      name: 'Banani Block B',      tagline: 'Residential' },
    { id: 'banani-block-c',      name: 'Banani Block C',      tagline: 'Residential' },
    { id: 'banani-block-d',      name: 'Banani Block D',      tagline: 'Residential' },
    { id: 'banani-block-e',      name: 'Banani Block E',      tagline: 'Residential' },
    { id: 'banani-block-f',      name: 'Banani Block F',      tagline: 'Premium' },
    { id: 'banani-road-11',      name: 'Banani Road 11',      tagline: 'Restaurants' },
    { id: 'banani-road-12',      name: 'Banani Road 12',      tagline: 'Cafes & corner' },
  ],
  Uttara: [
    { id: 'uttara-sector-1',     name: 'Uttara Sector 1',     tagline: 'Established' },
    { id: 'uttara-sector-3',     name: 'Uttara Sector 3',     tagline: 'Family flats' },
    { id: 'uttara-sector-4',     name: 'Uttara Sector 4',     tagline: 'Schools' },
    { id: 'uttara-sector-5',     name: 'Uttara Sector 5',     tagline: 'Apartments' },
    { id: 'uttara-sector-6',     name: 'Uttara Sector 6',     tagline: 'Residential' },
    { id: 'uttara-sector-7',     name: 'Uttara Sector 7',     tagline: 'Spacious' },
    { id: 'uttara-sector-9',     name: 'Uttara Sector 9',     tagline: 'New construction' },
    { id: 'uttara-sector-10',    name: 'Uttara Sector 10',    tagline: 'Calm pockets' },
    { id: 'uttara-sector-11',    name: 'Uttara Sector 11',    tagline: 'Family hub' },
    { id: 'uttara-sector-12',    name: 'Uttara Sector 12',    tagline: 'Apartments' },
    { id: 'uttara-sector-13',    name: 'Uttara Sector 13',    tagline: 'Hospital zone' },
    { id: 'uttara-sector-14',    name: 'Uttara Sector 14',    tagline: 'Newer flats' },
    { id: 'uttara-sector-17',    name: 'Uttara Sector 17',    tagline: 'Expanding' },
    { id: 'uttara-sector-18',    name: 'Uttara Sector 18',    tagline: 'Newest' },
  ],
  Bashundhara: [
    { id: 'bashundhara-block-a', name: 'Block A',             tagline: 'Family blocks' },
    { id: 'bashundhara-block-b', name: 'Block B',             tagline: 'Family blocks' },
    { id: 'bashundhara-block-c', name: 'Block C',             tagline: 'Schools nearby' },
    { id: 'bashundhara-block-d', name: 'Block D',             tagline: 'Apartments' },
    { id: 'bashundhara-block-e', name: 'Block E',             tagline: 'Family flats' },
    { id: 'bashundhara-block-f', name: 'Block F',             tagline: 'Mosques nearby' },
    { id: 'bashundhara-block-g', name: 'Block G',             tagline: 'Residential' },
    { id: 'bashundhara-block-h', name: 'Block H',             tagline: 'Residential' },
    { id: 'bashundhara-block-i', name: 'Block I',             tagline: 'Premium' },
    { id: 'bashundhara-block-j', name: 'Block J',             tagline: 'Apartments' },
    { id: 'bashundhara-block-k', name: 'Block K',             tagline: 'New blocks' },
    { id: 'bashundhara-block-l', name: 'Block L',             tagline: 'New blocks' },
    { id: 'bashundhara-block-m', name: 'Block M',             tagline: 'New blocks' },
  ],
  Mirpur: [
    { id: 'mirpur-1',            name: 'Mirpur 1',            tagline: 'Market hub' },
    { id: 'mirpur-2',            name: 'Mirpur 2',            tagline: 'Family flats' },
    { id: 'mirpur-6',            name: 'Mirpur 6',            tagline: 'Schools nearby' },
    { id: 'mirpur-10',           name: 'Mirpur 10',           tagline: 'Connectivity' },
    { id: 'mirpur-11',           name: 'Mirpur 11',           tagline: 'Family flats' },
    { id: 'mirpur-12',           name: 'Mirpur 12',           tagline: 'Affordable' },
    { id: 'mirpur-13',           name: 'Mirpur 13',           tagline: 'Mid-budget' },
    { id: 'mirpur-14',           name: 'Mirpur 14',           tagline: 'Residential' },
    { id: 'mirpur-dohs',         name: 'Mirpur DOHS',         tagline: 'Defence society' },
    { id: 'mirpur-pallabi',      name: 'Pallabi',             tagline: 'Family hub' },
    { id: 'mirpur-kazipara',     name: 'Kazipara',            tagline: 'Budget' },
    { id: 'mirpur-shewrapara',   name: 'Shewrapara',          tagline: 'Connectivity' },
  ],
  Mohammadpur: [
    { id: 'mohammadpur-asad-ave', name: 'Asad Avenue',        tagline: 'Main spine' },
    { id: 'mohammadpur-pisciculture',name:'Pisciculture HSG', tagline: 'Family flats' },
    { id: 'mohammadpur-shyamoli', name: 'Shyamoli',            tagline: 'Mid-budget' },
    { id: 'mohammadpur-adabor',   name: 'Adabor',              tagline: 'Family blocks' },
    { id: 'mohammadpur-mohammadi-housing', name: 'Mohammadi Housing', tagline: 'Apartments' },
    { id: 'mohammadpur-iqbal-road', name: 'Iqbal Road',        tagline: 'Budget' },
    { id: 'mohammadpur-tajmahal-road', name: 'Tajmahal Road',  tagline: 'Connectivity' },
    { id: 'mohammadpur-katasur',  name: 'Katasur',             tagline: 'Calm lanes' },
  ],
};

// ─── PROPERTY TYPE OPTIONS (DYNAMIC PER SEARCH MODE) ─────────────────────────
// IDs match `rentalCategory` in propertyService for the rent flow; buy and
// commercial map to their own taxonomies. Keep these in sync with HeroSection.
export const RESIDENTIAL_TYPES = [
  { id: 'any',             label: { en: 'Any Property',      bn: 'যেকোনো প্রপার্টি' } },
  { id: 'family',          label: { en: 'Family Apartment',  bn: 'ফ্যামিলি বাসা' } },
  { id: 'bachelor_male',   label: { en: 'Bachelor (Male)',   bn: 'ব্যাচেলর (ছেলে)' } },
  { id: 'bachelor_female', label: { en: 'Bachelor (Female)', bn: 'ব্যাচেলর (মেয়ে)' } },
  { id: 'sublet',          label: { en: 'Sublet / Room',     bn: 'সাবলেট / রুম' } },
  { id: 'student',         label: { en: 'Student',           bn: 'ছাত্র/ছাত্রী' } },
];

export const COMMERCIAL_TYPES = [
  { id: 'any_commercial',  label: { en: 'Any Commercial',     bn: 'যেকোনো কমার্শিয়াল' } },
  { id: 'office',          label: { en: 'Office Space',       bn: 'অফিস স্পেস' } },
  { id: 'shop',            label: { en: 'Shop / Retail',      bn: 'দোকান / রিটেইল' } },
  { id: 'warehouse',       label: { en: 'Warehouse',          bn: 'গুদাম ঘর' } },
  { id: 'restaurant',      label: { en: 'Restaurant Space',   bn: 'রেস্টুরেন্ট স্পেস' } },
];

export const BUY_TYPES = [
  { id: 'any_buy',         label: { en: 'Any Property',       bn: 'যেকোনো প্রপার্টি' } },
  { id: 'apartment',       label: { en: 'Apartment / Flat',   bn: 'অ্যাপার্টমেন্ট / ফ্ল্যাট' } },
  { id: 'house',           label: { en: 'Independent / Duplex',bn: 'বাড়ি / ডুপ্লেক্স' } },
  { id: 'land',            label: { en: 'Land / Plot',        bn: 'জমি / প্লট' } },
  { id: 'commercial',      label: { en: 'Commercial Space',   bn: 'কমার্শিয়াল স্পেস' } },
];

export const BUDGET_RANGES = [
  { id: 'any',         label: { en: 'Any Budget',           bn: 'যেকোনো বাজেট' } },
  { id: 'under_10k',   label: { en: 'Under 10,000 BDT',     bn: '১০,০০০ টাকার নিচে' } },
  { id: '10k_20k',     label: { en: '10,000 – 20,000 BDT',  bn: '১০,০০০ – ২০,০০০ টাকা' } },
  { id: '20k_50k',     label: { en: '20,000 – 50,000 BDT',  bn: '২০,০০০ – ৫০,০০০ টাকা' } },
  { id: 'above_50k',   label: { en: 'Above 50,000 BDT',     bn: '৫০,০০০ টাকার উপরে' } },
];

/**
 * Returns the right property-type array for the currently selected purpose.
 * Identical to the dispatch logic in HeroSection.activePropertyTypes.
 */
export function getPropertyTypesFor(purpose) {
  if (purpose === 'commercial') return COMMERCIAL_TYPES;
  if (purpose === 'buy')        return BUY_TYPES;
  return RESIDENTIAL_TYPES;
}

/**
 * Returns the localized label string for a type/budget option.
 */
export function localizedLabel(option, langKey = 'en') {
  if (!option) return '';
  if (typeof option.label === 'string') return option.label;
  return option.label?.[langKey] || option.label?.en || '';
}

// ─── URL HELPERS ─────────────────────────────────────────────────────────────

/**
 * "Dhanmondi, Dhaka" → "dhanmondi-dhaka", "Uttara" → "uttara", "" → "all".
 * Matches desktop HeroSection.handleSearch's slug rule exactly.
 */
export function toSlug(s) {
  const trimmed = (s || '').trim();
  return trimmed ? trimmed.toLowerCase().replace(/,?\s+/g, '-') : 'all';
}

/**
 * Build the canonical `/properties/<slug>?purpose=…&category=…&budget=…`
 * URL. Mobile + Desktop should always call this so the listing page sees
 * an identical contract.
 */
export function buildSearchUrl({ location = '', purpose = 'rent', categoryId, budgetId, customMin, customMax }) {
  const slug = toSlug(location);
  const params = new URLSearchParams({
    purpose,
    category: categoryId || 'any',
    budget:   customMin && customMax ? `${customMin}-${customMax}` : (budgetId || 'any'),
  });
  return `/properties/${slug}?${params.toString()}`;
}

/**
 * Filters ALL_SUGGESTIONS by substring (case-insensitive). When no static
 * match is found we fall back to two dynamic entries — "Search for <q>"
 * and "<q>, Bangladesh" — exactly like the desktop hero does.
 *
 * @param {string} query     The current value of the location input.
 * @param {object} [labels]  Optional i18n labels { searchAnywhere, location }.
 * @returns {Array<{id,title,type,category}>}
 */
export function filterLocationSuggestions(query, labels = {}) {
  const raw = (query || '').trim();
  if (!raw) return ALL_SUGGESTIONS.slice(0, 7);

  const q = raw.toLowerCase();
  const matches = ALL_SUGGESTIONS.filter(s => s.title.toLowerCase().includes(q));

  if (matches.length === 0) {
    return [
      { id: `dynamic-${q}`,    title: raw,                  type: labels.searchAnywhere || 'Search Anywhere', category: 'search' },
      { id: `dynamic-bd-${q}`, title: `${raw}, Bangladesh`, type: labels.location       || 'Location',         category: 'city'   },
    ];
  }
  return matches.slice(0, 9);
}
