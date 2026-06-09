/**
 * workplaces.js
 * ─────────────────────────────────────────────────────────────────────────
 * Curated list of common Bangladesh workplaces — universities, banks,
 * companies, hospitals, government agencies. Used by the WorkplaceAutocomplete
 * component to suggest options as the user types.
 *
 * Schema:
 *   id       — short stable slug (use for analytics/cluster keys later)
 *   name     — English name (display + search)
 *   nameBn   — Bengali name (display + search) — optional but encouraged
 *   cat      — 'university' | 'bank' | 'company' | 'hospital' | 'government' | 'ngo'
 *   city     — optional, helps disambiguate (e.g. multiple banks named "Sonali")
 *
 * Migration path:
 *   When admin panel exists, move this list to a MongoDB `workplaces`
 *   collection. Same shape, same search algorithm. Replace the import
 *   with `await api.searchWorkplaces(q)`.
 *
 * Add new entries here as users request them via the autocomplete's
 * "Don't see yours?" entry.
 */

export const WORKPLACES = [
  // ─── Universities (40) ────────────────────────────────────────────
  { id: 'du',          name: 'University of Dhaka',                  nameBn: 'ঢাকা বিশ্ববিদ্যালয়',         cat: 'university', city: 'Dhaka' },
  { id: 'buet',        name: 'BUET',                                  nameBn: 'বুয়েট',                       cat: 'university', city: 'Dhaka' },
  { id: 'ju',          name: 'Jahangirnagar University',              nameBn: 'জাহাঙ্গীরনগর বিশ্ববিদ্যালয়', cat: 'university', city: 'Savar' },
  { id: 'cu',          name: 'University of Chittagong',              nameBn: 'চট্টগ্রাম বিশ্ববিদ্যালয়',    cat: 'university', city: 'Chattogram' },
  { id: 'ru',          name: 'University of Rajshahi',                nameBn: 'রাজশাহী বিশ্ববিদ্যালয়',     cat: 'university', city: 'Rajshahi' },
  { id: 'ku',          name: 'Khulna University',                     nameBn: 'খুলনা বিশ্ববিদ্যালয়',       cat: 'university', city: 'Khulna' },
  { id: 'sust',        name: 'Shahjalal University of Science and Technology', nameBn: 'শাবিপ্রবি',          cat: 'university', city: 'Sylhet' },
  { id: 'iut',         name: 'Islamic University of Technology',      nameBn: 'আইইউটি',                       cat: 'university', city: 'Gazipur' },
  { id: 'mist',        name: 'MIST',                                  nameBn: 'এমআইএসটি',                     cat: 'university', city: 'Dhaka' },
  { id: 'nsu',         name: 'North South University',                nameBn: 'নর্থ সাউথ ইউনিভার্সিটি',     cat: 'university', city: 'Dhaka' },
  { id: 'brac_u',      name: 'BRAC University',                       nameBn: 'ব্র্যাক ইউনিভার্সিটি',        cat: 'university', city: 'Dhaka' },
  { id: 'aiub',        name: 'American International University-Bangladesh', nameBn: 'এআইইউবি',              cat: 'university', city: 'Dhaka' },
  { id: 'iub',         name: 'Independent University, Bangladesh',     nameBn: 'আইইউবি',                       cat: 'university', city: 'Dhaka' },
  { id: 'ewu',         name: 'East West University',                  nameBn: 'ইস্ট ওয়েস্ট ইউনিভার্সিটি',  cat: 'university', city: 'Dhaka' },
  { id: 'uiu',         name: 'United International University',       nameBn: 'ইউআইইউ',                       cat: 'university', city: 'Dhaka' },
  { id: 'duet',        name: 'DUET',                                  nameBn: 'ডুয়েট',                       cat: 'university', city: 'Gazipur' },
  { id: 'kuet',        name: 'KUET',                                  nameBn: 'কুয়েট',                       cat: 'university', city: 'Khulna' },
  { id: 'cuet',        name: 'CUET',                                  nameBn: 'চুয়েট',                       cat: 'university', city: 'Chattogram' },
  { id: 'ruet',        name: 'RUET',                                  nameBn: 'রুয়েট',                       cat: 'university', city: 'Rajshahi' },
  { id: 'aust',        name: 'Ahsanullah University of Science and Technology', nameBn: 'এইউএসটি',          cat: 'university', city: 'Dhaka' },
  { id: 'iubat',       name: 'IUBAT',                                 nameBn: 'আইইউবিএটি',                    cat: 'university', city: 'Dhaka' },
  { id: 'green_u',     name: 'Green University of Bangladesh',        nameBn: 'গ্রিন ইউনিভার্সিটি',          cat: 'university', city: 'Dhaka' },
  { id: 'daffodil',    name: 'Daffodil International University',     nameBn: 'ড্যাফোডিল ইউনিভার্সিটি',     cat: 'university', city: 'Dhaka' },
  { id: 'uap',         name: 'University of Asia Pacific',             nameBn: 'ইউএপি',                         cat: 'university', city: 'Dhaka' },
  { id: 'sub',         name: 'Stamford University Bangladesh',         nameBn: 'স্ট্যামফোর্ড',                 cat: 'university', city: 'Dhaka' },
  { id: 'ulab',        name: 'ULAB',                                  nameBn: 'ইউল্যাব',                       cat: 'university', city: 'Dhaka' },
  { id: 'bup',         name: 'Bangladesh University of Professionals',nameBn: 'বিইউপি',                        cat: 'university', city: 'Dhaka' },
  { id: 'bsmmu',       name: 'BSMMU',                                 nameBn: 'বিএসএমএমইউ',                   cat: 'university', city: 'Dhaka' },
  { id: 'bup_med',     name: 'Dhaka Medical College',                 nameBn: 'ঢাকা মেডিকেল কলেজ',          cat: 'university', city: 'Dhaka' },
  { id: 'chmc',        name: 'Chittagong Medical College',            nameBn: 'চিটাগাং মেডিকেল কলেজ',       cat: 'university', city: 'Chattogram' },

  // ─── Banks (30) ──────────────────────────────────────────────────
  { id: 'jamuna_bank', name: 'Jamuna Bank',                          nameBn: 'যমুনা ব্যাংক',                cat: 'bank' },
  { id: 'brac_bank',   name: 'BRAC Bank',                            nameBn: 'ব্র্যাক ব্যাংক',              cat: 'bank' },
  { id: 'ebl',         name: 'Eastern Bank (EBL)',                   nameBn: 'ইস্টার্ন ব্যাংক',            cat: 'bank' },
  { id: 'city_bank',   name: 'The City Bank',                        nameBn: 'সিটি ব্যাংক',                cat: 'bank' },
  { id: 'sonali_bank', name: 'Sonali Bank',                          nameBn: 'সোনালী ব্যাংক',              cat: 'bank' },
  { id: 'janata',      name: 'Janata Bank',                          nameBn: 'জনতা ব্যাংক',                cat: 'bank' },
  { id: 'agrani',      name: 'Agrani Bank',                          nameBn: 'অগ্রণী ব্যাংক',              cat: 'bank' },
  { id: 'rupali',      name: 'Rupali Bank',                          nameBn: 'রূপালী ব্যাংক',              cat: 'bank' },
  { id: 'islami_bank', name: 'Islami Bank Bangladesh',                nameBn: 'ইসলামী ব্যাংক',              cat: 'bank' },
  { id: 'dbbl',        name: 'Dutch-Bangla Bank',                     nameBn: 'ডাচ-বাংলা ব্যাংক',           cat: 'bank' },
  { id: 'pubali',      name: 'Pubali Bank',                          nameBn: 'পূবালী ব্যাংক',              cat: 'bank' },
  { id: 'prime_bank',  name: 'Prime Bank',                            nameBn: 'প্রাইম ব্যাংক',              cat: 'bank' },
  { id: 'standard',    name: 'Standard Bank',                         nameBn: 'স্ট্যান্ডার্ড ব্যাংক',        cat: 'bank' },
  { id: 'mutual',      name: 'Mutual Trust Bank (MTB)',               nameBn: 'এমটিবি',                       cat: 'bank' },
  { id: 'ucb',         name: 'United Commercial Bank (UCB)',          nameBn: 'ইউসিবি',                       cat: 'bank' },
  { id: 'dhaka_bank',  name: 'Dhaka Bank',                           nameBn: 'ঢাকা ব্যাংক',                cat: 'bank' },
  { id: 'mercantile',  name: 'Mercantile Bank',                       nameBn: 'মার্কেন্টাইল ব্যাংক',         cat: 'bank' },
  { id: 'national_bank',name:'National Bank',                         nameBn: 'ন্যাশনাল ব্যাংক',             cat: 'bank' },
  { id: 'al_arafah',   name: 'Al-Arafah Islami Bank',                 nameBn: 'আল-আরাফাহ ইসলামী ব্যাংক',   cat: 'bank' },
  { id: 'sjibl',       name: 'Shahjalal Islami Bank',                 nameBn: 'শাহজালাল ইসলামী ব্যাংক',     cat: 'bank' },
  { id: 'first_sec',   name: 'First Security Islami Bank',            nameBn: 'ফার্স্ট সিকিউরিটি',            cat: 'bank' },
  { id: 'social',      name: 'Social Islami Bank',                    nameBn: 'সোশ্যাল ইসলামী ব্যাংক',      cat: 'bank' },
  { id: 'ific',        name: 'IFIC Bank',                             nameBn: 'আইএফআইসি ব্যাংক',             cat: 'bank' },
  { id: 'one_bank',    name: 'ONE Bank',                              nameBn: 'ওয়ান ব্যাংক',                cat: 'bank' },
  { id: 'sbac',        name: 'SBAC Bank',                             nameBn: 'এসবিএসি ব্যাংক',              cat: 'bank' },
  { id: 'hsbc',        name: 'HSBC Bangladesh',                       nameBn: 'এইচএসবিসি',                   cat: 'bank' },
  { id: 'sc',          name: 'Standard Chartered',                    nameBn: 'স্ট্যান্ডার্ড চার্টার্ড',     cat: 'bank' },
  { id: 'citibank',    name: 'Citibank N.A.',                         nameBn: 'সিটিব্যাংক এনএ',              cat: 'bank' },
  { id: 'bangladesh_bank',name:'Bangladesh Bank',                     nameBn: 'বাংলাদেশ ব্যাংক',             cat: 'bank' },

  // ─── Tech / Telco / Startups (20) ────────────────────────────────
  { id: 'pathao',      name: 'Pathao',                                nameBn: 'পাঠাও',                       cat: 'company' },
  { id: 'bkash',       name: 'bKash',                                 nameBn: 'বিকাশ',                       cat: 'company' },
  { id: 'nagad',       name: 'Nagad',                                 nameBn: 'নগদ',                         cat: 'company' },
  { id: 'rocket',      name: 'Rocket (DBBL Mobile)',                  nameBn: 'রকেট',                       cat: 'company' },
  { id: 'shohoz',      name: 'Shohoz',                                nameBn: 'সহজ',                         cat: 'company' },
  { id: 'foodpanda',   name: 'Foodpanda',                             nameBn: 'ফুডপান্ডা',                   cat: 'company' },
  { id: 'daraz',       name: 'Daraz Bangladesh',                      nameBn: 'দারাজ',                       cat: 'company' },
  { id: 'chaldal',     name: 'Chaldal',                               nameBn: 'চালডাল',                       cat: 'company' },
  { id: 'sheba',       name: 'Sheba.xyz',                             nameBn: 'সেবা',                         cat: 'company' },
  { id: 'pickaboo',    name: 'Pickaboo',                              nameBn: 'পিকাবু',                       cat: 'company' },
  { id: 'grameenphone',name: 'Grameenphone',                          nameBn: 'গ্রামীণফোন',                  cat: 'company' },
  { id: 'robi',        name: 'Robi Axiata',                           nameBn: 'রবি',                          cat: 'company' },
  { id: 'banglalink',  name: 'Banglalink',                            nameBn: 'বাংলালিংক',                   cat: 'company' },
  { id: 'teletalk',    name: 'Teletalk',                              nameBn: 'টেলিটক',                       cat: 'company' },
  { id: 'samsung_bd',  name: 'Samsung Bangladesh',                    nameBn: 'স্যামসাং বাংলাদেশ',          cat: 'company' },
  { id: 'tcs',         name: 'TCS (Tata Consultancy Services)',       nameBn: 'টিসিএস',                       cat: 'company' },
  { id: 'kaz',         name: 'Kazi Farms',                            nameBn: 'কাজী ফার্মস',                cat: 'company' },
  { id: 'pran_rfl',    name: 'PRAN-RFL Group',                        nameBn: 'প্রাণ-আরএফএল',                cat: 'company' },
  { id: 'meghna',      name: 'Meghna Group',                          nameBn: 'মেঘনা গ্রুপ',                cat: 'company' },
  { id: 'beximco',     name: 'Beximco',                               nameBn: 'বেক্সিমকো',                   cat: 'company' },
  { id: 'square',      name: 'Square Group',                          nameBn: 'স্কয়ার গ্রুপ',              cat: 'company' },
  { id: 'akij',        name: 'Akij Group',                            nameBn: 'আকিজ গ্রুপ',                cat: 'company' },
  { id: 'epyllion',    name: 'Epyllion Group',                        nameBn: 'এপিলিয়ন',                     cat: 'company' },
  { id: 'walton',      name: 'Walton',                                nameBn: 'ওয়ালটন',                      cat: 'company' },

  // ─── Hospitals (10) ──────────────────────────────────────────────
  { id: 'square_h',    name: 'Square Hospital',                       nameBn: 'স্কয়ার হাসপাতাল',           cat: 'hospital', city: 'Dhaka' },
  { id: 'apollo',      name: 'Apollo Hospitals Dhaka',                nameBn: 'অ্যাপোলো হাসপাতাল',          cat: 'hospital', city: 'Dhaka' },
  { id: 'united_h',    name: 'United Hospital',                       nameBn: 'ইউনাইটেড হাসপাতাল',          cat: 'hospital', city: 'Dhaka' },
  { id: 'evercare',    name: 'Evercare Hospital',                     nameBn: 'এভারকেয়ার হাসপাতাল',         cat: 'hospital', city: 'Dhaka' },
  { id: 'labaid',      name: 'Labaid Hospital',                       nameBn: 'ল্যাবএইড',                    cat: 'hospital', city: 'Dhaka' },
  { id: 'ibn_sina',    name: 'Ibn Sina Hospital',                     nameBn: 'ইবনে সিনা',                   cat: 'hospital', city: 'Dhaka' },
  { id: 'popular',     name: 'Popular Diagnostic Centre',              nameBn: 'পপুলার ডায়াগনস্টিক',         cat: 'hospital', city: 'Dhaka' },
  { id: 'icddrb',      name: 'icddr,b',                               nameBn: 'আইসিডিডিআরবি',               cat: 'hospital', city: 'Dhaka' },
  { id: 'cmh',         name: 'Combined Military Hospital (CMH)',       nameBn: 'সিএমএইচ',                     cat: 'hospital', city: 'Dhaka' },
  { id: 'dmc_h',       name: 'Dhaka Medical College Hospital',         nameBn: 'ঢাকা মেডিকেল কলেজ হাসপাতাল',cat: 'hospital', city: 'Dhaka' },

  // ─── Government / Public sector (10) ─────────────────────────────
  { id: 'biman',       name: 'Biman Bangladesh Airlines',             nameBn: 'বিমান বাংলাদেশ',              cat: 'government' },
  { id: 'titas',       name: 'Titas Gas',                             nameBn: 'তিতাস গ্যাস',                cat: 'government' },
  { id: 'desco',       name: 'DESCO',                                 nameBn: 'ডেসকো',                        cat: 'government' },
  { id: 'dpdc',        name: 'DPDC',                                  nameBn: 'ডিপিডিসি',                     cat: 'government' },
  { id: 'wasa',        name: 'Dhaka WASA',                            nameBn: 'ঢাকা ওয়াসা',                 cat: 'government' },
  { id: 'brta',        name: 'BRTA',                                  nameBn: 'বিআরটিএ',                      cat: 'government' },
  { id: 'nbr',         name: 'National Board of Revenue (NBR)',        nameBn: 'এনবিআর',                       cat: 'government' },
  { id: 'bb',          name: 'Bangladesh Bank',                       nameBn: 'বাংলাদেশ ব্যাংক',             cat: 'government' },
  { id: 'rab',         name: 'RAB',                                  nameBn: 'র‍্যাব',                        cat: 'government' },
  { id: 'bd_police',   name: 'Bangladesh Police',                     nameBn: 'বাংলাদেশ পুলিশ',              cat: 'government' },

  // ─── NGOs (5) ────────────────────────────────────────────────────
  { id: 'brac',        name: 'BRAC',                                  nameBn: 'ব্র্যাক',                    cat: 'ngo' },
  { id: 'asa',         name: 'ASA',                                   nameBn: 'আশা',                          cat: 'ngo' },
  { id: 'grameen',     name: 'Grameen Bank',                          nameBn: 'গ্রামীণ ব্যাংক',            cat: 'ngo' },
  { id: 'tib',         name: 'Transparency International Bangladesh',  nameBn: 'টিআইবি',                       cat: 'ngo' },
  { id: 'unicef_bd',   name: 'UNICEF Bangladesh',                     nameBn: 'ইউনিসেফ বাংলাদেশ',           cat: 'ngo' },
];

export const WORKPLACE_CATEGORIES = {
  university: { iconName: 'GraduationCap', labelEn: 'Universities',   labelBn: 'বিশ্ববিদ্যালয়' },
  bank:       { iconName: 'Building2',     labelEn: 'Banks',          labelBn: 'ব্যাংক' },
  company:    { iconName: 'Briefcase',     labelEn: 'Companies',      labelBn: 'কোম্পানি' },
  hospital:   { iconName: 'Heart',         labelEn: 'Hospitals',      labelBn: 'হাসপাতাল' },
  government: { iconName: 'Landmark',      labelEn: 'Government',     labelBn: 'সরকারি' },
  ngo:        { iconName: 'HandHeart',     labelEn: 'NGOs',           labelBn: 'এনজিও' },
};

/**
 * searchWorkplaces — fuzzy search across the static list.
 * Scores prefix matches highest, then ID matches, then substring matches.
 * Returns top N entries sorted by score (descending).
 */
export function searchWorkplaces(query, { limit = 8 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];

  const scored = [];
  for (const w of WORKPLACES) {
    const en = w.name.toLowerCase();
    const bn = (w.nameBn || '').toLowerCase();
    let score = 0;
    if (en.startsWith(q))      score += 100;
    else if (en.includes(q))   score += 50;
    if (bn.startsWith(q))      score += 100;
    else if (bn.includes(q))   score += 50;
    if (w.id.toLowerCase().includes(q)) score += 80;
    if (score > 0) scored.push({ ...w, _score: score });
  }
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, limit);
}

/** Groups search results by category for the dropdown UI. */
export function groupByCategory(results) {
  const out = {};
  for (const w of results) {
    (out[w.cat] = out[w.cat] || []).push(w);
  }
  return out;
}