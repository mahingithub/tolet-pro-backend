/**
 * locationAliases.js — Bilingual (English ↔ Bengali) location dictionary
 * ─────────────────────────────────────────────────────────────────────────
 * Backend mirror of tolet-pro-frontend/src/data/locationAliases.js. Hosts save
 * a property's location in whichever language they used (Bengali by default via
 * GPS auto-fill), so the search haystack is single-language. searchService
 * expands each query token with this dictionary so a query in EITHER language
 * matches a listing stored in the other (e.g. "Savar" ↔ "সাভার").
 *
 * KEEP THE ALIAS GROUPS IN SYNC WITH THE FRONTEND COPY.
 */

// Each inner array is a set of equivalent spellings for ONE place across
// languages / romanisations. Any term is treated as a synonym of the others.
const LOCATION_ALIAS_GROUPS = [
  // ── Divisions ──
  ['dhaka', 'ঢাকা'],
  ['chittagong', 'chattogram', 'চট্টগ্রাম'],
  ['sylhet', 'সিলেট'],
  ['rajshahi', 'রাজশাহী'],
  ['khulna', 'খুলনা'],
  ['barishal', 'barisal', 'বরিশাল'],
  ['rangpur', 'রংপুর'],
  ['mymensingh', 'ময়মনসিংহ'],

  // ── Dhaka division districts ──
  ['faridpur', 'ফরিদপুর'],
  ['gazipur', 'গাজীপুর'],
  ['gopalganj', 'গোপালগঞ্জ'],
  ['kishoreganj', 'কিশোরগঞ্জ'],
  ['madaripur', 'মাদারীপুর'],
  ['manikganj', 'মানিকগঞ্জ'],
  ['munshiganj', 'মুন্সীগঞ্জ'],
  ['narayanganj', 'নারায়ণগঞ্জ'],
  ['narsingdi', 'নরসিংদী'],
  ['rajbari', 'রাজবাড়ী'],
  ['shariatpur', 'শরীয়তপুর'],
  ['tangail', 'টাঙ্গাইল'],

  // ── Chittagong division districts ──
  ['bandarban', 'বান্দরবান'],
  ['brahmanbaria', 'ব্রাহ্মণবাড়িয়া'],
  ['chandpur', 'চাঁদপুর'],
  ['comilla', 'কুমিল্লা'],
  ['feni', 'ফেনী'],
  ['khagrachari', 'খাগড়াছড়ি'],
  ['lakshmipur', 'লক্ষ্মীপুর'],
  ['noakhali', 'নোয়াখালী'],
  ['rangamati', 'রাঙ্গামাটি'],

  // ── Sylhet division districts ──
  ['habiganj', 'হবিগঞ্জ'],
  ['moulvibazar', 'মৌলভীবাজার'],
  ['sunamganj', 'সুনামগঞ্জ'],

  // ── Rajshahi division districts ──
  ['bogura', 'বগুড়া'],
  ['chapainawabganj', 'চাঁপাইনবাবগঞ্জ'],
  ['joypurhat', 'জয়পুরহাট'],
  ['naogaon', 'নওগাঁ'],
  ['natore', 'নাটোর'],
  ['pabna', 'পাবনা'],
  ['sirajganj', 'সিরাজগঞ্জ'],

  // ── Khulna division districts ──
  ['bagerhat', 'বাগেরহাট'],
  ['chuadanga', 'চুয়াডাঙ্গা'],
  ['jashore', 'jessore', 'যশোর'],
  ['jhenaidah', 'ঝিনাইদহ'],
  ['kushtia', 'কুষ্টিয়া'],
  ['magura', 'মাগুরা'],
  ['meherpur', 'মেহেরপুর'],
  ['narail', 'নড়াইল'],
  ['satkhira', 'সাতক্ষীরা'],

  // ── Barishal division districts ──
  ['barguna', 'বরগুনা'],
  ['bhola', 'ভোলা'],
  ['jhalokati', 'ঝালকাঠি'],
  ['patuakhali', 'পটুয়াখালী'],
  ['pirojpur', 'পিরোজপুর'],

  // ── Rangpur division districts ──
  ['dinajpur', 'দিনাজপুর'],
  ['gaibandha', 'গাইবান্ধা'],
  ['kurigram', 'কুড়িগ্রাম'],
  ['lalmonirhat', 'লালমনিরহাট'],
  ['nilphamari', 'নীলফামারী'],
  ['panchagarh', 'পঞ্চগড়'],
  ['thakurgaon', 'ঠাকুরগাঁও'],

  // ── Mymensingh division districts ──
  ['jamalpur', 'জামালপুর'],
  ['netrokona', 'নেত্রকোনা'],
  ['sherpur', 'শেরপুর'],

  // ── Dhaka thanas / upazilas ──
  ['savar', 'সাভার'],
  ['ashulia', 'আশুলিয়া'],
  ['keraniganj', 'কেরানীগঞ্জ'],
  ['dhamrai', 'ধামরাই'],
  ['nawabganj', 'নবাবগঞ্জ'],
  ['dohar', 'দোহার'],

  // ── Popular Dhaka neighbourhoods ──
  ['dhanmondi', 'ধানমন্ডি'],
  ['gulshan', 'গুলশান'],
  ['banani', 'বনানী'],
  ['uttara', 'উত্তরা'],
  ['bashundhara', 'বসুন্ধরা'],
  ['mirpur', 'মিরপুর'],
  ['mohammadpur', 'মোহাম্মদপুর'],
  ['baridhara', 'বারিধারা'],
  ['niketan', 'niketon', 'নিকেতন'],
  ['motijheel', 'মতিঝিল'],
  ['mohakhali', 'মহাখালী'],
  ['tejgaon', 'তেজগাঁও'],
  ['rampura', 'রামপুরা'],
  ['badda', 'বাড্ডা'],
  ['khilgaon', 'খিলগাঁও'],
  ['malibagh', 'মালিবাগ'],
  ['shyamoli', 'শ্যামলী'],
  ['lalmatia', 'লালমাটিয়া'],
  ['wari', 'ওয়ারী'],
  ['azimpur', 'আজিমপুর'],
  ['jigatola', 'জিগাতলা'],
  ['purbachal', 'পূর্বাচল'],
  ['adabar', 'আদাবর'],
  ['hazaribagh', 'হাজারীবাগ'],
  ['pallabi', 'পল্লবী'],
  ['khilkhet', 'খিলক্ষেত'],

  // ── Savar sub-areas (the reported bug's neighbourhood) ──
  ['dattapara', 'দত্তপাড়া'],
  ['hemayetpur', 'হেমায়েতপুর'],
  ['nabinagar', 'নবীনগর'],

  // ── Structural address words that show up inside area strings ──
  ['sector', 'সেক্টর'],
  ['road', 'রোড'],
  ['block', 'ব্লক'],
  ['bangladesh', 'বাংলাদেশ'],
];

// term (lowercased) → Set of its cross-spelling synonyms.
const ALIAS_MAP = (() => {
  const map = new Map();
  for (const group of LOCATION_ALIAS_GROUPS) {
    const terms = group.map((s) => String(s).toLowerCase());
    for (const term of terms) {
      const set = map.get(term) || new Set();
      for (const other of terms) if (other !== term) set.add(other);
      map.set(term, set);
    }
  }
  return map;
})();

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

// Bengali↔English digit transliterations of a token (only the differing ones).
function digitVariants(token) {
  const out = [];
  const toEn = token.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  const toBn = token.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
  if (toEn !== token) out.push(toEn);
  if (toBn !== token) out.push(toBn);
  return out;
}

/**
 * Expand a single query token into every spelling we should match against:
 * the token itself, its bilingual synonyms, and their digit transliterations.
 * @param {string} token
 * @returns {string[]}
 */
function expandLocationToken(token) {
  const t = String(token || '').toLowerCase().trim();
  if (!t) return [];
  const out = new Set([t]);
  const aliases = ALIAS_MAP.get(t);
  if (aliases) aliases.forEach((a) => out.add(a));
  for (const v of Array.from(out)) for (const d of digitVariants(v)) out.add(d);
  return Array.from(out);
}

module.exports = { LOCATION_ALIAS_GROUPS, expandLocationToken };
