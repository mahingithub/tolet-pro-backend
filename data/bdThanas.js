'use strict';

/**
 * bdThanas.js — GENERATED FILE, DO NOT EDIT BY HAND.
 * ─────────────────────────────────────────────────────────────────────────────
 * Regenerate from the frontend package:
 *
 *     cd tolet-pro-frontend && node scripts/generate-bd-geo.mjs
 *
 * ONE generator writes this AND the frontend's src/data/bdGeo.js, so the list
 * a provider picks his coverage from and the list a tenant searches by cannot
 * drift apart. Editing this file by hand breaks that guarantee silently.
 *
 * ─── WHY THE BACKEND HOLDS THANA NAMES AT ALL ────────────────────────────────
 * Because a thana arrives here in two languages. The tenant's LocationBar
 * sends the Bengali label to a Bangla user and the English one to an English
 * user, so "ধানমন্ডি" and "Dhanmondi" are the same place and neither is the
 * stored form. THANA_ALIASES folds every spelling we know onto one canonical
 * English label; utils/thanaNames.js is the only thing that should read it.
 *
 *   THANAS          the picker list — one row per distinct thana NAME, metros
 *                   first, mirroring the tenant's LocationBar exactly.
 *   THANA_ALIASES   normalised spelling → canonical English label.
 */

/** @typedef {{ en: string, bn: string, districtEn: string, districtBn: string }} Thana */

/** @type {Thana[]} */
const THANAS = [
  {
    "en": "Adabar",
    "bn": "আদাবর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Airport",
    "bn": "বিমানবন্দর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Ashulia",
    "bn": "আশুলিয়া",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Badda",
    "bn": "বাড্ডা",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Banani",
    "bn": "বনানী",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Bangshal",
    "bn": "বংশাল",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Baridhara",
    "bn": "বারিধারা",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Bhashantek",
    "bn": "ভাষানটেক",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Bhatara",
    "bn": "ভাটারা",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Cantonment",
    "bn": "ক্যান্টনমেন্ট",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Chawkbazar",
    "bn": "চকবাজার",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Dakshinkhan",
    "bn": "দক্ষিণখান",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Darus Salam",
    "bn": "দারুস সালাম",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Demra",
    "bn": "ডেমরা",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Dhamrai",
    "bn": "ধামরাই",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Dhanmondi",
    "bn": "ধানমন্ডি",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Dohar",
    "bn": "দোহার",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Gendaria",
    "bn": "গেন্ডারিয়া",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Gulshan",
    "bn": "গুলশান",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Hatirjheel",
    "bn": "হাতিরঝিল",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Hazaribagh",
    "bn": "হাজারীবাগ",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Jatrabari",
    "bn": "যাত্রাবাড়ী",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Kadamtali",
    "bn": "কদমতলী",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Kafrul",
    "bn": "কাফরুল",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Kalabagan",
    "bn": "কলাবাগান",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Kamrangirchar",
    "bn": "কামরাঙ্গীরচর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Keraniganj",
    "bn": "কেরাণীগঞ্জ",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Khilgaon",
    "bn": "খিলগাঁও",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Khilkhet",
    "bn": "খিলক্ষেত",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Kotwali",
    "bn": "কোতোয়ালী",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Lalbagh",
    "bn": "লালবাগ",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Mirpur",
    "bn": "মিরপুর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Mohammadpur",
    "bn": "মোহাম্মদপুর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Motijheel",
    "bn": "মতিঝিল",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Mugda",
    "bn": "মুগদা",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Nawabganj",
    "bn": "নবাবগঞ্জ",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "New Market",
    "bn": "নিউমার্কেট",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Pallabi",
    "bn": "পল্লবী",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Paltan",
    "bn": "পল্টন",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Ramna",
    "bn": "রমনা",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Rampura",
    "bn": "রামপুরা",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Rupnagar",
    "bn": "রূপনগর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Sabujbagh",
    "bn": "সবুজবাগ",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Savar",
    "bn": "সাভার",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Shah Ali",
    "bn": "শাহ আলী",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Shahbagh",
    "bn": "শাহবাগ",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Shahjahanpur",
    "bn": "শাহজাহানপুর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Sher-e-Bangla Nagar",
    "bn": "শেরেবাংলা নগর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Shyampur",
    "bn": "শ্যামপুর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Sutrapur",
    "bn": "সূত্রাপুর",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Tejgaon",
    "bn": "তেজগাঁও",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Tejgaon I/A",
    "bn": "তেজগাঁও শিল্প এলাকা",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Tejgaon Industrial Area",
    "bn": "তেজগাঁও শিল্পাঞ্চল",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Turag",
    "bn": "তুরাগ",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Uttara East",
    "bn": "উত্তরা পূর্ব",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Uttara West",
    "bn": "উত্তরা পশ্চিম",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Uttarkhan",
    "bn": "উত্তরখান",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Wari",
    "bn": "ওয়ারী",
    "districtEn": "Dhaka",
    "districtBn": "ঢাকা"
  },
  {
    "en": "Sadarghat",
    "bn": "সদরঘাট",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Akbarshah",
    "bn": "আকবরশাহ",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Anwara",
    "bn": "আনোয়ারা",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Bakalia",
    "bn": "বাকলিয়া",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Bandar",
    "bn": "বন্দর",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Banshkhali",
    "bn": "বাঁশখালী",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Bayezid Bostami",
    "bn": "বায়েজিদ বোস্তামী",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Boalkhali",
    "bn": "বোয়ালখালী",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Chandanaish",
    "bn": "চন্দনাইশ",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Chandgaon",
    "bn": "চান্দগাঁও",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Double Mooring",
    "bn": "ডবলমুরিং",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "EPZ",
    "bn": "ইপিজেড",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Fatikchhari",
    "bn": "ফটিকছড়ি",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Halishahar",
    "bn": "হালিশহর",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Hathazari",
    "bn": "হাটহাজারী",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Karnaphuli",
    "bn": "কর্ণফুলী",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Khulshi",
    "bn": "খুলশী",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Lohagara",
    "bn": "লোহাগাড়া",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Mirsharai",
    "bn": "মীরসরাই",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Pahartali",
    "bn": "পাহাড়তলী",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Panchlaish",
    "bn": "পাঁচলাইশ",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Patenga",
    "bn": "পতেঙ্গা",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Patiya",
    "bn": "পটিয়া",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Rangunia",
    "bn": "রাঙ্গুনিয়া",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Raozan",
    "bn": "রাউজান",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Sandwip",
    "bn": "সন্দ্বীপ",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Satkania",
    "bn": "সাতকানিয়া",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Sitakunda",
    "bn": "সীতাকুন্ড",
    "districtEn": "Chattogram",
    "districtBn": "চট্টগ্রাম"
  },
  {
    "en": "Gazipur Sadar",
    "bn": "গাজীপুর সদর",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Basan",
    "bn": "বাসন",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Gacha",
    "bn": "গাছা",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Joydebpur",
    "bn": "জয়দেবপুর",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Kaliakair",
    "bn": "কালিয়াকৈর",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Kaliganj",
    "bn": "কালীগঞ্জ",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Kapasia",
    "bn": "কাপাসিয়া",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Kashimpur",
    "bn": "কাশিমপুর",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Konabari",
    "bn": "কোনাবাড়ী",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Pubail",
    "bn": "পূবাইল",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Sreepur",
    "bn": "শ্রীপুর",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Tongi",
    "bn": "টঙ্গী",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Tongi East",
    "bn": "টঙ্গী পূর্ব",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Tongi West",
    "bn": "টঙ্গী পশ্চিম",
    "districtEn": "Gazipur",
    "districtBn": "গাজীপুর"
  },
  {
    "en": "Narayanganj Sadar",
    "bn": "নারায়নগঞ্জ সদর",
    "districtEn": "Narayanganj",
    "districtBn": "নারায়ণগঞ্জ"
  },
  {
    "en": "Araihazar",
    "bn": "আড়াইহাজার",
    "districtEn": "Narayanganj",
    "districtBn": "নারায়ণগঞ্জ"
  },
  {
    "en": "Fatullah",
    "bn": "ফতুল্লা",
    "districtEn": "Narayanganj",
    "districtBn": "নারায়ণগঞ্জ"
  },
  {
    "en": "Rupganj",
    "bn": "রূপগঞ্জ",
    "districtEn": "Narayanganj",
    "districtBn": "নারায়ণগঞ্জ"
  },
  {
    "en": "Siddhirganj",
    "bn": "সিদ্ধিরগঞ্জ",
    "districtEn": "Narayanganj",
    "districtBn": "নারায়ণগঞ্জ"
  },
  {
    "en": "Sonargaon",
    "bn": "সোনারগাঁ",
    "districtEn": "Narayanganj",
    "districtBn": "নারায়ণগঞ্জ"
  },
  {
    "en": "Sylhet Sadar",
    "bn": "সিলেট সদর",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Balaganj",
    "bn": "বালাগঞ্জ",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Beanibazar",
    "bn": "বিয়ানীবাজার",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Bishwanath",
    "bn": "বিশ্বনাথ",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Companiganj",
    "bn": "কোম্পানীগঞ্জ",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Dakshinsurma",
    "bn": "দক্ষিণ সুরমা",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Fenchuganj",
    "bn": "ফেঞ্চুগঞ্জ",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Golapganj",
    "bn": "গোলাপগঞ্জ",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Gowainghat",
    "bn": "গোয়াইনঘাট",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Jaintiapur",
    "bn": "জৈন্তাপুর",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Jalalabad",
    "bn": "জালালাবাদ",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Kanaighat",
    "bn": "কানাইঘাট",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Moglabazar",
    "bn": "মোগলাবাজার",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Osmaninagar",
    "bn": "ওসমানী নগর",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Shahporan",
    "bn": "শাহপরান",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "South Surma",
    "bn": "দক্ষিণ সুরমা",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Zakiganj",
    "bn": "জকিগঞ্জ",
    "districtEn": "Sylhet",
    "districtBn": "সিলেট"
  },
  {
    "en": "Khulna Sadar",
    "bn": "খুলনা সদর",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Aronghata",
    "bn": "আড়ংঘাটা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Batiaghata",
    "bn": "বটিয়াঘাটা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Dacope",
    "bn": "দাকোপ",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Daulatpur",
    "bn": "দৌলতপুর",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Dighalia",
    "bn": "দিঘলিয়া",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Dumuria",
    "bn": "ডুমুরিয়া",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Harintana",
    "bn": "হরিণটানা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Khalishpur",
    "bn": "খালিশপুর",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Khan Jahan Ali",
    "bn": "খানজাহান আলী",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Koyra",
    "bn": "কয়রা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Labanchara",
    "bn": "লবণচরা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Paikgachha",
    "bn": "পাইকগাছা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Phultala",
    "bn": "ফুলতলা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Rupsa",
    "bn": "রূপসা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Sonadanga",
    "bn": "সোনাডাঙ্গা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Terokhada",
    "bn": "তেরখাদা",
    "districtEn": "Khulna",
    "districtBn": "খুলনা"
  },
  {
    "en": "Bagha",
    "bn": "বাঘা",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Bagmara",
    "bn": "বাগমারা",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Belpukur",
    "bn": "বেলপুকুর",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Boalia",
    "bn": "বোয়ালিয়া",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Chandrima",
    "bn": "চন্দ্রিমা",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Charghat",
    "bn": "চারঘাট",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Damkura",
    "bn": "দামকুড়া",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Durgapur",
    "bn": "দুর্গাপুর",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Godagari",
    "bn": "গোদাগাড়ী",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Karnahar",
    "bn": "কর্ণহার",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Kashiadanga",
    "bn": "কাশিয়াডাঙ্গা",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Katakhali",
    "bn": "কাটাখালী",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Mohanpur",
    "bn": "মোহনপুর",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Motihar",
    "bn": "মতিহার",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Paba",
    "bn": "পবা",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Puthia",
    "bn": "পুঠিয়া",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Rajpara",
    "bn": "রাজপাড়া",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Shah Makhdum",
    "bn": "শাহ মখদুম",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Tanore",
    "bn": "তানোর",
    "districtEn": "Rajshahi",
    "districtBn": "রাজশাহী"
  },
  {
    "en": "Faridpur Sadar",
    "bn": "ফরিদপুর সদর",
    "districtEn": "Faridpur",
    "districtBn": "ফরিদপুর"
  },
  {
    "en": "Sadarpur",
    "bn": "সদরপুর",
    "districtEn": "Faridpur",
    "districtBn": "ফরিদপুর"
  },
  {
    "en": "Alfadanga",
    "bn": "আলফাডাঙ্গা",
    "districtEn": "Faridpur",
    "districtBn": "ফরিদপুর"
  },
  {
    "en": "Bhanga",
    "bn": "ভাঙ্গা",
    "districtEn": "Faridpur",
    "districtBn": "ফরিদপুর"
  },
  {
    "en": "Boalmari",
    "bn": "বোয়ালমারী",
    "districtEn": "Faridpur",
    "districtBn": "ফরিদপুর"
  },
  {
    "en": "Charbhadrasan",
    "bn": "চরভদ্রাসন",
    "districtEn": "Faridpur",
    "districtBn": "ফরিদপুর"
  },
  {
    "en": "Madhukhali",
    "bn": "মধুখালী",
    "districtEn": "Faridpur",
    "districtBn": "ফরিদপুর"
  },
  {
    "en": "Nagarkanda",
    "bn": "নগরকান্দা",
    "districtEn": "Faridpur",
    "districtBn": "ফরিদপুর"
  },
  {
    "en": "Saltha",
    "bn": "সালথা",
    "districtEn": "Faridpur",
    "districtBn": "ফরিদপুর"
  },
  {
    "en": "Gopalganj Sadar",
    "bn": "গোপালগঞ্জ সদর",
    "districtEn": "Gopalganj",
    "districtBn": "গোপালগঞ্জ"
  },
  {
    "en": "Kashiani",
    "bn": "কাশিয়ানী",
    "districtEn": "Gopalganj",
    "districtBn": "গোপালগঞ্জ"
  },
  {
    "en": "Kotalipara",
    "bn": "কোটালীপাড়া",
    "districtEn": "Gopalganj",
    "districtBn": "গোপালগঞ্জ"
  },
  {
    "en": "Muksudpur",
    "bn": "মুকসুদপুর",
    "districtEn": "Gopalganj",
    "districtBn": "গোপালগঞ্জ"
  },
  {
    "en": "Tungipara",
    "bn": "টুংগীপাড়া",
    "districtEn": "Gopalganj",
    "districtBn": "গোপালগঞ্জ"
  },
  {
    "en": "Kishoreganj Sadar",
    "bn": "কিশোরগঞ্জ সদর",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Austagram",
    "bn": "অষ্টগ্রাম",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Bajitpur",
    "bn": "বাজিতপুর",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Bhairab",
    "bn": "ভৈরব",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Hossainpur",
    "bn": "হোসেনপুর",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Itna",
    "bn": "ইটনা",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Karimgonj",
    "bn": "করিমগঞ্জ",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Katiadi",
    "bn": "কটিয়াদী",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Kuliarchar",
    "bn": "কুলিয়ারচর",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Mithamoin",
    "bn": "মিঠামইন",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Nikli",
    "bn": "নিকলী",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Pakundia",
    "bn": "পাকুন্দিয়া",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Tarail",
    "bn": "তাড়াইল",
    "districtEn": "Kishoreganj",
    "districtBn": "কিশোরগঞ্জ"
  },
  {
    "en": "Madaripur Sadar",
    "bn": "মাদারীপুর সদর",
    "districtEn": "Madaripur",
    "districtBn": "মাদারীপুর"
  },
  {
    "en": "Dasar",
    "bn": "ডাসার",
    "districtEn": "Madaripur",
    "districtBn": "মাদারীপুর"
  },
  {
    "en": "Kalkini",
    "bn": "কালকিনি",
    "districtEn": "Madaripur",
    "districtBn": "মাদারীপুর"
  },
  {
    "en": "Rajoir",
    "bn": "রাজৈর",
    "districtEn": "Madaripur",
    "districtBn": "মাদারীপুর"
  },
  {
    "en": "Shibchar",
    "bn": "শিবচর",
    "districtEn": "Madaripur",
    "districtBn": "মাদারীপুর"
  },
  {
    "en": "Manikganj Sadar",
    "bn": "মানিকগঞ্জ সদর",
    "districtEn": "Manikganj",
    "districtBn": "মানিকগঞ্জ"
  },
  {
    "en": "Doulatpur",
    "bn": "দৌলতপুর",
    "districtEn": "Manikganj",
    "districtBn": "মানিকগঞ্জ"
  },
  {
    "en": "Gior",
    "bn": "ঘিওর",
    "districtEn": "Manikganj",
    "districtBn": "মানিকগঞ্জ"
  },
  {
    "en": "Harirampur",
    "bn": "হরিরামপুর",
    "districtEn": "Manikganj",
    "districtBn": "মানিকগঞ্জ"
  },
  {
    "en": "Saturia",
    "bn": "সাটুরিয়া",
    "districtEn": "Manikganj",
    "districtBn": "মানিকগঞ্জ"
  },
  {
    "en": "Shibaloy",
    "bn": "শিবালয়",
    "districtEn": "Manikganj",
    "districtBn": "মানিকগঞ্জ"
  },
  {
    "en": "Singiar",
    "bn": "সিংগাইর",
    "districtEn": "Manikganj",
    "districtBn": "মানিকগঞ্জ"
  },
  {
    "en": "Munshiganj Sadar",
    "bn": "মুন্সিগঞ্জ সদর",
    "districtEn": "Munshiganj",
    "districtBn": "মুন্সিগঞ্জ"
  },
  {
    "en": "Gajaria",
    "bn": "গজারিয়া",
    "districtEn": "Munshiganj",
    "districtBn": "মুন্সিগঞ্জ"
  },
  {
    "en": "Louhajanj",
    "bn": "লৌহজং",
    "districtEn": "Munshiganj",
    "districtBn": "মুন্সিগঞ্জ"
  },
  {
    "en": "Mirkadim",
    "bn": "মীরকাদিম",
    "districtEn": "Munshiganj",
    "districtBn": "মুন্সিগঞ্জ"
  },
  {
    "en": "Sirajdikhan",
    "bn": "সিরাজদিখান",
    "districtEn": "Munshiganj",
    "districtBn": "মুন্সিগঞ্জ"
  },
  {
    "en": "Sreenagar",
    "bn": "শ্রীনগর",
    "districtEn": "Munshiganj",
    "districtBn": "মুন্সিগঞ্জ"
  },
  {
    "en": "Tongibari",
    "bn": "টংগীবাড়ি",
    "districtEn": "Munshiganj",
    "districtBn": "মুন্সিগঞ্জ"
  },
  {
    "en": "Narsingdi Sadar",
    "bn": "নরসিংদী সদর",
    "districtEn": "Narsingdi",
    "districtBn": "নরসিংদী"
  },
  {
    "en": "Belabo",
    "bn": "বেলাবো",
    "districtEn": "Narsingdi",
    "districtBn": "নরসিংদী"
  },
  {
    "en": "Madhabdi",
    "bn": "মাধবদী",
    "districtEn": "Narsingdi",
    "districtBn": "নরসিংদী"
  },
  {
    "en": "Monohardi",
    "bn": "মনোহরদী",
    "districtEn": "Narsingdi",
    "districtBn": "নরসিংদী"
  },
  {
    "en": "Palash",
    "bn": "পলাশ",
    "districtEn": "Narsingdi",
    "districtBn": "নরসিংদী"
  },
  {
    "en": "Raipura",
    "bn": "রায়পুরা",
    "districtEn": "Narsingdi",
    "districtBn": "নরসিংদী"
  },
  {
    "en": "Shibpur",
    "bn": "শিবপুর",
    "districtEn": "Narsingdi",
    "districtBn": "নরসিংদী"
  },
  {
    "en": "Rajbari Sadar",
    "bn": "রাজবাড়ী সদর",
    "districtEn": "Rajbari",
    "districtBn": "রাজবাড়ী"
  },
  {
    "en": "Baliakandi",
    "bn": "বালিয়াকান্দি",
    "districtEn": "Rajbari",
    "districtBn": "রাজবাড়ী"
  },
  {
    "en": "Goalanda",
    "bn": "গোয়ালন্দ",
    "districtEn": "Rajbari",
    "districtBn": "রাজবাড়ী"
  },
  {
    "en": "Kalukhali",
    "bn": "কালুখালী",
    "districtEn": "Rajbari",
    "districtBn": "রাজবাড়ী"
  },
  {
    "en": "Pangsa",
    "bn": "পাংশা",
    "districtEn": "Rajbari",
    "districtBn": "রাজবাড়ী"
  },
  {
    "en": "Shariatpur Sadar",
    "bn": "শরিয়তপুর সদর",
    "districtEn": "Shariatpur",
    "districtBn": "শরীয়তপুর"
  },
  {
    "en": "Bhedarganj",
    "bn": "ভেদরগঞ্জ",
    "districtEn": "Shariatpur",
    "districtBn": "শরীয়তপুর"
  },
  {
    "en": "Damudya",
    "bn": "ডামুড্যা",
    "districtEn": "Shariatpur",
    "districtBn": "শরীয়তপুর"
  },
  {
    "en": "Gosairhat",
    "bn": "গোসাইরহাট",
    "districtEn": "Shariatpur",
    "districtBn": "শরীয়তপুর"
  },
  {
    "en": "Naria",
    "bn": "নড়িয়া",
    "districtEn": "Shariatpur",
    "districtBn": "শরীয়তপুর"
  },
  {
    "en": "Zajira",
    "bn": "জাজিরা",
    "districtEn": "Shariatpur",
    "districtBn": "শরীয়তপুর"
  },
  {
    "en": "Tangail Sadar",
    "bn": "টাঙ্গাইল সদর",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Basail",
    "bn": "বাসাইল",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Bhuapur",
    "bn": "ভুয়াপুর",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Delduar",
    "bn": "দেলদুয়ার",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Dhanbari",
    "bn": "ধনবাড়ী",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Ghatail",
    "bn": "ঘাটাইল",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Gopalpur",
    "bn": "গোপালপুর",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Kalihati",
    "bn": "কালিহাতী",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Madhupur",
    "bn": "মধুপুর",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Mirzapur",
    "bn": "মির্জাপুর",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Nagarpur",
    "bn": "নাগরপুর",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Sakhipur",
    "bn": "সখিপুর",
    "districtEn": "Tangail",
    "districtBn": "টাঙ্গাইল"
  },
  {
    "en": "Bandarban Sadar",
    "bn": "বান্দরবান সদর",
    "districtEn": "Bandarban",
    "districtBn": "বান্দরবান"
  },
  {
    "en": "Alikadam",
    "bn": "আলীকদম",
    "districtEn": "Bandarban",
    "districtBn": "বান্দরবান"
  },
  {
    "en": "Lama",
    "bn": "লামা",
    "districtEn": "Bandarban",
    "districtBn": "বান্দরবান"
  },
  {
    "en": "Naikhongchhari",
    "bn": "নাইক্ষ্যংছড়ি",
    "districtEn": "Bandarban",
    "districtBn": "বান্দরবান"
  },
  {
    "en": "Rowangchhari",
    "bn": "রোয়াংছড়ি",
    "districtEn": "Bandarban",
    "districtBn": "বান্দরবান"
  },
  {
    "en": "Ruma",
    "bn": "রুমা",
    "districtEn": "Bandarban",
    "districtBn": "বান্দরবান"
  },
  {
    "en": "Thanchi",
    "bn": "থানচি",
    "districtEn": "Bandarban",
    "districtBn": "বান্দরবান"
  },
  {
    "en": "Brahmanbaria Sadar",
    "bn": "ব্রাহ্মণবাড়িয়া সদর",
    "districtEn": "Brahmanbaria",
    "districtBn": "ব্রাহ্মণবাড়িয়া"
  },
  {
    "en": "Akhaura",
    "bn": "আখাউড়া",
    "districtEn": "Brahmanbaria",
    "districtBn": "ব্রাহ্মণবাড়িয়া"
  },
  {
    "en": "Ashuganj",
    "bn": "আশুগঞ্জ",
    "districtEn": "Brahmanbaria",
    "districtBn": "ব্রাহ্মণবাড়িয়া"
  },
  {
    "en": "Bancharampur",
    "bn": "বাঞ্ছারামপুর",
    "districtEn": "Brahmanbaria",
    "districtBn": "ব্রাহ্মণবাড়িয়া"
  },
  {
    "en": "Bijoynagar",
    "bn": "বিজয়নগর",
    "districtEn": "Brahmanbaria",
    "districtBn": "ব্রাহ্মণবাড়িয়া"
  },
  {
    "en": "Kasba",
    "bn": "কসবা",
    "districtEn": "Brahmanbaria",
    "districtBn": "ব্রাহ্মণবাড়িয়া"
  },
  {
    "en": "Nabinagar",
    "bn": "নবীনগর",
    "districtEn": "Brahmanbaria",
    "districtBn": "ব্রাহ্মণবাড়িয়া"
  },
  {
    "en": "Nasirnagar",
    "bn": "নাসিরনগর",
    "districtEn": "Brahmanbaria",
    "districtBn": "ব্রাহ্মণবাড়িয়া"
  },
  {
    "en": "Sarail",
    "bn": "সরাইল",
    "districtEn": "Brahmanbaria",
    "districtBn": "ব্রাহ্মণবাড়িয়া"
  },
  {
    "en": "Chandpur Sadar",
    "bn": "চাঁদপুর সদর",
    "districtEn": "Chandpur",
    "districtBn": "চাঁদপুর"
  },
  {
    "en": "Faridganj",
    "bn": "ফরিদগঞ্জ",
    "districtEn": "Chandpur",
    "districtBn": "চাঁদপুর"
  },
  {
    "en": "Haimchar",
    "bn": "হাইমচর",
    "districtEn": "Chandpur",
    "districtBn": "চাঁদপুর"
  },
  {
    "en": "Hajiganj",
    "bn": "হাজীগঞ্জ",
    "districtEn": "Chandpur",
    "districtBn": "চাঁদপুর"
  },
  {
    "en": "Kachua",
    "bn": "কচুয়া",
    "districtEn": "Chandpur",
    "districtBn": "চাঁদপুর"
  },
  {
    "en": "Matlab Dakshin",
    "bn": "মতলব দক্ষিণ",
    "districtEn": "Chandpur",
    "districtBn": "চাঁদপুর"
  },
  {
    "en": "Matlab Uttar",
    "bn": "মতলব উত্তর",
    "districtEn": "Chandpur",
    "districtBn": "চাঁদপুর"
  },
  {
    "en": "Shahrasti",
    "bn": "শাহরাস্তি",
    "districtEn": "Chandpur",
    "districtBn": "চাঁদপুর"
  },
  {
    "en": "Comilla Adarsha Sadar",
    "bn": "কুমিল্লা সদর",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Comilla Sadar Dakshin",
    "bn": "সদর দক্ষিণ",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Barura",
    "bn": "বরুড়া",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Brahmanpara",
    "bn": "ব্রাহ্মণপাড়া",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Burichang",
    "bn": "বুড়িচং",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Chandina",
    "bn": "চান্দিনা",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Chauddagram",
    "bn": "চৌদ্দগ্রাম",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Daudkandi",
    "bn": "দাউদকান্দি",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Debidwar",
    "bn": "দেবিদ্বার",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Homna",
    "bn": "হোমনা",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Laksam",
    "bn": "লাকসাম",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Lalmai",
    "bn": "লালমাই",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Meghna",
    "bn": "মেঘনা",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Monohargonj",
    "bn": "মনোহরগঞ্জ",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Muradnagar",
    "bn": "মুরাদনগর",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Nangalkot",
    "bn": "নাঙ্গলকোট",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Titas",
    "bn": "তিতাস",
    "districtEn": "Comilla",
    "districtBn": "কুমিল্লা"
  },
  {
    "en": "Coxsbazar Sadar",
    "bn": "কক্সবাজার সদর",
    "districtEn": "Cox's Bazar",
    "districtBn": "কক্সবাজার"
  },
  {
    "en": "Chakaria",
    "bn": "চকরিয়া",
    "districtEn": "Cox's Bazar",
    "districtBn": "কক্সবাজার"
  },
  {
    "en": "Eidgaon",
    "bn": "ঈদগাঁও",
    "districtEn": "Cox's Bazar",
    "districtBn": "কক্সবাজার"
  },
  {
    "en": "Kutubdia",
    "bn": "কুতুবদিয়া",
    "districtEn": "Cox's Bazar",
    "districtBn": "কক্সবাজার"
  },
  {
    "en": "Maheshkhali",
    "bn": "মহেশখালী",
    "districtEn": "Cox's Bazar",
    "districtBn": "কক্সবাজার"
  },
  {
    "en": "Pekua",
    "bn": "পেকুয়া",
    "districtEn": "Cox's Bazar",
    "districtBn": "কক্সবাজার"
  },
  {
    "en": "Ramu",
    "bn": "রামু",
    "districtEn": "Cox's Bazar",
    "districtBn": "কক্সবাজার"
  },
  {
    "en": "Teknaf",
    "bn": "টেকনাফ",
    "districtEn": "Cox's Bazar",
    "districtBn": "কক্সবাজার"
  },
  {
    "en": "Ukhia",
    "bn": "উখিয়া",
    "districtEn": "Cox's Bazar",
    "districtBn": "কক্সবাজার"
  },
  {
    "en": "Feni Sadar",
    "bn": "ফেনী সদর",
    "districtEn": "Feni",
    "districtBn": "ফেনী"
  },
  {
    "en": "Chhagalnaiya",
    "bn": "ছাগলনাইয়া",
    "districtEn": "Feni",
    "districtBn": "ফেনী"
  },
  {
    "en": "Daganbhuiyan",
    "bn": "দাগনভূঞা",
    "districtEn": "Feni",
    "districtBn": "ফেনী"
  },
  {
    "en": "Fulgazi",
    "bn": "ফুলগাজী",
    "districtEn": "Feni",
    "districtBn": "ফেনী"
  },
  {
    "en": "Parshuram",
    "bn": "পরশুরাম",
    "districtEn": "Feni",
    "districtBn": "ফেনী"
  },
  {
    "en": "Sonagazi",
    "bn": "সোনাগাজী",
    "districtEn": "Feni",
    "districtBn": "ফেনী"
  },
  {
    "en": "Khagrachhari Sadar",
    "bn": "খাগড়াছড়ি সদর",
    "districtEn": "Khagrachari",
    "districtBn": "খাগড়াছড়ি"
  },
  {
    "en": "Dighinala",
    "bn": "দিঘীনালা",
    "districtEn": "Khagrachari",
    "districtBn": "খাগড়াছড়ি"
  },
  {
    "en": "Guimara",
    "bn": "গুইমারা",
    "districtEn": "Khagrachari",
    "districtBn": "খাগড়াছড়ি"
  },
  {
    "en": "Laxmichhari",
    "bn": "লক্ষীছড়ি",
    "districtEn": "Khagrachari",
    "districtBn": "খাগড়াছড়ি"
  },
  {
    "en": "Manikchari",
    "bn": "মানিকছড়ি",
    "districtEn": "Khagrachari",
    "districtBn": "খাগড়াছড়ি"
  },
  {
    "en": "Matiranga",
    "bn": "মাটিরাঙ্গা",
    "districtEn": "Khagrachari",
    "districtBn": "খাগড়াছড়ি"
  },
  {
    "en": "Mohalchari",
    "bn": "মহালছড়ি",
    "districtEn": "Khagrachari",
    "districtBn": "খাগড়াছড়ি"
  },
  {
    "en": "Panchhari",
    "bn": "পানছড়ি",
    "districtEn": "Khagrachari",
    "districtBn": "খাগড়াছড়ি"
  },
  {
    "en": "Ramgarh",
    "bn": "রামগড়",
    "districtEn": "Khagrachari",
    "districtBn": "খাগড়াছড়ি"
  },
  {
    "en": "Lakshmipur Sadar",
    "bn": "লক্ষ্মীপুর সদর",
    "districtEn": "Lakshmipur",
    "districtBn": "লক্ষ্মীপুর"
  },
  {
    "en": "Kamalnagar",
    "bn": "কমলনগর",
    "districtEn": "Lakshmipur",
    "districtBn": "লক্ষ্মীপুর"
  },
  {
    "en": "Raipur",
    "bn": "রায়পুর",
    "districtEn": "Lakshmipur",
    "districtBn": "লক্ষ্মীপুর"
  },
  {
    "en": "Ramganj",
    "bn": "রামগঞ্জ",
    "districtEn": "Lakshmipur",
    "districtBn": "লক্ষ্মীপুর"
  },
  {
    "en": "Ramgati",
    "bn": "রামগতি",
    "districtEn": "Lakshmipur",
    "districtBn": "লক্ষ্মীপুর"
  },
  {
    "en": "Noakhali Sadar",
    "bn": "নোয়াখালী সদর",
    "districtEn": "Noakhali",
    "districtBn": "নোয়াখালী"
  },
  {
    "en": "Begumganj",
    "bn": "বেগমগঞ্জ",
    "districtEn": "Noakhali",
    "districtBn": "নোয়াখালী"
  },
  {
    "en": "Chatkhil",
    "bn": "চাটখিল",
    "districtEn": "Noakhali",
    "districtBn": "নোয়াখালী"
  },
  {
    "en": "Hatiya",
    "bn": "হাতিয়া",
    "districtEn": "Noakhali",
    "districtBn": "নোয়াখালী"
  },
  {
    "en": "Kabirhat",
    "bn": "কবিরহাট",
    "districtEn": "Noakhali",
    "districtBn": "নোয়াখালী"
  },
  {
    "en": "Senbagh",
    "bn": "সেনবাগ",
    "districtEn": "Noakhali",
    "districtBn": "নোয়াখালী"
  },
  {
    "en": "Sonaimuri",
    "bn": "সোনাইমুড়ী",
    "districtEn": "Noakhali",
    "districtBn": "নোয়াখালী"
  },
  {
    "en": "Subarnachar",
    "bn": "সুবর্ণচর",
    "districtEn": "Noakhali",
    "districtBn": "নোয়াখালী"
  },
  {
    "en": "Rangamati Sadar",
    "bn": "রাঙ্গামাটি সদর",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Baghaichhari",
    "bn": "বাঘাইছড়ি",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Barkal",
    "bn": "বরকল",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Belaichari",
    "bn": "বিলাইছড়ি",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Juraichari",
    "bn": "জুরাছড়ি",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Kaptai",
    "bn": "কাপ্তাই",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Kaukhali",
    "bn": "কাউখালী",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Langadu",
    "bn": "লংগদু",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Naniarchar",
    "bn": "নানিয়ারচর",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Rajasthali",
    "bn": "রাজস্থলী",
    "districtEn": "Rangamati",
    "districtBn": "রাঙ্গামাটি"
  },
  {
    "en": "Habiganj Sadar",
    "bn": "হবিগঞ্জ সদর",
    "districtEn": "Habiganj",
    "districtBn": "হবিগঞ্জ"
  },
  {
    "en": "Ajmiriganj",
    "bn": "আজমিরীগঞ্জ",
    "districtEn": "Habiganj",
    "districtBn": "হবিগঞ্জ"
  },
  {
    "en": "Bahubal",
    "bn": "বাহুবল",
    "districtEn": "Habiganj",
    "districtBn": "হবিগঞ্জ"
  },
  {
    "en": "Baniachong",
    "bn": "বানিয়াচং",
    "districtEn": "Habiganj",
    "districtBn": "হবিগঞ্জ"
  },
  {
    "en": "Chunarughat",
    "bn": "চুনারুঘাট",
    "districtEn": "Habiganj",
    "districtBn": "হবিগঞ্জ"
  },
  {
    "en": "Lakhai",
    "bn": "লাখাই",
    "districtEn": "Habiganj",
    "districtBn": "হবিগঞ্জ"
  },
  {
    "en": "Madhabpur",
    "bn": "মাধবপুর",
    "districtEn": "Habiganj",
    "districtBn": "হবিগঞ্জ"
  },
  {
    "en": "Nabiganj",
    "bn": "নবীগঞ্জ",
    "districtEn": "Habiganj",
    "districtBn": "হবিগঞ্জ"
  },
  {
    "en": "Shayestaganj",
    "bn": "শায়েস্তাগঞ্জ",
    "districtEn": "Habiganj",
    "districtBn": "হবিগঞ্জ"
  },
  {
    "en": "Moulvibazar Sadar",
    "bn": "মৌলভীবাজার সদর",
    "districtEn": "Moulvibazar",
    "districtBn": "মৌলভীবাজার"
  },
  {
    "en": "Barlekha",
    "bn": "বড়লেখা",
    "districtEn": "Moulvibazar",
    "districtBn": "মৌলভীবাজার"
  },
  {
    "en": "Juri",
    "bn": "জুড়ী",
    "districtEn": "Moulvibazar",
    "districtBn": "মৌলভীবাজার"
  },
  {
    "en": "Kamalganj",
    "bn": "কমলগঞ্জ",
    "districtEn": "Moulvibazar",
    "districtBn": "মৌলভীবাজার"
  },
  {
    "en": "Kulaura",
    "bn": "কুলাউড়া",
    "districtEn": "Moulvibazar",
    "districtBn": "মৌলভীবাজার"
  },
  {
    "en": "Rajnagar",
    "bn": "রাজনগর",
    "districtEn": "Moulvibazar",
    "districtBn": "মৌলভীবাজার"
  },
  {
    "en": "Sreemangal",
    "bn": "শ্রীমঙ্গল",
    "districtEn": "Moulvibazar",
    "districtBn": "মৌলভীবাজার"
  },
  {
    "en": "Sunamganj Sadar",
    "bn": "সুনামগঞ্জ সদর",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Bishwamvarpur",
    "bn": "বিশ্বম্ভরপুর",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Chhatak",
    "bn": "ছাতক",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Dharmapasha",
    "bn": "ধর্মপাশা",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Dirai",
    "bn": "দিরাই",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Dowarabazar",
    "bn": "দোয়ারাবাজার",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Jagannathpur",
    "bn": "জগন্নাথপুর",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Jamalganj",
    "bn": "জামালগঞ্জ",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Madhyanagar",
    "bn": "মধ্যনগর",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Shalla",
    "bn": "শাল্লা",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Shantiganj",
    "bn": "শান্তিগঞ্জ",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "South Sunamganj",
    "bn": "দক্ষিণ সুনামগঞ্জ",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Tahirpur",
    "bn": "তাহিরপুর",
    "districtEn": "Sunamganj",
    "districtBn": "সুনামগঞ্জ"
  },
  {
    "en": "Bogura Sadar",
    "bn": "বগুড়া সদর",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Adamdighi",
    "bn": "আদমদিঘি",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Dhunat",
    "bn": "ধুনট",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Dupchanchia",
    "bn": "দুপচাচিঁয়া",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Gabtali",
    "bn": "গাবতলী",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Kahaloo",
    "bn": "কাহালু",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Nandigram",
    "bn": "নন্দিগ্রাম",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Sariakandi",
    "bn": "সারিয়াকান্দি",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Shajahanpur",
    "bn": "শাজাহানপুর",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Sherpur",
    "bn": "শেরপুর",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Shibganj",
    "bn": "শিবগঞ্জ",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Sonatola",
    "bn": "সোনাতলা",
    "districtEn": "Bogura",
    "districtBn": "বগুড়া"
  },
  {
    "en": "Chapainawabganj Sadar",
    "bn": "চাঁপাইনবাবগঞ্জ সদর",
    "districtEn": "Chapainawabganj",
    "districtBn": "চাঁপাইনবাবগঞ্জ"
  },
  {
    "en": "Bholahat",
    "bn": "ভোলাহাট",
    "districtEn": "Chapainawabganj",
    "districtBn": "চাঁপাইনবাবগঞ্জ"
  },
  {
    "en": "Gomastapur",
    "bn": "গোমস্তাপুর",
    "districtEn": "Chapainawabganj",
    "districtBn": "চাঁপাইনবাবগঞ্জ"
  },
  {
    "en": "Nachole",
    "bn": "নাচোল",
    "districtEn": "Chapainawabganj",
    "districtBn": "চাঁপাইনবাবগঞ্জ"
  },
  {
    "en": "Joypurhat Sadar",
    "bn": "জয়পুরহাট সদর",
    "districtEn": "Joypurhat",
    "districtBn": "জয়পুরহাট"
  },
  {
    "en": "Akkelpur",
    "bn": "আক্কেলপুর",
    "districtEn": "Joypurhat",
    "districtBn": "জয়পুরহাট"
  },
  {
    "en": "Kalai",
    "bn": "কালাই",
    "districtEn": "Joypurhat",
    "districtBn": "জয়পুরহাট"
  },
  {
    "en": "Khetlal",
    "bn": "ক্ষেতলাল",
    "districtEn": "Joypurhat",
    "districtBn": "জয়পুরহাট"
  },
  {
    "en": "Panchbibi",
    "bn": "পাঁচবিবি",
    "districtEn": "Joypurhat",
    "districtBn": "জয়পুরহাট"
  },
  {
    "en": "Naogaon Sadar",
    "bn": "নওগাঁ সদর",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Atrai",
    "bn": "আত্রাই",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Badalgachhi",
    "bn": "বদলগাছী",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Dhamoirhat",
    "bn": "ধামইরহাট",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Mahadebpur",
    "bn": "মহাদেবপুর",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Manda",
    "bn": "মান্দা",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Niamatpur",
    "bn": "নিয়ামতপুর",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Patnitala",
    "bn": "পত্নিতলা",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Porsha",
    "bn": "পোরশা",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Raninagar",
    "bn": "রাণীনগর",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Sapahar",
    "bn": "সাপাহার",
    "districtEn": "Naogaon",
    "districtBn": "নওগাঁ"
  },
  {
    "en": "Natore Sadar",
    "bn": "নাটোর সদর",
    "districtEn": "Natore",
    "districtBn": "নাটোর"
  },
  {
    "en": "Bagatipara",
    "bn": "বাগাতিপাড়া",
    "districtEn": "Natore",
    "districtBn": "নাটোর"
  },
  {
    "en": "Baraigram",
    "bn": "বড়াইগ্রাম",
    "districtEn": "Natore",
    "districtBn": "নাটোর"
  },
  {
    "en": "Gurudaspur",
    "bn": "গুরুদাসপুর",
    "districtEn": "Natore",
    "districtBn": "নাটোর"
  },
  {
    "en": "Lalpur",
    "bn": "লালপুর",
    "districtEn": "Natore",
    "districtBn": "নাটোর"
  },
  {
    "en": "Naldanga",
    "bn": "নলডাঙ্গা",
    "districtEn": "Natore",
    "districtBn": "নাটোর"
  },
  {
    "en": "Singra",
    "bn": "সিংড়া",
    "districtEn": "Natore",
    "districtBn": "নাটোর"
  },
  {
    "en": "Pabna Sadar",
    "bn": "পাবনা সদর",
    "districtEn": "Pabna",
    "districtBn": "পাবনা"
  },
  {
    "en": "Atgharia",
    "bn": "আটঘরিয়া",
    "districtEn": "Pabna",
    "districtBn": "পাবনা"
  },
  {
    "en": "Bera",
    "bn": "বেড়া",
    "districtEn": "Pabna",
    "districtBn": "পাবনা"
  },
  {
    "en": "Bhangura",
    "bn": "ভাঙ্গুড়া",
    "districtEn": "Pabna",
    "districtBn": "পাবনা"
  },
  {
    "en": "Chatmohar",
    "bn": "চাটমোহর",
    "districtEn": "Pabna",
    "districtBn": "পাবনা"
  },
  {
    "en": "Faridpur",
    "bn": "ফরিদপুর",
    "districtEn": "Pabna",
    "districtBn": "পাবনা"
  },
  {
    "en": "Ishwardi",
    "bn": "ঈশ্বরদী",
    "districtEn": "Pabna",
    "districtBn": "পাবনা"
  },
  {
    "en": "Santhia",
    "bn": "সাঁথিয়া",
    "districtEn": "Pabna",
    "districtBn": "পাবনা"
  },
  {
    "en": "Sujanagar",
    "bn": "সুজানগর",
    "districtEn": "Pabna",
    "districtBn": "পাবনা"
  },
  {
    "en": "Sirajganj Sadar",
    "bn": "সিরাজগঞ্জ সদর",
    "districtEn": "Sirajganj",
    "districtBn": "সিরাজগঞ্জ"
  },
  {
    "en": "Belkuchi",
    "bn": "বেলকুচি",
    "districtEn": "Sirajganj",
    "districtBn": "সিরাজগঞ্জ"
  },
  {
    "en": "Chauhali",
    "bn": "চৌহালি",
    "districtEn": "Sirajganj",
    "districtBn": "সিরাজগঞ্জ"
  },
  {
    "en": "Kamarkhanda",
    "bn": "কামারখন্দ",
    "districtEn": "Sirajganj",
    "districtBn": "সিরাজগঞ্জ"
  },
  {
    "en": "Kazipur",
    "bn": "কাজীপুর",
    "districtEn": "Sirajganj",
    "districtBn": "সিরাজগঞ্জ"
  },
  {
    "en": "Raiganj",
    "bn": "রায়গঞ্জ",
    "districtEn": "Sirajganj",
    "districtBn": "সিরাজগঞ্জ"
  },
  {
    "en": "Shahjadpur",
    "bn": "শাহজাদপুর",
    "districtEn": "Sirajganj",
    "districtBn": "সিরাজগঞ্জ"
  },
  {
    "en": "Tarash",
    "bn": "তাড়াশ",
    "districtEn": "Sirajganj",
    "districtBn": "সিরাজগঞ্জ"
  },
  {
    "en": "Ullapara",
    "bn": "উল্লাপাড়া",
    "districtEn": "Sirajganj",
    "districtBn": "সিরাজগঞ্জ"
  },
  {
    "en": "Bagerhat Sadar",
    "bn": "বাগেরহাট সদর",
    "districtEn": "Bagerhat",
    "districtBn": "বাগেরহাট"
  },
  {
    "en": "Chitalmari",
    "bn": "চিতলমারী",
    "districtEn": "Bagerhat",
    "districtBn": "বাগেরহাট"
  },
  {
    "en": "Fakirhat",
    "bn": "ফকিরহাট",
    "districtEn": "Bagerhat",
    "districtBn": "বাগেরহাট"
  },
  {
    "en": "Mollahat",
    "bn": "মোল্লাহাট",
    "districtEn": "Bagerhat",
    "districtBn": "বাগেরহাট"
  },
  {
    "en": "Mongla",
    "bn": "মোংলা",
    "districtEn": "Bagerhat",
    "districtBn": "বাগেরহাট"
  },
  {
    "en": "Morrelganj",
    "bn": "মোড়েলগঞ্জ",
    "districtEn": "Bagerhat",
    "districtBn": "বাগেরহাট"
  },
  {
    "en": "Rampal",
    "bn": "রামপাল",
    "districtEn": "Bagerhat",
    "districtBn": "বাগেরহাট"
  },
  {
    "en": "Sarankhola",
    "bn": "শরণখোলা",
    "districtEn": "Bagerhat",
    "districtBn": "বাগেরহাট"
  },
  {
    "en": "Chuadanga Sadar",
    "bn": "চুয়াডাঙ্গা সদর",
    "districtEn": "Chuadanga",
    "districtBn": "চুয়াডাঙ্গা"
  },
  {
    "en": "Alamdanga",
    "bn": "আলমডাঙ্গা",
    "districtEn": "Chuadanga",
    "districtBn": "চুয়াডাঙ্গা"
  },
  {
    "en": "Damurhuda",
    "bn": "দামুড়হুদা",
    "districtEn": "Chuadanga",
    "districtBn": "চুয়াডাঙ্গা"
  },
  {
    "en": "Jibannagar",
    "bn": "জীবননগর",
    "districtEn": "Chuadanga",
    "districtBn": "চুয়াডাঙ্গা"
  },
  {
    "en": "Jashore Sadar",
    "bn": "যশোর সদর",
    "districtEn": "Jashore",
    "districtBn": "যশোর"
  },
  {
    "en": "Abhaynagar",
    "bn": "অভয়নগর",
    "districtEn": "Jashore",
    "districtBn": "যশোর"
  },
  {
    "en": "Bagherpara",
    "bn": "বাঘারপাড়া",
    "districtEn": "Jashore",
    "districtBn": "যশোর"
  },
  {
    "en": "Chaugachha",
    "bn": "চৌগাছা",
    "districtEn": "Jashore",
    "districtBn": "যশোর"
  },
  {
    "en": "Jhikargachha",
    "bn": "ঝিকরগাছা",
    "districtEn": "Jashore",
    "districtBn": "যশোর"
  },
  {
    "en": "Keshabpur",
    "bn": "কেশবপুর",
    "districtEn": "Jashore",
    "districtBn": "যশোর"
  },
  {
    "en": "Manirampur",
    "bn": "মণিরামপুর",
    "districtEn": "Jashore",
    "districtBn": "যশোর"
  },
  {
    "en": "Sharsha",
    "bn": "শার্শা",
    "districtEn": "Jashore",
    "districtBn": "যশোর"
  },
  {
    "en": "Jhenaidah Sadar",
    "bn": "ঝিনাইদহ সদর",
    "districtEn": "Jhenaidah",
    "districtBn": "ঝিনাইদহ"
  },
  {
    "en": "Harinakunda",
    "bn": "হরিণাকুন্ডু",
    "districtEn": "Jhenaidah",
    "districtBn": "ঝিনাইদহ"
  },
  {
    "en": "Kotchandpur",
    "bn": "কোটচাঁদপুর",
    "districtEn": "Jhenaidah",
    "districtBn": "ঝিনাইদহ"
  },
  {
    "en": "Maheshpur",
    "bn": "মহেশপুর",
    "districtEn": "Jhenaidah",
    "districtBn": "ঝিনাইদহ"
  },
  {
    "en": "Shailkupa",
    "bn": "শৈলকুপা",
    "districtEn": "Jhenaidah",
    "districtBn": "ঝিনাইদহ"
  },
  {
    "en": "Kushtia Sadar",
    "bn": "কুষ্টিয়া সদর",
    "districtEn": "Kushtia",
    "districtBn": "কুষ্টিয়া"
  },
  {
    "en": "Bheramara",
    "bn": "ভেড়ামারা",
    "districtEn": "Kushtia",
    "districtBn": "কুষ্টিয়া"
  },
  {
    "en": "Khoksa",
    "bn": "খোকসা",
    "districtEn": "Kushtia",
    "districtBn": "কুষ্টিয়া"
  },
  {
    "en": "Kumarkhali",
    "bn": "কুমারখালী",
    "districtEn": "Kushtia",
    "districtBn": "কুষ্টিয়া"
  },
  {
    "en": "Magura Sadar",
    "bn": "মাগুরা সদর",
    "districtEn": "Magura",
    "districtBn": "মাগুরা"
  },
  {
    "en": "Shalikha",
    "bn": "শালিখা",
    "districtEn": "Magura",
    "districtBn": "মাগুরা"
  },
  {
    "en": "Meherpur Sadar",
    "bn": "মেহেরপুর সদর",
    "districtEn": "Meherpur",
    "districtBn": "মেহেরপুর"
  },
  {
    "en": "Gangni",
    "bn": "গাংনী",
    "districtEn": "Meherpur",
    "districtBn": "মেহেরপুর"
  },
  {
    "en": "Mujibnagar",
    "bn": "মুজিবনগর",
    "districtEn": "Meherpur",
    "districtBn": "মেহেরপুর"
  },
  {
    "en": "Narail Sadar",
    "bn": "নড়াইল সদর",
    "districtEn": "Narail",
    "districtBn": "নড়াইল"
  },
  {
    "en": "Kalia",
    "bn": "কালিয়া",
    "districtEn": "Narail",
    "districtBn": "নড়াইল"
  },
  {
    "en": "Satkhira Sadar",
    "bn": "সাতক্ষীরা সদর",
    "districtEn": "Satkhira",
    "districtBn": "সাতক্ষীরা"
  },
  {
    "en": "Assasuni",
    "bn": "আশাশুনি",
    "districtEn": "Satkhira",
    "districtBn": "সাতক্ষীরা"
  },
  {
    "en": "Debhata",
    "bn": "দেবহাটা",
    "districtEn": "Satkhira",
    "districtBn": "সাতক্ষীরা"
  },
  {
    "en": "Kalaroa",
    "bn": "কলারোয়া",
    "districtEn": "Satkhira",
    "districtBn": "সাতক্ষীরা"
  },
  {
    "en": "Shyamnagar",
    "bn": "শ্যামনগর",
    "districtEn": "Satkhira",
    "districtBn": "সাতক্ষীরা"
  },
  {
    "en": "Tala",
    "bn": "তালা",
    "districtEn": "Satkhira",
    "districtBn": "সাতক্ষীরা"
  },
  {
    "en": "Barguna Sadar",
    "bn": "বরগুনা সদর",
    "districtEn": "Barguna",
    "districtBn": "বরগুনা"
  },
  {
    "en": "Amtali",
    "bn": "আমতলী",
    "districtEn": "Barguna",
    "districtBn": "বরগুনা"
  },
  {
    "en": "Bamna",
    "bn": "বামনা",
    "districtEn": "Barguna",
    "districtBn": "বরগুনা"
  },
  {
    "en": "Betagi",
    "bn": "বেতাগী",
    "districtEn": "Barguna",
    "districtBn": "বরগুনা"
  },
  {
    "en": "Patharghata",
    "bn": "পাথরঘাটা",
    "districtEn": "Barguna",
    "districtBn": "বরগুনা"
  },
  {
    "en": "Taltali",
    "bn": "তালতলি",
    "districtEn": "Barguna",
    "districtBn": "বরগুনা"
  },
  {
    "en": "Barishal Sadar",
    "bn": "বরিশাল সদর",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Kotwali Model",
    "bn": "কোতোয়ালি মডেল",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Agailjhara",
    "bn": "আগৈলঝাড়া",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Babuganj",
    "bn": "বাবুগঞ্জ",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Bakerganj",
    "bn": "বাকেরগঞ্জ",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Banaripara",
    "bn": "বানারীপাড়া",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Gournadi",
    "bn": "গৌরনদী",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Hizla",
    "bn": "হিজলা",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Kaunia",
    "bn": "কাউনিয়া",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Mehendiganj",
    "bn": "মেহেন্দিগঞ্জ",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Muladi",
    "bn": "মুলাদী",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Wazirpur",
    "bn": "উজিরপুর",
    "districtEn": "Barishal",
    "districtBn": "বরিশাল"
  },
  {
    "en": "Bhola Sadar",
    "bn": "ভোলা সদর",
    "districtEn": "Bhola",
    "districtBn": "ভোলা"
  },
  {
    "en": "Borhanuddin",
    "bn": "বোরহান উদ্দিন",
    "districtEn": "Bhola",
    "districtBn": "ভোলা"
  },
  {
    "en": "Char Fasson",
    "bn": "চরফ্যাশন",
    "districtEn": "Bhola",
    "districtBn": "ভোলা"
  },
  {
    "en": "Daulatkhan",
    "bn": "দৌলতখান",
    "districtEn": "Bhola",
    "districtBn": "ভোলা"
  },
  {
    "en": "Lalmohan",
    "bn": "লালমোহন",
    "districtEn": "Bhola",
    "districtBn": "ভোলা"
  },
  {
    "en": "Manpura",
    "bn": "মনপুরা",
    "districtEn": "Bhola",
    "districtBn": "ভোলা"
  },
  {
    "en": "Tazumuddin",
    "bn": "তজুমদ্দিন",
    "districtEn": "Bhola",
    "districtBn": "ভোলা"
  },
  {
    "en": "Jhalokati Sadar",
    "bn": "ঝালকাঠি সদর",
    "districtEn": "Jhalokati",
    "districtBn": "ঝালকাঠি"
  },
  {
    "en": "Kathalia",
    "bn": "কাঠালিয়া",
    "districtEn": "Jhalokati",
    "districtBn": "ঝালকাঠি"
  },
  {
    "en": "Nalchity",
    "bn": "নলছিটি",
    "districtEn": "Jhalokati",
    "districtBn": "ঝালকাঠি"
  },
  {
    "en": "Rajapur",
    "bn": "রাজাপুর",
    "districtEn": "Jhalokati",
    "districtBn": "ঝালকাঠি"
  },
  {
    "en": "Patuakhali Sadar",
    "bn": "পটুয়াখালী সদর",
    "districtEn": "Patuakhali",
    "districtBn": "পটুয়াখালী"
  },
  {
    "en": "Bauphal",
    "bn": "বাউফল",
    "districtEn": "Patuakhali",
    "districtBn": "পটুয়াখালী"
  },
  {
    "en": "Dashmina",
    "bn": "দশমিনা",
    "districtEn": "Patuakhali",
    "districtBn": "পটুয়াখালী"
  },
  {
    "en": "Dumki",
    "bn": "দুমকি",
    "districtEn": "Patuakhali",
    "districtBn": "পটুয়াখালী"
  },
  {
    "en": "Galachipa",
    "bn": "গলাচিপা",
    "districtEn": "Patuakhali",
    "districtBn": "পটুয়াখালী"
  },
  {
    "en": "Kalapara",
    "bn": "কলাপাড়া",
    "districtEn": "Patuakhali",
    "districtBn": "পটুয়াখালী"
  },
  {
    "en": "Mirzaganj",
    "bn": "মির্জাগঞ্জ",
    "districtEn": "Patuakhali",
    "districtBn": "পটুয়াখালী"
  },
  {
    "en": "Rangabali",
    "bn": "রাঙ্গাবালী",
    "districtEn": "Patuakhali",
    "districtBn": "পটুয়াখালী"
  },
  {
    "en": "Pirojpur Sadar",
    "bn": "পিরোজপুর সদর",
    "districtEn": "Pirojpur",
    "districtBn": "পিরোজপুর"
  },
  {
    "en": "Bhandaria",
    "bn": "ভান্ডারিয়া",
    "districtEn": "Pirojpur",
    "districtBn": "পিরোজপুর"
  },
  {
    "en": "Kawkhali",
    "bn": "কাউখালী",
    "districtEn": "Pirojpur",
    "districtBn": "পিরোজপুর"
  },
  {
    "en": "Mathbaria",
    "bn": "মঠবাড়ীয়া",
    "districtEn": "Pirojpur",
    "districtBn": "পিরোজপুর"
  },
  {
    "en": "Nazirpur",
    "bn": "নাজিরপুর",
    "districtEn": "Pirojpur",
    "districtBn": "পিরোজপুর"
  },
  {
    "en": "Nesarabad",
    "bn": "নেছারাবাদ",
    "districtEn": "Pirojpur",
    "districtBn": "পিরোজপুর"
  },
  {
    "en": "Zianagar",
    "bn": "জিয়ানগর",
    "districtEn": "Pirojpur",
    "districtBn": "পিরোজপুর"
  },
  {
    "en": "Dinajpur Sadar",
    "bn": "দিনাজপুর সদর",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Biral",
    "bn": "বিরল",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Birampur",
    "bn": "বিরামপুর",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Birganj",
    "bn": "বীরগঞ্জ",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Bochaganj",
    "bn": "বোচাগঞ্জ",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Chirirbandar",
    "bn": "চিরিরবন্দর",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Ghoraghat",
    "bn": "ঘোড়াঘাট",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Hakimpur",
    "bn": "হাকিমপুর",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Kaharole",
    "bn": "কাহারোল",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Khansama",
    "bn": "খানসামা",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Parbatipur",
    "bn": "পার্বতীপুর",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Phulbari",
    "bn": "ফুলবাড়ী",
    "districtEn": "Dinajpur",
    "districtBn": "দিনাজপুর"
  },
  {
    "en": "Gaibandha Sadar",
    "bn": "গাইবান্ধা সদর",
    "districtEn": "Gaibandha",
    "districtBn": "গাইবান্ধা"
  },
  {
    "en": "Gobindaganj",
    "bn": "গোবিন্দগঞ্জ",
    "districtEn": "Gaibandha",
    "districtBn": "গাইবান্ধা"
  },
  {
    "en": "Palashbari",
    "bn": "পলাশবাড়ী",
    "districtEn": "Gaibandha",
    "districtBn": "গাইবান্ধা"
  },
  {
    "en": "Phulchhari",
    "bn": "ফুলছড়ি",
    "districtEn": "Gaibandha",
    "districtBn": "গাইবান্ধা"
  },
  {
    "en": "Sadullapur",
    "bn": "সাদুল্লাপুর",
    "districtEn": "Gaibandha",
    "districtBn": "গাইবান্ধা"
  },
  {
    "en": "Saghata",
    "bn": "সাঘাটা",
    "districtEn": "Gaibandha",
    "districtBn": "গাইবান্ধা"
  },
  {
    "en": "Sundarganj",
    "bn": "সুন্দরগঞ্জ",
    "districtEn": "Gaibandha",
    "districtBn": "গাইবান্ধা"
  },
  {
    "en": "Kurigram Sadar",
    "bn": "কুড়িগ্রাম সদর",
    "districtEn": "Kurigram",
    "districtBn": "কুড়িগ্রাম"
  },
  {
    "en": "Bhurungamari",
    "bn": "ভুরুঙ্গামারী",
    "districtEn": "Kurigram",
    "districtBn": "কুড়িগ্রাম"
  },
  {
    "en": "Charrajibpur",
    "bn": "চর রাজিবপুর",
    "districtEn": "Kurigram",
    "districtBn": "কুড়িগ্রাম"
  },
  {
    "en": "Chilmari",
    "bn": "চিলমারী",
    "districtEn": "Kurigram",
    "districtBn": "কুড়িগ্রাম"
  },
  {
    "en": "Nageshwari",
    "bn": "নাগেশ্বরী",
    "districtEn": "Kurigram",
    "districtBn": "কুড়িগ্রাম"
  },
  {
    "en": "Rajarhat",
    "bn": "রাজারহাট",
    "districtEn": "Kurigram",
    "districtBn": "কুড়িগ্রাম"
  },
  {
    "en": "Rowmari",
    "bn": "রৌমারী",
    "districtEn": "Kurigram",
    "districtBn": "কুড়িগ্রাম"
  },
  {
    "en": "Ulipur",
    "bn": "উলিপুর",
    "districtEn": "Kurigram",
    "districtBn": "কুড়িগ্রাম"
  },
  {
    "en": "Lalmonirhat Sadar",
    "bn": "লালমনিরহাট সদর",
    "districtEn": "Lalmonirhat",
    "districtBn": "লালমনিরহাট"
  },
  {
    "en": "Aditmari",
    "bn": "আদিতমারী",
    "districtEn": "Lalmonirhat",
    "districtBn": "লালমনিরহাট"
  },
  {
    "en": "Hatibandha",
    "bn": "হাতীবান্ধা",
    "districtEn": "Lalmonirhat",
    "districtBn": "লালমনিরহাট"
  },
  {
    "en": "Patgram",
    "bn": "পাটগ্রাম",
    "districtEn": "Lalmonirhat",
    "districtBn": "লালমনিরহাট"
  },
  {
    "en": "Nilphamari Sadar",
    "bn": "নীলফামারী সদর",
    "districtEn": "Nilphamari",
    "districtBn": "নীলফামারী"
  },
  {
    "en": "Dimla",
    "bn": "ডিমলা",
    "districtEn": "Nilphamari",
    "districtBn": "নীলফামারী"
  },
  {
    "en": "Domar",
    "bn": "ডোমার",
    "districtEn": "Nilphamari",
    "districtBn": "নীলফামারী"
  },
  {
    "en": "Jaldhaka",
    "bn": "জলঢাকা",
    "districtEn": "Nilphamari",
    "districtBn": "নীলফামারী"
  },
  {
    "en": "Kishoreganj",
    "bn": "কিশোরগঞ্জ",
    "districtEn": "Nilphamari",
    "districtBn": "নীলফামারী"
  },
  {
    "en": "Saidpur",
    "bn": "সৈয়দপুর",
    "districtEn": "Nilphamari",
    "districtBn": "নীলফামারী"
  },
  {
    "en": "Panchagarh Sadar",
    "bn": "পঞ্চগড় সদর",
    "districtEn": "Panchagarh",
    "districtBn": "পঞ্চগড়"
  },
  {
    "en": "Atwari",
    "bn": "আটোয়ারী",
    "districtEn": "Panchagarh",
    "districtBn": "পঞ্চগড়"
  },
  {
    "en": "Boda",
    "bn": "বোদা",
    "districtEn": "Panchagarh",
    "districtBn": "পঞ্চগড়"
  },
  {
    "en": "Debiganj",
    "bn": "দেবীগঞ্জ",
    "districtEn": "Panchagarh",
    "districtBn": "পঞ্চগড়"
  },
  {
    "en": "Tetulia",
    "bn": "তেতুলিয়া",
    "districtEn": "Panchagarh",
    "districtBn": "পঞ্চগড়"
  },
  {
    "en": "Rangpur Sadar",
    "bn": "রংপুর সদর",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Badarganj",
    "bn": "বদরগঞ্জ",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Gangachara",
    "bn": "গংগাচড়া",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Haragachh",
    "bn": "হারাগাছ",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Hazirhat",
    "bn": "হাজিরহাট",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Mahiganj",
    "bn": "মাহিগঞ্জ",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Mithapukur",
    "bn": "মিঠাপুকুর",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Pirgachha",
    "bn": "পীরগাছা",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Pirganj",
    "bn": "পীরগঞ্জ",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Tajhat",
    "bn": "তাজহাট",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Taraganj",
    "bn": "তারাগঞ্জ",
    "districtEn": "Rangpur",
    "districtBn": "রংপুর"
  },
  {
    "en": "Thakurgaon Sadar",
    "bn": "ঠাকুরগাঁও সদর",
    "districtEn": "Thakurgaon",
    "districtBn": "ঠাকুরগাঁও"
  },
  {
    "en": "Baliadangi",
    "bn": "বালিয়াডাঙ্গী",
    "districtEn": "Thakurgaon",
    "districtBn": "ঠাকুরগাঁও"
  },
  {
    "en": "Haripur",
    "bn": "হরিপুর",
    "districtEn": "Thakurgaon",
    "districtBn": "ঠাকুরগাঁও"
  },
  {
    "en": "Ranisankail",
    "bn": "রাণীশংকৈল",
    "districtEn": "Thakurgaon",
    "districtBn": "ঠাকুরগাঁও"
  },
  {
    "en": "Jamalpur Sadar",
    "bn": "জামালপুর সদর",
    "districtEn": "Jamalpur",
    "districtBn": "জামালপুর"
  },
  {
    "en": "Bakshiganj",
    "bn": "বকশীগঞ্জ",
    "districtEn": "Jamalpur",
    "districtBn": "জামালপুর"
  },
  {
    "en": "Dewanganj",
    "bn": "দেওয়ানগঞ্জ",
    "districtEn": "Jamalpur",
    "districtBn": "জামালপুর"
  },
  {
    "en": "Islampur",
    "bn": "ইসলামপুর",
    "districtEn": "Jamalpur",
    "districtBn": "জামালপুর"
  },
  {
    "en": "Madarganj",
    "bn": "মাদারগঞ্জ",
    "districtEn": "Jamalpur",
    "districtBn": "জামালপুর"
  },
  {
    "en": "Melandaha",
    "bn": "মেলান্দহ",
    "districtEn": "Jamalpur",
    "districtBn": "জামালপুর"
  },
  {
    "en": "Sarishabari",
    "bn": "সরিষাবাড়ী",
    "districtEn": "Jamalpur",
    "districtBn": "জামালপুর"
  },
  {
    "en": "Mymensingh Sadar",
    "bn": "ময়মনসিংহ সদর",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Bhaluka",
    "bn": "ভালুকা",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Dhobaura",
    "bn": "ধোবাউড়া",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Fulbaria",
    "bn": "ফুলবাড়ীয়া",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Gaffargaon",
    "bn": "গফরগাঁও",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Gauripur",
    "bn": "গৌরীপুর",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Haluaghat",
    "bn": "হালুয়াঘাট",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Ishwarganj",
    "bn": "ঈশ্বরগঞ্জ",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Muktagachha",
    "bn": "মুক্তাগাছা",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Nandail",
    "bn": "নান্দাইল",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Phulpur",
    "bn": "ফুলপুর",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Tarakanda",
    "bn": "তারাকান্দা",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Trishal",
    "bn": "ত্রিশাল",
    "districtEn": "Mymensingh",
    "districtBn": "ময়মনসিংহ"
  },
  {
    "en": "Netrokona Sadar",
    "bn": "নেত্রকোণা সদর",
    "districtEn": "Netrokona",
    "districtBn": "নেত্রকোণা"
  },
  {
    "en": "Atpara",
    "bn": "আটপাড়া",
    "districtEn": "Netrokona",
    "districtBn": "নেত্রকোণা"
  },
  {
    "en": "Barhatta",
    "bn": "বারহাট্টা",
    "districtEn": "Netrokona",
    "districtBn": "নেত্রকোণা"
  },
  {
    "en": "Kalmakanda",
    "bn": "কলমাকান্দা",
    "districtEn": "Netrokona",
    "districtBn": "নেত্রকোণা"
  },
  {
    "en": "Kendua",
    "bn": "কেন্দুয়া",
    "districtEn": "Netrokona",
    "districtBn": "নেত্রকোণা"
  },
  {
    "en": "Khaliajuri",
    "bn": "খালিয়াজুরী",
    "districtEn": "Netrokona",
    "districtBn": "নেত্রকোণা"
  },
  {
    "en": "Madan",
    "bn": "মদন",
    "districtEn": "Netrokona",
    "districtBn": "নেত্রকোণা"
  },
  {
    "en": "Mohanganj",
    "bn": "মোহনগঞ্জ",
    "districtEn": "Netrokona",
    "districtBn": "নেত্রকোণা"
  },
  {
    "en": "Purbadhala",
    "bn": "পূর্বধলা",
    "districtEn": "Netrokona",
    "districtBn": "নেত্রকোণা"
  },
  {
    "en": "Sherpur Sadar",
    "bn": "শেরপুর সদর",
    "districtEn": "Sherpur",
    "districtBn": "শেরপুর"
  },
  {
    "en": "Jhenaigati",
    "bn": "ঝিনাইগাতী",
    "districtEn": "Sherpur",
    "districtBn": "শেরপুর"
  },
  {
    "en": "Nakla",
    "bn": "নকলা",
    "districtEn": "Sherpur",
    "districtBn": "শেরপুর"
  },
  {
    "en": "Nalitabari",
    "bn": "নালিতাবাড়ী",
    "districtEn": "Sherpur",
    "districtBn": "শেরপুর"
  },
  {
    "en": "Sreebardi",
    "bn": "শ্রীবরদী",
    "districtEn": "Sherpur",
    "districtBn": "শেরপুর"
  }
];

/** @type {Record<string, string>} */
const THANA_ALIASES = {
  "adabar": "Adabar",
  "আদাবর": "Adabar",
  "airport": "Airport",
  "বিমানবন্দর": "Airport",
  "ashulia": "Ashulia",
  "আশুলিয়া": "Ashulia",
  "badda": "Badda",
  "বাড্ডা": "Badda",
  "banani": "Banani",
  "বনানী": "Banani",
  "bangshal": "Bangshal",
  "বংশাল": "Bangshal",
  "baridhara": "Baridhara",
  "বারিধারা": "Baridhara",
  "bhashantek": "Bhashantek",
  "ভাষানটেক": "Bhashantek",
  "bhatara": "Bhatara",
  "ভাটারা": "Bhatara",
  "cantonment": "Cantonment",
  "ক্যান্টনমেন্ট": "Cantonment",
  "chawkbazar": "Chawkbazar",
  "চকবাজার": "Chawkbazar",
  "dakshinkhan": "Dakshinkhan",
  "দক্ষিণখান": "Dakshinkhan",
  "darussalam": "Darus Salam",
  "দারুসসালাম": "Darus Salam",
  "demra": "Demra",
  "ডেমরা": "Demra",
  "dhamrai": "Dhamrai",
  "ধামরাই": "Dhamrai",
  "dhanmondi": "Dhanmondi",
  "ধানমন্ডি": "Dhanmondi",
  "dohar": "Dohar",
  "দোহার": "Dohar",
  "gendaria": "Gendaria",
  "গেন্ডারিয়া": "Gendaria",
  "gulshan": "Gulshan",
  "গুলশান": "Gulshan",
  "hatirjheel": "Hatirjheel",
  "হাতিরঝিল": "Hatirjheel",
  "hazaribagh": "Hazaribagh",
  "হাজারীবাগ": "Hazaribagh",
  "jatrabari": "Jatrabari",
  "যাত্রাবাড়ী": "Jatrabari",
  "kadamtali": "Kadamtali",
  "কদমতলী": "Kadamtali",
  "kafrul": "Kafrul",
  "কাফরুল": "Kafrul",
  "kalabagan": "Kalabagan",
  "কলাবাগান": "Kalabagan",
  "kamrangirchar": "Kamrangirchar",
  "কামরাঙ্গীরচর": "Kamrangirchar",
  "keraniganj": "Keraniganj",
  "কেরাণীগঞ্জ": "Keraniganj",
  "khilgaon": "Khilgaon",
  "খিলগাঁও": "Khilgaon",
  "khilkhet": "Khilkhet",
  "খিলক্ষেত": "Khilkhet",
  "kotwali": "Kotwali",
  "কোতোয়ালী": "Kotwali",
  "lalbagh": "Lalbagh",
  "লালবাগ": "Lalbagh",
  "mirpur": "Mirpur",
  "মিরপুর": "Mirpur",
  "mohammadpur": "Mohammadpur",
  "মোহাম্মদপুর": "Mohammadpur",
  "motijheel": "Motijheel",
  "মতিঝিল": "Motijheel",
  "mugda": "Mugda",
  "মুগদা": "Mugda",
  "nawabganj": "Nawabganj",
  "নবাবগঞ্জ": "Nawabganj",
  "newmarket": "New Market",
  "নিউমার্কেট": "New Market",
  "pallabi": "Pallabi",
  "পল্লবী": "Pallabi",
  "paltan": "Paltan",
  "পল্টন": "Paltan",
  "ramna": "Ramna",
  "রমনা": "Ramna",
  "rampura": "Rampura",
  "রামপুরা": "Rampura",
  "rupnagar": "Rupnagar",
  "রূপনগর": "Rupnagar",
  "sabujbagh": "Sabujbagh",
  "সবুজবাগ": "Sabujbagh",
  "savar": "Savar",
  "সাভার": "Savar",
  "shahali": "Shah Ali",
  "শাহআলী": "Shah Ali",
  "shahbagh": "Shahbagh",
  "শাহবাগ": "Shahbagh",
  "shahjahanpur": "Shahjahanpur",
  "শাহজাহানপুর": "Shahjahanpur",
  "sherebanglanagar": "Sher-e-Bangla Nagar",
  "শেরেবাংলানগর": "Sher-e-Bangla Nagar",
  "shyampur": "Shyampur",
  "শ্যামপুর": "Shyampur",
  "sutrapur": "Sutrapur",
  "সূত্রাপুর": "Sutrapur",
  "tejgaon": "Tejgaon",
  "তেজগাঁও": "Tejgaon",
  "tejgaonia": "Tejgaon I/A",
  "তেজগাঁওশিল্পএলাকা": "Tejgaon I/A",
  "tejgaonindustrialarea": "Tejgaon Industrial Area",
  "তেজগাঁওশিল্পাঞ্চল": "Tejgaon Industrial Area",
  "turag": "Turag",
  "তুরাগ": "Turag",
  "uttaraeast": "Uttara East",
  "উত্তরাপূর্ব": "Uttara East",
  "uttarawest": "Uttara West",
  "উত্তরাপশ্চিম": "Uttara West",
  "uttarkhan": "Uttarkhan",
  "উত্তরখান": "Uttarkhan",
  "wari": "Wari",
  "ওয়ারী": "Wari",
  "sadarghat": "Sadarghat",
  "সদরঘাট": "Sadarghat",
  "akbarshah": "Akbarshah",
  "আকবরশাহ": "Akbarshah",
  "anwara": "Anwara",
  "আনোয়ারা": "Anwara",
  "bakalia": "Bakalia",
  "বাকলিয়া": "Bakalia",
  "bandar": "Bandar",
  "বন্দর": "Bandar",
  "banshkhali": "Banshkhali",
  "বাঁশখালী": "Banshkhali",
  "bayezidbostami": "Bayezid Bostami",
  "বায়েজিদবোস্তামী": "Bayezid Bostami",
  "boalkhali": "Boalkhali",
  "বোয়ালখালী": "Boalkhali",
  "chandanaish": "Chandanaish",
  "চন্দনাইশ": "Chandanaish",
  "chandgaon": "Chandgaon",
  "চান্দগাঁও": "Chandgaon",
  "doublemooring": "Double Mooring",
  "ডবলমুরিং": "Double Mooring",
  "epz": "EPZ",
  "ইপিজেড": "EPZ",
  "fatikchhari": "Fatikchhari",
  "ফটিকছড়ি": "Fatikchhari",
  "halishahar": "Halishahar",
  "হালিশহর": "Halishahar",
  "hathazari": "Hathazari",
  "হাটহাজারী": "Hathazari",
  "karnaphuli": "Karnaphuli",
  "কর্ণফুলী": "Karnaphuli",
  "khulshi": "Khulshi",
  "খুলশী": "Khulshi",
  "lohagara": "Lohagara",
  "লোহাগাড়া": "Lohagara",
  "mirsharai": "Mirsharai",
  "মীরসরাই": "Mirsharai",
  "pahartali": "Pahartali",
  "পাহাড়তলী": "Pahartali",
  "panchlaish": "Panchlaish",
  "পাঁচলাইশ": "Panchlaish",
  "patenga": "Patenga",
  "পতেঙ্গা": "Patenga",
  "patiya": "Patiya",
  "পটিয়া": "Patiya",
  "rangunia": "Rangunia",
  "রাঙ্গুনিয়া": "Rangunia",
  "raozan": "Raozan",
  "রাউজান": "Raozan",
  "sandwip": "Sandwip",
  "সন্দ্বীপ": "Sandwip",
  "satkania": "Satkania",
  "সাতকানিয়া": "Satkania",
  "sitakunda": "Sitakunda",
  "সীতাকুন্ড": "Sitakunda",
  "gazipursadar": "Gazipur Sadar",
  "গাজীপুরসদর": "Gazipur Sadar",
  "basan": "Basan",
  "বাসন": "Basan",
  "gacha": "Gacha",
  "গাছা": "Gacha",
  "joydebpur": "Joydebpur",
  "জয়দেবপুর": "Joydebpur",
  "kaliakair": "Kaliakair",
  "কালিয়াকৈর": "Kaliakair",
  "kaliganj": "Kaliganj",
  "কালীগঞ্জ": "Kaliganj",
  "kapasia": "Kapasia",
  "কাপাসিয়া": "Kapasia",
  "kashimpur": "Kashimpur",
  "কাশিমপুর": "Kashimpur",
  "konabari": "Konabari",
  "কোনাবাড়ী": "Konabari",
  "pubail": "Pubail",
  "পূবাইল": "Pubail",
  "sreepur": "Sreepur",
  "শ্রীপুর": "Sreepur",
  "tongi": "Tongi",
  "টঙ্গী": "Tongi",
  "tongieast": "Tongi East",
  "টঙ্গীপূর্ব": "Tongi East",
  "tongiwest": "Tongi West",
  "টঙ্গীপশ্চিম": "Tongi West",
  "narayanganjsadar": "Narayanganj Sadar",
  "নারায়নগঞ্জসদর": "Narayanganj Sadar",
  "araihazar": "Araihazar",
  "আড়াইহাজার": "Araihazar",
  "fatullah": "Fatullah",
  "ফতুল্লা": "Fatullah",
  "rupganj": "Rupganj",
  "রূপগঞ্জ": "Rupganj",
  "siddhirganj": "Siddhirganj",
  "সিদ্ধিরগঞ্জ": "Siddhirganj",
  "sonargaon": "Sonargaon",
  "সোনারগাঁ": "Sonargaon",
  "sylhetsadar": "Sylhet Sadar",
  "সিলেটসদর": "Sylhet Sadar",
  "balaganj": "Balaganj",
  "বালাগঞ্জ": "Balaganj",
  "beanibazar": "Beanibazar",
  "বিয়ানীবাজার": "Beanibazar",
  "bishwanath": "Bishwanath",
  "বিশ্বনাথ": "Bishwanath",
  "companiganj": "Companiganj",
  "কোম্পানীগঞ্জ": "Companiganj",
  "dakshinsurma": "Dakshinsurma",
  "দক্ষিণসুরমা": "Dakshinsurma",
  "fenchuganj": "Fenchuganj",
  "ফেঞ্চুগঞ্জ": "Fenchuganj",
  "golapganj": "Golapganj",
  "গোলাপগঞ্জ": "Golapganj",
  "gowainghat": "Gowainghat",
  "গোয়াইনঘাট": "Gowainghat",
  "jaintiapur": "Jaintiapur",
  "জৈন্তাপুর": "Jaintiapur",
  "jalalabad": "Jalalabad",
  "জালালাবাদ": "Jalalabad",
  "kanaighat": "Kanaighat",
  "কানাইঘাট": "Kanaighat",
  "moglabazar": "Moglabazar",
  "মোগলাবাজার": "Moglabazar",
  "osmaninagar": "Osmaninagar",
  "ওসমানীনগর": "Osmaninagar",
  "shahporan": "Shahporan",
  "শাহপরান": "Shahporan",
  "southsurma": "South Surma",
  "zakiganj": "Zakiganj",
  "জকিগঞ্জ": "Zakiganj",
  "khulnasadar": "Khulna Sadar",
  "খুলনাসদর": "Khulna Sadar",
  "aronghata": "Aronghata",
  "আড়ংঘাটা": "Aronghata",
  "batiaghata": "Batiaghata",
  "বটিয়াঘাটা": "Batiaghata",
  "dacope": "Dacope",
  "দাকোপ": "Dacope",
  "daulatpur": "Daulatpur",
  "দৌলতপুর": "Daulatpur",
  "dighalia": "Dighalia",
  "দিঘলিয়া": "Dighalia",
  "dumuria": "Dumuria",
  "ডুমুরিয়া": "Dumuria",
  "harintana": "Harintana",
  "হরিণটানা": "Harintana",
  "khalishpur": "Khalishpur",
  "খালিশপুর": "Khalishpur",
  "khanjahanali": "Khan Jahan Ali",
  "খানজাহানআলী": "Khan Jahan Ali",
  "koyra": "Koyra",
  "কয়রা": "Koyra",
  "labanchara": "Labanchara",
  "লবণচরা": "Labanchara",
  "paikgachha": "Paikgachha",
  "পাইকগাছা": "Paikgachha",
  "phultala": "Phultala",
  "ফুলতলা": "Phultala",
  "rupsa": "Rupsa",
  "রূপসা": "Rupsa",
  "sonadanga": "Sonadanga",
  "সোনাডাঙ্গা": "Sonadanga",
  "terokhada": "Terokhada",
  "তেরখাদা": "Terokhada",
  "এয়ারপোর্ট": "Airport",
  "bagha": "Bagha",
  "বাঘা": "Bagha",
  "bagmara": "Bagmara",
  "বাগমারা": "Bagmara",
  "belpukur": "Belpukur",
  "বেলপুকুর": "Belpukur",
  "boalia": "Boalia",
  "বোয়ালিয়া": "Boalia",
  "chandrima": "Chandrima",
  "চন্দ্রিমা": "Chandrima",
  "charghat": "Charghat",
  "চারঘাট": "Charghat",
  "damkura": "Damkura",
  "দামকুড়া": "Damkura",
  "durgapur": "Durgapur",
  "দুর্গাপুর": "Durgapur",
  "godagari": "Godagari",
  "গোদাগাড়ী": "Godagari",
  "karnahar": "Karnahar",
  "কর্ণহার": "Karnahar",
  "kashiadanga": "Kashiadanga",
  "কাশিয়াডাঙ্গা": "Kashiadanga",
  "katakhali": "Katakhali",
  "কাটাখালী": "Katakhali",
  "mohanpur": "Mohanpur",
  "মোহনপুর": "Mohanpur",
  "motihar": "Motihar",
  "মতিহার": "Motihar",
  "paba": "Paba",
  "পবা": "Paba",
  "puthia": "Puthia",
  "পুঠিয়া": "Puthia",
  "rajpara": "Rajpara",
  "রাজপাড়া": "Rajpara",
  "shahmakhdum": "Shah Makhdum",
  "শাহমখদুম": "Shah Makhdum",
  "tanore": "Tanore",
  "তানোর": "Tanore",
  "faridpursadar": "Faridpur Sadar",
  "ফরিদপুরসদর": "Faridpur Sadar",
  "sadarpur": "Sadarpur",
  "সদরপুর": "Sadarpur",
  "alfadanga": "Alfadanga",
  "আলফাডাঙ্গা": "Alfadanga",
  "bhanga": "Bhanga",
  "ভাঙ্গা": "Bhanga",
  "boalmari": "Boalmari",
  "বোয়ালমারী": "Boalmari",
  "charbhadrasan": "Charbhadrasan",
  "চরভদ্রাসন": "Charbhadrasan",
  "madhukhali": "Madhukhali",
  "মধুখালী": "Madhukhali",
  "nagarkanda": "Nagarkanda",
  "নগরকান্দা": "Nagarkanda",
  "saltha": "Saltha",
  "সালথা": "Saltha",
  "gopalganjsadar": "Gopalganj Sadar",
  "গোপালগঞ্জসদর": "Gopalganj Sadar",
  "kashiani": "Kashiani",
  "কাশিয়ানী": "Kashiani",
  "kotalipara": "Kotalipara",
  "কোটালীপাড়া": "Kotalipara",
  "muksudpur": "Muksudpur",
  "মুকসুদপুর": "Muksudpur",
  "tungipara": "Tungipara",
  "টুংগীপাড়া": "Tungipara",
  "kishoreganjsadar": "Kishoreganj Sadar",
  "কিশোরগঞ্জসদর": "Kishoreganj Sadar",
  "austagram": "Austagram",
  "অষ্টগ্রাম": "Austagram",
  "bajitpur": "Bajitpur",
  "বাজিতপুর": "Bajitpur",
  "bhairab": "Bhairab",
  "ভৈরব": "Bhairab",
  "hossainpur": "Hossainpur",
  "হোসেনপুর": "Hossainpur",
  "itna": "Itna",
  "ইটনা": "Itna",
  "karimgonj": "Karimgonj",
  "করিমগঞ্জ": "Karimgonj",
  "katiadi": "Katiadi",
  "কটিয়াদী": "Katiadi",
  "kuliarchar": "Kuliarchar",
  "কুলিয়ারচর": "Kuliarchar",
  "mithamoin": "Mithamoin",
  "মিঠামইন": "Mithamoin",
  "nikli": "Nikli",
  "নিকলী": "Nikli",
  "pakundia": "Pakundia",
  "পাকুন্দিয়া": "Pakundia",
  "tarail": "Tarail",
  "তাড়াইল": "Tarail",
  "madaripursadar": "Madaripur Sadar",
  "মাদারীপুরসদর": "Madaripur Sadar",
  "dasar": "Dasar",
  "ডাসার": "Dasar",
  "kalkini": "Kalkini",
  "কালকিনি": "Kalkini",
  "rajoir": "Rajoir",
  "রাজৈর": "Rajoir",
  "shibchar": "Shibchar",
  "শিবচর": "Shibchar",
  "manikganjsadar": "Manikganj Sadar",
  "মানিকগঞ্জসদর": "Manikganj Sadar",
  "doulatpur": "Doulatpur",
  "gior": "Gior",
  "ঘিওর": "Gior",
  "harirampur": "Harirampur",
  "হরিরামপুর": "Harirampur",
  "saturia": "Saturia",
  "সাটুরিয়া": "Saturia",
  "shibaloy": "Shibaloy",
  "শিবালয়": "Shibaloy",
  "singiar": "Singiar",
  "সিংগাইর": "Singiar",
  "munshiganjsadar": "Munshiganj Sadar",
  "মুন্সিগঞ্জসদর": "Munshiganj Sadar",
  "gajaria": "Gajaria",
  "গজারিয়া": "Gajaria",
  "louhajanj": "Louhajanj",
  "লৌহজং": "Louhajanj",
  "mirkadim": "Mirkadim",
  "মীরকাদিম": "Mirkadim",
  "sirajdikhan": "Sirajdikhan",
  "সিরাজদিখান": "Sirajdikhan",
  "sreenagar": "Sreenagar",
  "শ্রীনগর": "Sreenagar",
  "tongibari": "Tongibari",
  "টংগীবাড়ি": "Tongibari",
  "narsingdisadar": "Narsingdi Sadar",
  "নরসিংদীসদর": "Narsingdi Sadar",
  "belabo": "Belabo",
  "বেলাবো": "Belabo",
  "madhabdi": "Madhabdi",
  "মাধবদী": "Madhabdi",
  "monohardi": "Monohardi",
  "মনোহরদী": "Monohardi",
  "palash": "Palash",
  "পলাশ": "Palash",
  "raipura": "Raipura",
  "রায়পুরা": "Raipura",
  "shibpur": "Shibpur",
  "শিবপুর": "Shibpur",
  "rajbarisadar": "Rajbari Sadar",
  "রাজবাড়ীসদর": "Rajbari Sadar",
  "baliakandi": "Baliakandi",
  "বালিয়াকান্দি": "Baliakandi",
  "goalanda": "Goalanda",
  "গোয়ালন্দ": "Goalanda",
  "kalukhali": "Kalukhali",
  "কালুখালী": "Kalukhali",
  "pangsa": "Pangsa",
  "পাংশা": "Pangsa",
  "shariatpursadar": "Shariatpur Sadar",
  "শরিয়তপুরসদর": "Shariatpur Sadar",
  "bhedarganj": "Bhedarganj",
  "ভেদরগঞ্জ": "Bhedarganj",
  "damudya": "Damudya",
  "ডামুড্যা": "Damudya",
  "gosairhat": "Gosairhat",
  "গোসাইরহাট": "Gosairhat",
  "naria": "Naria",
  "নড়িয়া": "Naria",
  "zajira": "Zajira",
  "জাজিরা": "Zajira",
  "tangailsadar": "Tangail Sadar",
  "টাঙ্গাইলসদর": "Tangail Sadar",
  "basail": "Basail",
  "বাসাইল": "Basail",
  "bhuapur": "Bhuapur",
  "ভুয়াপুর": "Bhuapur",
  "delduar": "Delduar",
  "দেলদুয়ার": "Delduar",
  "dhanbari": "Dhanbari",
  "ধনবাড়ী": "Dhanbari",
  "ghatail": "Ghatail",
  "ঘাটাইল": "Ghatail",
  "gopalpur": "Gopalpur",
  "গোপালপুর": "Gopalpur",
  "kalihati": "Kalihati",
  "কালিহাতী": "Kalihati",
  "madhupur": "Madhupur",
  "মধুপুর": "Madhupur",
  "mirzapur": "Mirzapur",
  "মির্জাপুর": "Mirzapur",
  "nagarpur": "Nagarpur",
  "নাগরপুর": "Nagarpur",
  "sakhipur": "Sakhipur",
  "সখিপুর": "Sakhipur",
  "bandarbansadar": "Bandarban Sadar",
  "বান্দরবানসদর": "Bandarban Sadar",
  "alikadam": "Alikadam",
  "আলীকদম": "Alikadam",
  "lama": "Lama",
  "লামা": "Lama",
  "naikhongchhari": "Naikhongchhari",
  "নাইক্ষ্যংছড়ি": "Naikhongchhari",
  "rowangchhari": "Rowangchhari",
  "রোয়াংছড়ি": "Rowangchhari",
  "ruma": "Ruma",
  "রুমা": "Ruma",
  "thanchi": "Thanchi",
  "থানচি": "Thanchi",
  "brahmanbariasadar": "Brahmanbaria Sadar",
  "ব্রাহ্মণবাড়িয়াসদর": "Brahmanbaria Sadar",
  "akhaura": "Akhaura",
  "আখাউড়া": "Akhaura",
  "ashuganj": "Ashuganj",
  "আশুগঞ্জ": "Ashuganj",
  "bancharampur": "Bancharampur",
  "বাঞ্ছারামপুর": "Bancharampur",
  "bijoynagar": "Bijoynagar",
  "বিজয়নগর": "Bijoynagar",
  "kasba": "Kasba",
  "কসবা": "Kasba",
  "nabinagar": "Nabinagar",
  "নবীনগর": "Nabinagar",
  "nasirnagar": "Nasirnagar",
  "নাসিরনগর": "Nasirnagar",
  "sarail": "Sarail",
  "সরাইল": "Sarail",
  "chandpursadar": "Chandpur Sadar",
  "চাঁদপুরসদর": "Chandpur Sadar",
  "faridganj": "Faridganj",
  "ফরিদগঞ্জ": "Faridganj",
  "haimchar": "Haimchar",
  "হাইমচর": "Haimchar",
  "hajiganj": "Hajiganj",
  "হাজীগঞ্জ": "Hajiganj",
  "kachua": "Kachua",
  "কচুয়া": "Kachua",
  "matlabdakshin": "Matlab Dakshin",
  "মতলবদক্ষিণ": "Matlab Dakshin",
  "matlabuttar": "Matlab Uttar",
  "মতলবউত্তর": "Matlab Uttar",
  "shahrasti": "Shahrasti",
  "শাহরাস্তি": "Shahrasti",
  "comillaadarshasadar": "Comilla Adarsha Sadar",
  "কুমিল্লাসদর": "Comilla Adarsha Sadar",
  "comillasadardakshin": "Comilla Sadar Dakshin",
  "সদরদক্ষিণ": "Comilla Sadar Dakshin",
  "barura": "Barura",
  "বরুড়া": "Barura",
  "brahmanpara": "Brahmanpara",
  "ব্রাহ্মণপাড়া": "Brahmanpara",
  "burichang": "Burichang",
  "বুড়িচং": "Burichang",
  "chandina": "Chandina",
  "চান্দিনা": "Chandina",
  "chauddagram": "Chauddagram",
  "চৌদ্দগ্রাম": "Chauddagram",
  "daudkandi": "Daudkandi",
  "দাউদকান্দি": "Daudkandi",
  "debidwar": "Debidwar",
  "দেবিদ্বার": "Debidwar",
  "homna": "Homna",
  "হোমনা": "Homna",
  "laksam": "Laksam",
  "লাকসাম": "Laksam",
  "lalmai": "Lalmai",
  "লালমাই": "Lalmai",
  "meghna": "Meghna",
  "মেঘনা": "Meghna",
  "monohargonj": "Monohargonj",
  "মনোহরগঞ্জ": "Monohargonj",
  "muradnagar": "Muradnagar",
  "মুরাদনগর": "Muradnagar",
  "nangalkot": "Nangalkot",
  "নাঙ্গলকোট": "Nangalkot",
  "titas": "Titas",
  "তিতাস": "Titas",
  "coxsbazarsadar": "Coxsbazar Sadar",
  "কক্সবাজারসদর": "Coxsbazar Sadar",
  "chakaria": "Chakaria",
  "চকরিয়া": "Chakaria",
  "eidgaon": "Eidgaon",
  "ঈদগাঁও": "Eidgaon",
  "kutubdia": "Kutubdia",
  "কুতুবদিয়া": "Kutubdia",
  "maheshkhali": "Maheshkhali",
  "মহেশখালী": "Maheshkhali",
  "pekua": "Pekua",
  "পেকুয়া": "Pekua",
  "ramu": "Ramu",
  "রামু": "Ramu",
  "teknaf": "Teknaf",
  "টেকনাফ": "Teknaf",
  "ukhia": "Ukhia",
  "উখিয়া": "Ukhia",
  "fenisadar": "Feni Sadar",
  "ফেনীসদর": "Feni Sadar",
  "chhagalnaiya": "Chhagalnaiya",
  "ছাগলনাইয়া": "Chhagalnaiya",
  "daganbhuiyan": "Daganbhuiyan",
  "দাগনভূঞা": "Daganbhuiyan",
  "fulgazi": "Fulgazi",
  "ফুলগাজী": "Fulgazi",
  "parshuram": "Parshuram",
  "পরশুরাম": "Parshuram",
  "sonagazi": "Sonagazi",
  "সোনাগাজী": "Sonagazi",
  "khagrachharisadar": "Khagrachhari Sadar",
  "খাগড়াছড়িসদর": "Khagrachhari Sadar",
  "dighinala": "Dighinala",
  "দিঘীনালা": "Dighinala",
  "guimara": "Guimara",
  "গুইমারা": "Guimara",
  "laxmichhari": "Laxmichhari",
  "লক্ষীছড়ি": "Laxmichhari",
  "manikchari": "Manikchari",
  "মানিকছড়ি": "Manikchari",
  "matiranga": "Matiranga",
  "মাটিরাঙ্গা": "Matiranga",
  "mohalchari": "Mohalchari",
  "মহালছড়ি": "Mohalchari",
  "panchhari": "Panchhari",
  "পানছড়ি": "Panchhari",
  "ramgarh": "Ramgarh",
  "রামগড়": "Ramgarh",
  "lakshmipursadar": "Lakshmipur Sadar",
  "লক্ষ্মীপুরসদর": "Lakshmipur Sadar",
  "kamalnagar": "Kamalnagar",
  "কমলনগর": "Kamalnagar",
  "raipur": "Raipur",
  "রায়পুর": "Raipur",
  "ramganj": "Ramganj",
  "রামগঞ্জ": "Ramganj",
  "ramgati": "Ramgati",
  "রামগতি": "Ramgati",
  "noakhalisadar": "Noakhali Sadar",
  "নোয়াখালীসদর": "Noakhali Sadar",
  "begumganj": "Begumganj",
  "বেগমগঞ্জ": "Begumganj",
  "chatkhil": "Chatkhil",
  "চাটখিল": "Chatkhil",
  "hatiya": "Hatiya",
  "হাতিয়া": "Hatiya",
  "kabirhat": "Kabirhat",
  "কবিরহাট": "Kabirhat",
  "senbagh": "Senbagh",
  "সেনবাগ": "Senbagh",
  "sonaimuri": "Sonaimuri",
  "সোনাইমুড়ী": "Sonaimuri",
  "subarnachar": "Subarnachar",
  "সুবর্ণচর": "Subarnachar",
  "rangamatisadar": "Rangamati Sadar",
  "রাঙ্গামাটিসদর": "Rangamati Sadar",
  "baghaichhari": "Baghaichhari",
  "বাঘাইছড়ি": "Baghaichhari",
  "barkal": "Barkal",
  "বরকল": "Barkal",
  "belaichari": "Belaichari",
  "বিলাইছড়ি": "Belaichari",
  "juraichari": "Juraichari",
  "জুরাছড়ি": "Juraichari",
  "kaptai": "Kaptai",
  "কাপ্তাই": "Kaptai",
  "kaukhali": "Kaukhali",
  "কাউখালী": "Kaukhali",
  "langadu": "Langadu",
  "লংগদু": "Langadu",
  "naniarchar": "Naniarchar",
  "নানিয়ারচর": "Naniarchar",
  "rajasthali": "Rajasthali",
  "রাজস্থলী": "Rajasthali",
  "habiganjsadar": "Habiganj Sadar",
  "হবিগঞ্জসদর": "Habiganj Sadar",
  "ajmiriganj": "Ajmiriganj",
  "আজমিরীগঞ্জ": "Ajmiriganj",
  "bahubal": "Bahubal",
  "বাহুবল": "Bahubal",
  "baniachong": "Baniachong",
  "বানিয়াচং": "Baniachong",
  "chunarughat": "Chunarughat",
  "চুনারুঘাট": "Chunarughat",
  "lakhai": "Lakhai",
  "লাখাই": "Lakhai",
  "madhabpur": "Madhabpur",
  "মাধবপুর": "Madhabpur",
  "nabiganj": "Nabiganj",
  "নবীগঞ্জ": "Nabiganj",
  "shayestaganj": "Shayestaganj",
  "শায়েস্তাগঞ্জ": "Shayestaganj",
  "moulvibazarsadar": "Moulvibazar Sadar",
  "মৌলভীবাজারসদর": "Moulvibazar Sadar",
  "barlekha": "Barlekha",
  "বড়লেখা": "Barlekha",
  "juri": "Juri",
  "জুড়ী": "Juri",
  "kamalganj": "Kamalganj",
  "কমলগঞ্জ": "Kamalganj",
  "kulaura": "Kulaura",
  "কুলাউড়া": "Kulaura",
  "rajnagar": "Rajnagar",
  "রাজনগর": "Rajnagar",
  "sreemangal": "Sreemangal",
  "শ্রীমঙ্গল": "Sreemangal",
  "sunamganjsadar": "Sunamganj Sadar",
  "সুনামগঞ্জসদর": "Sunamganj Sadar",
  "bishwamvarpur": "Bishwamvarpur",
  "বিশ্বম্ভরপুর": "Bishwamvarpur",
  "chhatak": "Chhatak",
  "ছাতক": "Chhatak",
  "dharmapasha": "Dharmapasha",
  "ধর্মপাশা": "Dharmapasha",
  "dirai": "Dirai",
  "দিরাই": "Dirai",
  "dowarabazar": "Dowarabazar",
  "দোয়ারাবাজার": "Dowarabazar",
  "jagannathpur": "Jagannathpur",
  "জগন্নাথপুর": "Jagannathpur",
  "jamalganj": "Jamalganj",
  "জামালগঞ্জ": "Jamalganj",
  "madhyanagar": "Madhyanagar",
  "মধ্যনগর": "Madhyanagar",
  "shalla": "Shalla",
  "শাল্লা": "Shalla",
  "shantiganj": "Shantiganj",
  "শান্তিগঞ্জ": "Shantiganj",
  "southsunamganj": "South Sunamganj",
  "দক্ষিণসুনামগঞ্জ": "South Sunamganj",
  "tahirpur": "Tahirpur",
  "তাহিরপুর": "Tahirpur",
  "bogurasadar": "Bogura Sadar",
  "বগুড়াসদর": "Bogura Sadar",
  "adamdighi": "Adamdighi",
  "আদমদিঘি": "Adamdighi",
  "dhunat": "Dhunat",
  "ধুনট": "Dhunat",
  "dupchanchia": "Dupchanchia",
  "দুপচাচিঁয়া": "Dupchanchia",
  "gabtali": "Gabtali",
  "গাবতলী": "Gabtali",
  "kahaloo": "Kahaloo",
  "কাহালু": "Kahaloo",
  "nandigram": "Nandigram",
  "নন্দিগ্রাম": "Nandigram",
  "sariakandi": "Sariakandi",
  "সারিয়াকান্দি": "Sariakandi",
  "shajahanpur": "Shajahanpur",
  "শাজাহানপুর": "Shajahanpur",
  "sherpur": "Sherpur",
  "শেরপুর": "Sherpur",
  "shibganj": "Shibganj",
  "শিবগঞ্জ": "Shibganj",
  "sonatola": "Sonatola",
  "সোনাতলা": "Sonatola",
  "chapainawabganjsadar": "Chapainawabganj Sadar",
  "চাঁপাইনবাবগঞ্জসদর": "Chapainawabganj Sadar",
  "bholahat": "Bholahat",
  "ভোলাহাট": "Bholahat",
  "gomastapur": "Gomastapur",
  "গোমস্তাপুর": "Gomastapur",
  "nachole": "Nachole",
  "নাচোল": "Nachole",
  "joypurhatsadar": "Joypurhat Sadar",
  "জয়পুরহাটসদর": "Joypurhat Sadar",
  "akkelpur": "Akkelpur",
  "আক্কেলপুর": "Akkelpur",
  "kalai": "Kalai",
  "কালাই": "Kalai",
  "khetlal": "Khetlal",
  "ক্ষেতলাল": "Khetlal",
  "panchbibi": "Panchbibi",
  "পাঁচবিবি": "Panchbibi",
  "naogaonsadar": "Naogaon Sadar",
  "নওগাঁসদর": "Naogaon Sadar",
  "atrai": "Atrai",
  "আত্রাই": "Atrai",
  "badalgachhi": "Badalgachhi",
  "বদলগাছী": "Badalgachhi",
  "dhamoirhat": "Dhamoirhat",
  "ধামইরহাট": "Dhamoirhat",
  "mahadebpur": "Mahadebpur",
  "মহাদেবপুর": "Mahadebpur",
  "manda": "Manda",
  "মান্দা": "Manda",
  "niamatpur": "Niamatpur",
  "নিয়ামতপুর": "Niamatpur",
  "patnitala": "Patnitala",
  "পত্নিতলা": "Patnitala",
  "porsha": "Porsha",
  "পোরশা": "Porsha",
  "raninagar": "Raninagar",
  "রাণীনগর": "Raninagar",
  "sapahar": "Sapahar",
  "সাপাহার": "Sapahar",
  "natoresadar": "Natore Sadar",
  "নাটোরসদর": "Natore Sadar",
  "bagatipara": "Bagatipara",
  "বাগাতিপাড়া": "Bagatipara",
  "baraigram": "Baraigram",
  "বড়াইগ্রাম": "Baraigram",
  "gurudaspur": "Gurudaspur",
  "গুরুদাসপুর": "Gurudaspur",
  "lalpur": "Lalpur",
  "লালপুর": "Lalpur",
  "naldanga": "Naldanga",
  "নলডাঙ্গা": "Naldanga",
  "singra": "Singra",
  "সিংড়া": "Singra",
  "pabnasadar": "Pabna Sadar",
  "পাবনাসদর": "Pabna Sadar",
  "atgharia": "Atgharia",
  "আটঘরিয়া": "Atgharia",
  "bera": "Bera",
  "বেড়া": "Bera",
  "bhangura": "Bhangura",
  "ভাঙ্গুড়া": "Bhangura",
  "chatmohar": "Chatmohar",
  "চাটমোহর": "Chatmohar",
  "faridpur": "Faridpur",
  "ফরিদপুর": "Faridpur",
  "ishwardi": "Ishwardi",
  "ঈশ্বরদী": "Ishwardi",
  "santhia": "Santhia",
  "সাঁথিয়া": "Santhia",
  "sujanagar": "Sujanagar",
  "সুজানগর": "Sujanagar",
  "sirajganjsadar": "Sirajganj Sadar",
  "সিরাজগঞ্জসদর": "Sirajganj Sadar",
  "belkuchi": "Belkuchi",
  "বেলকুচি": "Belkuchi",
  "chauhali": "Chauhali",
  "চৌহালি": "Chauhali",
  "kamarkhanda": "Kamarkhanda",
  "কামারখন্দ": "Kamarkhanda",
  "kazipur": "Kazipur",
  "কাজীপুর": "Kazipur",
  "raiganj": "Raiganj",
  "রায়গঞ্জ": "Raiganj",
  "shahjadpur": "Shahjadpur",
  "শাহজাদপুর": "Shahjadpur",
  "tarash": "Tarash",
  "তাড়াশ": "Tarash",
  "ullapara": "Ullapara",
  "উল্লাপাড়া": "Ullapara",
  "bagerhatsadar": "Bagerhat Sadar",
  "বাগেরহাটসদর": "Bagerhat Sadar",
  "chitalmari": "Chitalmari",
  "চিতলমারী": "Chitalmari",
  "fakirhat": "Fakirhat",
  "ফকিরহাট": "Fakirhat",
  "কচুয়া": "Kachua",
  "mollahat": "Mollahat",
  "মোল্লাহাট": "Mollahat",
  "mongla": "Mongla",
  "মোংলা": "Mongla",
  "morrelganj": "Morrelganj",
  "মোড়েলগঞ্জ": "Morrelganj",
  "rampal": "Rampal",
  "রামপাল": "Rampal",
  "sarankhola": "Sarankhola",
  "শরণখোলা": "Sarankhola",
  "chuadangasadar": "Chuadanga Sadar",
  "চুয়াডাঙ্গাসদর": "Chuadanga Sadar",
  "alamdanga": "Alamdanga",
  "আলমডাঙ্গা": "Alamdanga",
  "damurhuda": "Damurhuda",
  "দামুড়হুদা": "Damurhuda",
  "jibannagar": "Jibannagar",
  "জীবননগর": "Jibannagar",
  "jashoresadar": "Jashore Sadar",
  "যশোরসদর": "Jashore Sadar",
  "abhaynagar": "Abhaynagar",
  "অভয়নগর": "Abhaynagar",
  "bagherpara": "Bagherpara",
  "বাঘারপাড়া": "Bagherpara",
  "chaugachha": "Chaugachha",
  "চৌগাছা": "Chaugachha",
  "jhikargachha": "Jhikargachha",
  "ঝিকরগাছা": "Jhikargachha",
  "keshabpur": "Keshabpur",
  "কেশবপুর": "Keshabpur",
  "manirampur": "Manirampur",
  "মণিরামপুর": "Manirampur",
  "sharsha": "Sharsha",
  "শার্শা": "Sharsha",
  "jhenaidahsadar": "Jhenaidah Sadar",
  "ঝিনাইদহসদর": "Jhenaidah Sadar",
  "harinakunda": "Harinakunda",
  "হরিণাকুন্ডু": "Harinakunda",
  "kotchandpur": "Kotchandpur",
  "কোটচাঁদপুর": "Kotchandpur",
  "maheshpur": "Maheshpur",
  "মহেশপুর": "Maheshpur",
  "shailkupa": "Shailkupa",
  "শৈলকুপা": "Shailkupa",
  "kushtiasadar": "Kushtia Sadar",
  "কুষ্টিয়াসদর": "Kushtia Sadar",
  "bheramara": "Bheramara",
  "ভেড়ামারা": "Bheramara",
  "khoksa": "Khoksa",
  "খোকসা": "Khoksa",
  "kumarkhali": "Kumarkhali",
  "কুমারখালী": "Kumarkhali",
  "magurasadar": "Magura Sadar",
  "মাগুরাসদর": "Magura Sadar",
  "মহম্মদপুর": "Mohammadpur",
  "shalikha": "Shalikha",
  "শালিখা": "Shalikha",
  "meherpursadar": "Meherpur Sadar",
  "মেহেরপুরসদর": "Meherpur Sadar",
  "gangni": "Gangni",
  "গাংনী": "Gangni",
  "mujibnagar": "Mujibnagar",
  "মুজিবনগর": "Mujibnagar",
  "narailsadar": "Narail Sadar",
  "নড়াইলসদর": "Narail Sadar",
  "kalia": "Kalia",
  "কালিয়া": "Kalia",
  "লোহাগড়া": "Lohagara",
  "satkhirasadar": "Satkhira Sadar",
  "সাতক্ষীরাসদর": "Satkhira Sadar",
  "assasuni": "Assasuni",
  "আশাশুনি": "Assasuni",
  "debhata": "Debhata",
  "দেবহাটা": "Debhata",
  "kalaroa": "Kalaroa",
  "কলারোয়া": "Kalaroa",
  "কালিগঞ্জ": "Kaliganj",
  "shyamnagar": "Shyamnagar",
  "শ্যামনগর": "Shyamnagar",
  "tala": "Tala",
  "তালা": "Tala",
  "bargunasadar": "Barguna Sadar",
  "বরগুনাসদর": "Barguna Sadar",
  "amtali": "Amtali",
  "আমতলী": "Amtali",
  "bamna": "Bamna",
  "বামনা": "Bamna",
  "betagi": "Betagi",
  "বেতাগী": "Betagi",
  "patharghata": "Patharghata",
  "পাথরঘাটা": "Patharghata",
  "taltali": "Taltali",
  "তালতলি": "Taltali",
  "barishalsadar": "Barishal Sadar",
  "বরিশালসদর": "Barishal Sadar",
  "kotwalimodel": "Kotwali Model",
  "কোতোয়ালিমডেল": "Kotwali Model",
  "agailjhara": "Agailjhara",
  "আগৈলঝাড়া": "Agailjhara",
  "babuganj": "Babuganj",
  "বাবুগঞ্জ": "Babuganj",
  "bakerganj": "Bakerganj",
  "বাকেরগঞ্জ": "Bakerganj",
  "banaripara": "Banaripara",
  "বানারীপাড়া": "Banaripara",
  "gournadi": "Gournadi",
  "গৌরনদী": "Gournadi",
  "hizla": "Hizla",
  "হিজলা": "Hizla",
  "kaunia": "Kaunia",
  "কাউনিয়া": "Kaunia",
  "mehendiganj": "Mehendiganj",
  "মেহেন্দিগঞ্জ": "Mehendiganj",
  "muladi": "Muladi",
  "মুলাদী": "Muladi",
  "wazirpur": "Wazirpur",
  "উজিরপুর": "Wazirpur",
  "bholasadar": "Bhola Sadar",
  "ভোলাসদর": "Bhola Sadar",
  "borhanuddin": "Borhanuddin",
  "বোরহানউদ্দিন": "Borhanuddin",
  "charfasson": "Char Fasson",
  "চরফ্যাশন": "Char Fasson",
  "daulatkhan": "Daulatkhan",
  "দৌলতখান": "Daulatkhan",
  "lalmohan": "Lalmohan",
  "লালমোহন": "Lalmohan",
  "manpura": "Manpura",
  "মনপুরা": "Manpura",
  "tazumuddin": "Tazumuddin",
  "তজুমদ্দিন": "Tazumuddin",
  "jhalokatisadar": "Jhalokati Sadar",
  "ঝালকাঠিসদর": "Jhalokati Sadar",
  "kathalia": "Kathalia",
  "কাঠালিয়া": "Kathalia",
  "nalchity": "Nalchity",
  "নলছিটি": "Nalchity",
  "rajapur": "Rajapur",
  "রাজাপুর": "Rajapur",
  "patuakhalisadar": "Patuakhali Sadar",
  "পটুয়াখালীসদর": "Patuakhali Sadar",
  "bauphal": "Bauphal",
  "বাউফল": "Bauphal",
  "dashmina": "Dashmina",
  "দশমিনা": "Dashmina",
  "dumki": "Dumki",
  "দুমকি": "Dumki",
  "galachipa": "Galachipa",
  "গলাচিপা": "Galachipa",
  "kalapara": "Kalapara",
  "কলাপাড়া": "Kalapara",
  "mirzaganj": "Mirzaganj",
  "মির্জাগঞ্জ": "Mirzaganj",
  "rangabali": "Rangabali",
  "রাঙ্গাবালী": "Rangabali",
  "pirojpursadar": "Pirojpur Sadar",
  "পিরোজপুরসদর": "Pirojpur Sadar",
  "bhandaria": "Bhandaria",
  "ভান্ডারিয়া": "Bhandaria",
  "kawkhali": "Kawkhali",
  "mathbaria": "Mathbaria",
  "মঠবাড়ীয়া": "Mathbaria",
  "nazirpur": "Nazirpur",
  "নাজিরপুর": "Nazirpur",
  "nesarabad": "Nesarabad",
  "নেছারাবাদ": "Nesarabad",
  "zianagar": "Zianagar",
  "জিয়ানগর": "Zianagar",
  "dinajpursadar": "Dinajpur Sadar",
  "দিনাজপুরসদর": "Dinajpur Sadar",
  "biral": "Biral",
  "বিরল": "Biral",
  "birampur": "Birampur",
  "বিরামপুর": "Birampur",
  "birganj": "Birganj",
  "বীরগঞ্জ": "Birganj",
  "bochaganj": "Bochaganj",
  "বোচাগঞ্জ": "Bochaganj",
  "chirirbandar": "Chirirbandar",
  "চিরিরবন্দর": "Chirirbandar",
  "ghoraghat": "Ghoraghat",
  "ঘোড়াঘাট": "Ghoraghat",
  "hakimpur": "Hakimpur",
  "হাকিমপুর": "Hakimpur",
  "kaharole": "Kaharole",
  "কাহারোল": "Kaharole",
  "khansama": "Khansama",
  "খানসামা": "Khansama",
  "parbatipur": "Parbatipur",
  "পার্বতীপুর": "Parbatipur",
  "phulbari": "Phulbari",
  "ফুলবাড়ী": "Phulbari",
  "gaibandhasadar": "Gaibandha Sadar",
  "গাইবান্ধাসদর": "Gaibandha Sadar",
  "gobindaganj": "Gobindaganj",
  "গোবিন্দগঞ্জ": "Gobindaganj",
  "palashbari": "Palashbari",
  "পলাশবাড়ী": "Palashbari",
  "phulchhari": "Phulchhari",
  "ফুলছড়ি": "Phulchhari",
  "sadullapur": "Sadullapur",
  "সাদুল্লাপুর": "Sadullapur",
  "saghata": "Saghata",
  "সাঘাটা": "Saghata",
  "sundarganj": "Sundarganj",
  "সুন্দরগঞ্জ": "Sundarganj",
  "kurigramsadar": "Kurigram Sadar",
  "কুড়িগ্রামসদর": "Kurigram Sadar",
  "bhurungamari": "Bhurungamari",
  "ভুরুঙ্গামারী": "Bhurungamari",
  "charrajibpur": "Charrajibpur",
  "চররাজিবপুর": "Charrajibpur",
  "chilmari": "Chilmari",
  "চিলমারী": "Chilmari",
  "nageshwari": "Nageshwari",
  "নাগেশ্বরী": "Nageshwari",
  "rajarhat": "Rajarhat",
  "রাজারহাট": "Rajarhat",
  "rowmari": "Rowmari",
  "রৌমারী": "Rowmari",
  "ulipur": "Ulipur",
  "উলিপুর": "Ulipur",
  "lalmonirhatsadar": "Lalmonirhat Sadar",
  "লালমনিরহাটসদর": "Lalmonirhat Sadar",
  "aditmari": "Aditmari",
  "আদিতমারী": "Aditmari",
  "hatibandha": "Hatibandha",
  "হাতীবান্ধা": "Hatibandha",
  "patgram": "Patgram",
  "পাটগ্রাম": "Patgram",
  "nilphamarisadar": "Nilphamari Sadar",
  "নীলফামারীসদর": "Nilphamari Sadar",
  "dimla": "Dimla",
  "ডিমলা": "Dimla",
  "domar": "Domar",
  "ডোমার": "Domar",
  "jaldhaka": "Jaldhaka",
  "জলঢাকা": "Jaldhaka",
  "kishoreganj": "Kishoreganj",
  "কিশোরগঞ্জ": "Kishoreganj",
  "saidpur": "Saidpur",
  "সৈয়দপুর": "Saidpur",
  "panchagarhsadar": "Panchagarh Sadar",
  "পঞ্চগড়সদর": "Panchagarh Sadar",
  "atwari": "Atwari",
  "আটোয়ারী": "Atwari",
  "boda": "Boda",
  "বোদা": "Boda",
  "debiganj": "Debiganj",
  "দেবীগঞ্জ": "Debiganj",
  "tetulia": "Tetulia",
  "তেতুলিয়া": "Tetulia",
  "rangpursadar": "Rangpur Sadar",
  "রংপুরসদর": "Rangpur Sadar",
  "badarganj": "Badarganj",
  "বদরগঞ্জ": "Badarganj",
  "gangachara": "Gangachara",
  "গংগাচড়া": "Gangachara",
  "haragachh": "Haragachh",
  "হারাগাছ": "Haragachh",
  "hazirhat": "Hazirhat",
  "হাজিরহাট": "Hazirhat",
  "কোতোয়ালি": "Kotwali",
  "mahiganj": "Mahiganj",
  "মাহিগঞ্জ": "Mahiganj",
  "mithapukur": "Mithapukur",
  "মিঠাপুকুর": "Mithapukur",
  "pirgachha": "Pirgachha",
  "পীরগাছা": "Pirgachha",
  "pirganj": "Pirganj",
  "পীরগঞ্জ": "Pirganj",
  "tajhat": "Tajhat",
  "তাজহাট": "Tajhat",
  "taraganj": "Taraganj",
  "তারাগঞ্জ": "Taraganj",
  "thakurgaonsadar": "Thakurgaon Sadar",
  "ঠাকুরগাঁওসদর": "Thakurgaon Sadar",
  "baliadangi": "Baliadangi",
  "বালিয়াডাঙ্গী": "Baliadangi",
  "haripur": "Haripur",
  "হরিপুর": "Haripur",
  "ranisankail": "Ranisankail",
  "রাণীশংকৈল": "Ranisankail",
  "jamalpursadar": "Jamalpur Sadar",
  "জামালপুরসদর": "Jamalpur Sadar",
  "bakshiganj": "Bakshiganj",
  "বকশীগঞ্জ": "Bakshiganj",
  "dewanganj": "Dewanganj",
  "দেওয়ানগঞ্জ": "Dewanganj",
  "islampur": "Islampur",
  "ইসলামপুর": "Islampur",
  "madarganj": "Madarganj",
  "মাদারগঞ্জ": "Madarganj",
  "melandaha": "Melandaha",
  "মেলান্দহ": "Melandaha",
  "sarishabari": "Sarishabari",
  "সরিষাবাড়ী": "Sarishabari",
  "mymensinghsadar": "Mymensingh Sadar",
  "ময়মনসিংহসদর": "Mymensingh Sadar",
  "bhaluka": "Bhaluka",
  "ভালুকা": "Bhaluka",
  "dhobaura": "Dhobaura",
  "ধোবাউড়া": "Dhobaura",
  "fulbaria": "Fulbaria",
  "ফুলবাড়ীয়া": "Fulbaria",
  "gaffargaon": "Gaffargaon",
  "গফরগাঁও": "Gaffargaon",
  "gauripur": "Gauripur",
  "গৌরীপুর": "Gauripur",
  "haluaghat": "Haluaghat",
  "হালুয়াঘাট": "Haluaghat",
  "ishwarganj": "Ishwarganj",
  "ঈশ্বরগঞ্জ": "Ishwarganj",
  "muktagachha": "Muktagachha",
  "মুক্তাগাছা": "Muktagachha",
  "nandail": "Nandail",
  "নান্দাইল": "Nandail",
  "phulpur": "Phulpur",
  "ফুলপুর": "Phulpur",
  "tarakanda": "Tarakanda",
  "তারাকান্দা": "Tarakanda",
  "trishal": "Trishal",
  "ত্রিশাল": "Trishal",
  "netrokonasadar": "Netrokona Sadar",
  "নেত্রকোণাসদর": "Netrokona Sadar",
  "atpara": "Atpara",
  "আটপাড়া": "Atpara",
  "barhatta": "Barhatta",
  "বারহাট্টা": "Barhatta",
  "kalmakanda": "Kalmakanda",
  "কলমাকান্দা": "Kalmakanda",
  "kendua": "Kendua",
  "কেন্দুয়া": "Kendua",
  "khaliajuri": "Khaliajuri",
  "খালিয়াজুরী": "Khaliajuri",
  "madan": "Madan",
  "মদন": "Madan",
  "mohanganj": "Mohanganj",
  "মোহনগঞ্জ": "Mohanganj",
  "purbadhala": "Purbadhala",
  "পূর্বধলা": "Purbadhala",
  "sherpursadar": "Sherpur Sadar",
  "শেরপুরসদর": "Sherpur Sadar",
  "jhenaigati": "Jhenaigati",
  "ঝিনাইগাতী": "Jhenaigati",
  "nakla": "Nakla",
  "নকলা": "Nakla",
  "nalitabari": "Nalitabari",
  "নালিতাবাড়ী": "Nalitabari",
  "sreebardi": "Sreebardi",
  "শ্রীবরদী": "Sreebardi",
  "vatara": "Bhatara",
  "faridgonj": "Faridganj",
  "matlabnorth": "Matlab Uttar",
  "matlabsouth": "Matlab Dakshin",
  "karnafuli": "Karnaphuli",
  "comillasadar": "Comilla Adarsha Sadar",
  "sadarsouth": "Comilla Sadar Dakshin",
  "moheshkhali": "Maheshkhali",
  "ukhiya": "Ukhia",
  "dagonbhuiyan": "Daganbhuiyan",
  "panchari": "Panchhari",
  "hatia": "Hatiya",
  "senbug": "Senbagh",
  "sonaimori": "Sonaimuri",
  "baghaichari": "Baghaichhari",
  "baralekha": "Barlekha",
  "kamolganj": "Kamalganj",
  "bishwambarpur": "Bishwamvarpur",
  "derai": "Dirai",
  "bograsadar": "Bogura Sadar",
  "dhunot": "Dhunat",
  "nondigram": "Nandigram",
  "shariakandi": "Sariakandi",
  "sonatala": "Sonatola",
  "gomostapur": "Gomastapur",
  "nachol": "Nachole",
  "badalgachi": "Badalgachhi",
  "mohadevpur": "Mahadebpur",
  "atghoria": "Atgharia",
  "ishurdi": "Ishwardi",
  "mohonpur": "Mohanpur",
  "kamarkhand": "Kamarkhanda",
  "raigonj": "Raiganj",
  "jessoresadar": "Jashore Sadar",
  "chougachha": "Chaugachha",
  "jhikargacha": "Jhikargachha",
  "harinakundu": "Harinakunda",
  "moheshpur": "Maheshpur",
  "barisalsadar": "Barishal Sadar",
  "fultola": "Phultala",
  "paikgasa": "Paikgachha",
  "botiaghata": "Batiaghata",
  "dakop": "Dacope",
  "digholia": "Dighalia",
  "rupsha": "Rupsa",
  "pathorghata": "Patharghata",
  "borhansddin": "Borhanuddin",
  "burhanuddin": "Borhanuddin",
  "charfesson": "Char Fasson",
  "doulatkhan": "Daulatkhan",
  "monpura": "Manpura",
  "jhalakathisadar": "Jhalokati Sadar",
  "birol": "Biral",
  "fulbari": "Phulbari",
  "kaharol": "Kaharole",
  "phulchari": "Phulchhari",
  "sughatta": "Saghata",
  "raomari": "Rowmari",
  "kishorganj": "Kishoreganj",
  "syedpur": "Saidpur",
  "badargonj": "Badarganj",
  "pirgacha": "Pirgachha",
  "pirgonj": "Pirganj",
  "taragonj": "Taraganj",
  "bokshiganj": "Bakshiganj",
  "dewangonj": "Dewanganj",
  "melandah": "Melandaha",
  "gafargaon": "Gaffargaon",
  "gouripur": "Gauripur",
  "iswarganj": "Ishwarganj",
  "muktagacha": "Muktagachha",
  "mohongonj": "Mohanganj",
  "nokla": "Nakla",
  "sreebordi": "Sreebardi"
};

module.exports = { THANAS, THANA_ALIASES };
