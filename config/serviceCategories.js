'use strict';

/**
 * serviceCategories.js — the single definition of every service category.
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE entry per category drives FOUR things, so they can never drift apart:
 *
 *   1. the provider registration form  (which questions he is asked)
 *   2. the provider's listing editor   (what he can edit later)
 *   3. the tenant-facing card          (what shows without tapping)
 *   4. server-side validation          (validateProviderFields below)
 *
 * Adding a category is adding an object here. No new screens, no new form
 * code, no new validators. That is the whole point: a generic "describe your
 * business" textarea is what makes registration feel like paperwork, and this
 * audience — a গ্যাস সাপ্লায়ার, a গৃহকর্মী, a মুদি দোকানদার — abandons
 * paperwork. Every field below is either a number, a tap, or a name.
 *
 * SERVED TO THE CLIENTS, NOT COPIED INTO THEM.
 * The tenant app and the provider app both read this over
 * `GET /api/services/categories`. Do not fork a copy into either frontend —
 * the backend is CommonJS and both frontends are ESM, and a hand-synced copy
 * in three places is a guaranteed source of "the form asked for a field the
 * API rejects".
 *
 * ─── IDS ARE PERMANENT ───────────────────────────────────────────────────────
 * `id` is stored on every Provider row AND is the suffix of the legacy
 * SellInterest source (`service_internet`, `service_gas`, …) already being
 * recorded in production by ServicesPage.jsx. Ids that existed there are kept
 * byte-identical so historical demand data stays joinable. Renaming an id is a
 * migration, never an edit. Same rule for option ids and price-row keys: the
 * BENGALI LABEL IS DISPLAY, THE ID IS STORAGE — relabel freely, never re-key.
 *
 * ─── LAUNCH ORDER ────────────────────────────────────────────────────────────
 * `status: 'live'` is the launch set. `status: 'planned'` entries are the rest
 * of the ServicesPage grid, kept here so their legacy SellInterest rows still
 * resolve to a real category and so turning one on later is a one-word edit.
 * A category with no approved provider in the user's area is hidden by the
 * query regardless of status — an empty category teaches tenants the whole
 * feature is broken, so it never renders.
 */

// ─── FIELD TYPES ─────────────────────────────────────────────────────────────
// Deliberately few. Every additional type is another form widget to build and
// another thing that can confuse someone filling this in on a ৳8,000 phone.
//
//   text        short free text (one line)
//   phone       an extra contact number, validated as BD mobile
//   money       whole taka, no decimals
//   choice      exactly one of `options`
//   multi       zero or more of `options`
//   bool        হ্যাঁ / না
//   price_rows  FIXED rows, provider types ONLY the numbers. The single most
//               important type in this file: never make a shopkeeper invent
//               product names, just hand him his own price list pre-written.
const FIELD_TYPES = ['text', 'phone', 'money', 'choice', 'multi', 'bool', 'price_rows'];

// ─── INTERACTION TIERS ───────────────────────────────────────────────────────
// Set by us per category, NOT by the provider. The Call button is present in
// all three tiers and is always the visually primary action — ordering is the
// optional path, never the forced one.
//
//   contact   info + prices + Call. No order flow exists at all.
//   request   Call + a one-tap structured callback ("12kg বসুন্ধরা, আজ")
//             → provider accepts → he rings back. Not a transaction system;
//             it is a phone call with the details already filled in.
//   order     Call + an itemised cart built from the provider's price rows.
//
// Start a category at `contact` and promote it only once the contact logs show
// real demand. A tier turned on later costs nothing; a dead order flow in a
// cold category costs trust.
const INTERACTIONS = ['contact', 'request', 'order'];

// ─── KYC TIERS ───────────────────────────────────────────────────────────────
//   basic  phone OTP + location pin + one photo.
//   full   basic + NID (front/back) + a geo-stamped selfie at the pinned
//          location.
//
// Each category declares BOTH:
//
//   kyc.toList    what is needed to appear at all       (always 'basic')
//   kyc.toVerify  what earns the সবুজ ভেরিফাইড badge    (always 'full')
//
// Verification is a BADGE, not a gate. Requiring NID up front is a wall that
// stops a গৃহকর্মী from ever registering; requiring it for the badge makes
// verification something the provider WANTS, because the badge and the ranking
// boost are visible commercial advantages he can see other providers enjoying.
//
// An unverified provider is listed, callable, and clearly marked অযাচাইকৃত, and
// is ranked below every verified provider in the same category. The tenant is
// never misled about who has been checked — which is the actual safety property
// worth having. A blanket NID requirement would instead produce an empty
// directory, which protects nobody.
//
// RESIDUAL RISK, stated plainly: this does mean an unverified person can be
// listed under গৃহকর্মী or ইলেকট্রিশিয়ান — categories where someone works
// unattended inside a flat. The badge, the ranking penalty and the report
// button are what carry that risk. If you ever decide a category must not be
// listable without NID, raise its `toList` to 'full' — the machinery is here.
const KYC_TIERS = ['basic', 'full'];

// ─── PRICE POLICY ────────────────────────────────────────────────────────────
// TWO SEPARATE MECHANISMS. Conflating them is what makes this unbuildable, so
// they are modelled apart:
//
// 1. FRESHNESS (`price.maxAgeDays`) — applies to every category with a
//    price_rows field. A price nobody has touched in months is a broken promise
//    to the tenant and it is To-Let Pro's name on it. How fast a price goes
//    stale is category-specific and nothing like uniform: চাল আর পেঁয়াজ moves
//    weekly, an LPG cylinder tracks the monthly BERC cycle, a BTRC broadband
//    tariff barely moves in a year, and a plumber's ভিজিট চার্জ is sticky for
//    a very long time. One global 30-day rule would be wrong for all four.
//
//    `null` means prices in this category do not go stale on a clock.
//
// 2. REGULATED CAP (`price.regulated`) — applies ONLY where the government
//    actually publishes a rate. In Bangladesh that is realistically:
//      • LPG cylinders — BERC announces a MAXIMUM retail price monthly
//      • Broadband    — BTRC's "One Country One Rate" covers the entry tiers
//    Grocery is NOT regulated. TCB and the Commerce Ministry announce prices
//    for a few items sporadically, but there is no dependable published rate to
//    enforce against, and pretending otherwise would have us accusing
//    shopkeepers of overcharging against a number we invented.
//
//    Note the word MAXIMUM. A published cap is a ceiling, not a price — shops
//    legitimately sell below it. So a cap can never auto-set a provider's
//    price. It can only (a) trigger a "rates changed, update yours" nudge, and
//    (b) flag a row priced ABOVE the ceiling for review.
const PRICE_AUTHORITIES = ['BERC', 'BTRC', 'other'];

// ─── Shared option sets ──────────────────────────────────────────────────────
// Reused across categories so the same concept never gets two spellings.

const DELIVERY_SPEED = [
  { id: 'within_1h',  bn: '১ ঘণ্টার মধ্যে', en: 'Within 1 hour' },
  { id: 'within_3h',  bn: '২-৩ ঘণ্টা',      en: '2-3 hours' },
  { id: 'same_day',   bn: 'একই দিনে',       en: 'Same day' },
  { id: 'next_day',   bn: 'পরের দিন',       en: 'Next day' },
];

const AVAILABILITY = [
  { id: 'day',        bn: 'দিনের বেলা',     en: 'Daytime' },
  { id: 'evening',    bn: 'সন্ধ্যা-রাত',    en: 'Evening' },
  { id: 'always',     bn: '২৪ ঘণ্টা',       en: '24 hours' },
];

const PAYMENT_MODES = [
  { id: 'cash',       bn: 'ক্যাশ',          en: 'Cash' },
  { id: 'bkash',      bn: 'বিকাশ',          en: 'bKash' },
  { id: 'nagad',      bn: 'নগদ',            en: 'Nagad' },
  { id: 'rocket',     bn: 'রকেট',           en: 'Rocket' },
];

// The name question. Default is deliberately PROVIDER, not দোকান: most of the
// launch set (গৃহকর্মী, ইলেকট্রিশিয়ান, প্লাম্বার, গ্যাস সাপ্লায়ার) has no shop
// and no signboard. Only genuine storefronts override it below.
const DEFAULT_NAME_LABEL  = { bn: 'প্রোভাইডারের নাম', en: 'Provider name' };
const DEFAULT_PHOTO_LABEL = { bn: 'আপনার ছবি',        en: 'Your photo' };

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  // ───────────────────────────────────────────────────────────────────────────
  // গ্যাস সিলিন্ডার — the highest-repeat transaction in a Bangladeshi rental.
  // Every flat needs one roughly monthly, forever. `request` tier because the
  // tenant knows exactly what he wants (size + brand) and the supplier just
  // needs to confirm and ring back.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'gas',                      // legacy id — SellInterest `service_gas`
    status: 'live',
    icon: 'Flame',
    label: { bn: 'গ্যাস সিলিন্ডার', en: 'Gas Cylinder' },
    blurb: { bn: 'সিলিন্ডার ডেলিভারি ও রিফিল', en: 'Cylinder delivery & refill' },
    // BERC announces a maximum retail price for LPG on a monthly cycle, so a
    // 35-day window is one cycle plus a few days' grace.
    price: {
      maxAgeDays: 35,
      regulated: {
        authority: 'BERC',
        field: 'sizes',
        rows: ['kg_5_5', 'kg_12', 'kg_15', 'kg_20', 'kg_25', 'kg_30', 'kg_35', 'kg_45'],
        note: 'BERC publishes a monthly MAXIMUM retail price; 12kg is the reference size.',
      },
    },
    interaction: 'request',
    kyc: { toList: 'basic', toVerify: 'full' },   // handles LPG
    defaultCoverage: { mode: 'radius', radiusKm: 3 },
    nameLabel:  { bn: 'প্রোভাইডার / এজেন্সির নাম', en: 'Provider / agency name' },
    photoLabel: { bn: 'দোকান বা গাড়ির ছবি', en: 'Shop or vehicle photo' },
    providerFields: [
      {
        key: 'sizes', type: 'price_rows', required: true,
        label: { bn: 'সিলিন্ডারের দাম', en: 'Cylinder prices' },
        hint:  { bn: 'যেগুলো আপনার কাছে আছে শুধু সেগুলোর দাম লিখুন', en: 'Fill in only the sizes you stock' },
        rows: [
          { key: 'kg_5_5', bn: '৫.৫ কেজি', en: '5.5 kg' },
          { key: 'kg_12',  bn: '১২ কেজি',  en: '12 kg' },
          { key: 'kg_15',  bn: '১৫ কেজি',  en: '15 kg' },
          { key: 'kg_20',  bn: '২০ কেজি',  en: '20 kg' },
          { key: 'kg_25',  bn: '২৫ কেজি',  en: '25 kg' },
          { key: 'kg_30',  bn: '৩০ কেজি',  en: '30 kg' },
          { key: 'kg_35',  bn: '৩৫ কেজি',  en: '35 kg' },
          { key: 'kg_45',  bn: '৪৫ কেজি',  en: '45 kg' },
        ],
      },
      {
        key: 'brands', type: 'multi', required: true,
        label: { bn: 'ব্র্যান্ড', en: 'Brands' },
        options: [
          { id: 'bashundhara', bn: 'বসুন্ধরা',  en: 'Bashundhara' },
          { id: 'omera',       bn: 'ওমেরা',     en: 'Omera' },
          { id: 'jamuna',      bn: 'যমুনা',     en: 'Jamuna' },
          { id: 'beximco',     bn: 'বেক্সিমকো', en: 'Beximco' },
          { id: 'total',       bn: 'টোটাল',     en: 'TotalGaz' },
          { id: 'navana',      bn: 'নাভানা',    en: 'Navana' },
          { id: 'petromax',    bn: 'পেট্রোম্যাক্স', en: 'Petromax' },
          { id: 'sena',        bn: 'সেনা',      en: 'Sena' },
          { id: 'other',       bn: 'অন্যান্য',   en: 'Other' },
        ],
      },
      {
        key: 'delivery', type: 'choice', required: true,
        label: { bn: 'ডেলিভারিতে কত সময় লাগে', en: 'Delivery time' },
        options: DELIVERY_SPEED,
      },
      {
        key: 'emptyExchange', type: 'bool', required: false,
        label: { bn: 'খালি সিলিন্ডার ফেরত নেন?', en: 'Accept empty cylinder exchange?' },
      },
      {
        key: 'stoveRepair', type: 'bool', required: false,
        label: { bn: 'চুলা / রেগুলেটর মেরামত করেন?', en: 'Repair stoves / regulators?' },
      },
      {
        key: 'payment', type: 'multi', required: false,
        label: { bn: 'পেমেন্ট নেন', en: 'Payment accepted' },
        options: PAYMENT_MODES,
      },
    ],
    // What a tenant sees on the list card, before tapping anything.
    tenantCard: ['sizes', 'delivery', 'brands'],
    // Which fields the `request` tier asks the tenant to pick. Must be a
    // subset of providerFields keys — the request is literally "one of these".
    requestFields: ['sizes', 'brands'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // পানির জার — the other monthly-forever staple. Same shape as gas.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'water',                    // legacy id — SellInterest `service_water`
    status: 'live',
    icon: 'Droplets',
    label: { bn: 'পানির জার', en: 'Water Jar' },
    blurb: { bn: 'খাবার পানি ডেলিভারি', en: 'Drinking water delivery' },
    // Jar prices move, but slowly and locally. No published rate.
    price: { maxAgeDays: 60, regulated: null },
    interaction: 'request',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'radius', radiusKm: 2 },
    nameLabel:  { bn: 'প্রোভাইডার / সাপ্লায়ারের নাম', en: 'Provider / supplier name' },
    photoLabel: { bn: 'দোকান বা গাড়ির ছবি', en: 'Shop or vehicle photo' },
    providerFields: [
      {
        key: 'jarPrices', type: 'price_rows', required: true,
        label: { bn: 'জারের দাম', en: 'Jar prices' },
        rows: [
          { key: 'jar_20l',      bn: '২০ লিটার জার',        en: '20L jar' },
          { key: 'jar_20l_swap', bn: '২০ লিটার (খালি বদলে)', en: '20L (with empty exchange)' },
          { key: 'bottle_5l',    bn: '৫ লিটার বোতল',        en: '5L bottle' },
          { key: 'jar_deposit',  bn: 'জারের জামানত',        en: 'Jar security deposit' },
        ],
      },
      {
        key: 'brands', type: 'multi', required: false,
        label: { bn: 'ব্র্যান্ড', en: 'Brands' },
        options: [
          { id: 'mum',      bn: 'মাম',     en: 'Mum' },
          { id: 'fresh',    bn: 'ফ্রেশ',    en: 'Fresh' },
          { id: 'spa',      bn: 'স্পা',     en: 'Spa' },
          { id: 'pran',     bn: 'প্রাণ',    en: 'Pran' },
          { id: 'local',    bn: 'লোকাল',   en: 'Local' },
        ],
      },
      {
        key: 'delivery', type: 'choice', required: true,
        label: { bn: 'ডেলিভারিতে কত সময় লাগে', en: 'Delivery time' },
        options: DELIVERY_SPEED,
      },
      {
        key: 'floorDelivery', type: 'bool', required: false,
        label: { bn: 'ফ্ল্যাট পর্যন্ত দিয়ে আসেন?', en: 'Carry up to the flat?' },
      },
      {
        key: 'dispenser', type: 'bool', required: false,
        label: { bn: 'ডিসপেনসার ভাড়া দেন?', en: 'Rent out dispensers?' },
      },
    ],
    tenantCard: ['jarPrices', 'delivery', 'floorDelivery'],
    requestFields: ['jarPrices'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // মুদি দোকান — a SHORT staples list, not a catalogue. Nobody is doing a
  // monthly bazaar in-app yet, but "২ কেজি মসুর ডাল, আজ বিকেলে" is a real and
  // constant order. Twelve rows is the whole product.
  //
  // One of only two categories where the name question says দোকান, because
  // this is a genuine storefront.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'grocery',
    status: 'live',
    icon: 'ShoppingBasket',
    label: { bn: 'মুদি দোকান', en: 'Grocery' },
    blurb: { bn: 'চাল, ডাল, তেল ও নিত্যপণ্য', en: 'Rice, lentils, oil & daily staples' },
    // চাল, পেঁয়াজ, তেল move week to week — the shortest window in the file.
    // Deliberately NOT regulated: there is no dependable published rate for
    // staples to enforce against.
    price: { maxAgeDays: 7, regulated: null },
    interaction: 'order',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'radius', radiusKm: 1.5 },
    nameLabel:  { bn: 'দোকানের নাম', en: 'Shop name' },
    photoLabel: { bn: 'দোকানের ছবি', en: 'Shop photo' },
    providerFields: [
      {
        key: 'staples', type: 'price_rows', required: true,
        label: { bn: 'নিত্যপণ্যের দাম', en: 'Staple prices' },
        hint:  { bn: 'যা আছে তার দাম দিন, বাকিগুলো খালি রাখুন', en: 'Price what you stock, leave the rest blank' },
        rows: [
          { key: 'rice_miniket',  bn: 'চাল — মিনিকেট',   en: 'Rice — Miniket',    unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'rice_najir',    bn: 'চাল — নাজিরশাইল', en: 'Rice — Najirshail', unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'rice_atash',    bn: 'চাল — আটাশ',      en: 'Rice — Atash',      unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'lentil_mosur',  bn: 'মসুর ডাল',        en: 'Red lentil',        unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'lentil_mug',    bn: 'মুগ ডাল',         en: 'Mung dal',          unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'chola',         bn: 'ছোলা',            en: 'Chickpea',          unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'oil_soybean',   bn: 'সয়াবিন তেল',      en: 'Soybean oil',       unit: { bn: 'লিটার', en: 'litre' } },
          { key: 'sugar',         bn: 'চিনি',            en: 'Sugar',             unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'salt',          bn: 'লবণ',             en: 'Salt',              unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'atta',          bn: 'আটা',             en: 'Atta',              unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'onion',         bn: 'পেঁয়াজ',          en: 'Onion',             unit: { bn: 'কেজি', en: 'kg' } },
          { key: 'egg',           bn: 'ডিম',             en: 'Egg',               unit: { bn: 'হালি', en: 'per 4' } },
        ],
      },
      {
        key: 'minOrder', type: 'money', required: false,
        label: { bn: 'সর্বনিম্ন অর্ডার', en: 'Minimum order' },
      },
      {
        key: 'freeAbove', type: 'money', required: false,
        label: { bn: 'ফ্রি ডেলিভারি (এই টাকার উপরে)', en: 'Free delivery above' },
      },
      {
        key: 'delivery', type: 'choice', required: true,
        label: { bn: 'ডেলিভারিতে কত সময় লাগে', en: 'Delivery time' },
        options: DELIVERY_SPEED,
      },
      {
        key: 'payment', type: 'multi', required: false,
        label: { bn: 'পেমেন্ট নেন', en: 'Payment accepted' },
        options: PAYMENT_MODES,
      },
    ],
    tenantCard: ['staples', 'freeAbove', 'delivery'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // গৃহকর্মী — your own example, and the purest `contact` case: a name, a
  // rate, a phone number. Three questions. No order flow will ever make sense
  // here; the tenant calls and arranges it themselves.
  //
  // Absorbs the legacy `cook` tile (রান্না is a workType here, not a category).
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'domestic_helper',
    status: 'live',
    icon: 'Users',
    label: { bn: 'গৃহকর্মী', en: 'Domestic Helper' },
    blurb: { bn: 'রান্না, পরিষ্কার ও ঘরের কাজ', en: 'Cooking, cleaning & housework' },
    // A monthly rate is sticky; it does not go stale on a clock.
    price: { maxAgeDays: null, regulated: null },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },   // works unattended inside the flat
    defaultCoverage: { mode: 'areas' },
    nameLabel:  DEFAULT_NAME_LABEL,
    photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [
      {
        key: 'workType', type: 'multi', required: true,
        label: { bn: 'কী কী কাজ করেন', en: 'Work offered' },
        options: [
          { id: 'cooking',   bn: 'রান্না',           en: 'Cooking' },
          { id: 'cleaning',  bn: 'ঘর পরিষ্কার',      en: 'House cleaning' },
          { id: 'dishes',    bn: 'বাসন মাজা',        en: 'Dishwashing' },
          { id: 'laundry',   bn: 'কাপড় ধোয়া',      en: 'Washing clothes' },
          { id: 'childcare', bn: 'বাচ্চা দেখা',       en: 'Childcare' },
          { id: 'eldercare', bn: 'বয়স্কদের সেবা',    en: 'Elder care' },
        ],
      },
      {
        key: 'timing', type: 'choice', required: true,
        label: { bn: 'কখন কাজ করতে পারেন', en: 'Availability' },
        options: [
          { id: 'morning',   bn: 'সকাল',            en: 'Morning' },
          { id: 'afternoon', bn: 'দুপুর',           en: 'Afternoon' },
          { id: 'evening',   bn: 'বিকাল-সন্ধ্যা',   en: 'Afternoon-evening' },
          { id: 'part_time', bn: 'ছুটা (পার্ট-টাইম)', en: 'Part-time' },
          { id: 'full_time', bn: 'ফুল-টাইম',        en: 'Full-time' },
          { id: 'live_in',   bn: 'থাকা-খাওয়াসহ',    en: 'Live-in' },
        ],
      },
      {
        key: 'rate', type: 'money', required: true,
        label: { bn: 'মাসিক রেট (৳)', en: 'Monthly rate (৳)' },
        hint:  { bn: 'একটি কাজের জন্য আনুমানিক', en: 'Approximate, for one task' },
      },
      {
        key: 'experience', type: 'choice', required: false,
        label: { bn: 'অভিজ্ঞতা', en: 'Experience' },
        options: [
          { id: 'lt_1y',  bn: '১ বছরের কম', en: 'Under 1 year' },
          { id: 'y1_3',   bn: '১-৩ বছর',    en: '1-3 years' },
          { id: 'y3_plus', bn: '৩ বছরের বেশি', en: '3+ years' },
        ],
      },
    ],
    tenantCard: ['workType', 'timing', 'rate'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // ইলেকট্রিশিয়ান — legacy id `electricity` ("Wiring & fixes"), kept so the
  // SellInterest history joins. `contact`: nobody books an electrician through
  // a form, they describe the problem on the phone.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'electricity',              // legacy id — SellInterest `service_electricity`
    status: 'live',
    icon: 'Zap',
    label: { bn: 'ইলেকট্রিশিয়ান', en: 'Electrician' },
    blurb: { bn: 'ওয়্যারিং, ফ্যান, এসি ও ফ্রিজ', en: 'Wiring, fans, AC & fridge' },
    // A visit charge barely moves. Confirm yearly, don't nag.
    price: { maxAgeDays: 365, regulated: null },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },   // works unattended inside the flat
    defaultCoverage: { mode: 'radius', radiusKm: 4 },
    nameLabel:  DEFAULT_NAME_LABEL,
    photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [
      {
        key: 'workType', type: 'multi', required: true,
        label: { bn: 'কী কী কাজ করেন', en: 'Work offered' },
        options: [
          { id: 'wiring',   bn: 'ওয়্যারিং',          en: 'Wiring' },
          { id: 'fan_light', bn: 'ফ্যান ও লাইট',     en: 'Fans & lights' },
          { id: 'ac',       bn: 'এসি',               en: 'AC' },
          { id: 'fridge',   bn: 'ফ্রিজ',             en: 'Fridge' },
          { id: 'washing',  bn: 'ওয়াশিং মেশিন',     en: 'Washing machine' },
          { id: 'ips',      bn: 'আইপিএস / জেনারেটর', en: 'IPS / generator' },
          { id: 'motor',    bn: 'পানির মোটর',        en: 'Water motor' },
        ],
      },
      {
        key: 'visitCharge', type: 'money', required: true,
        label: { bn: 'ভিজিট চার্জ (৳)', en: 'Visit charge (৳)' },
        hint:  { bn: 'শুধু আসার খরচ — কাজের দাম আলাদা', en: 'Call-out only; repair priced separately' },
      },
      {
        key: 'availability', type: 'choice', required: true,
        label: { bn: 'কখন পাওয়া যায়', en: 'Availability' },
        options: AVAILABILITY,
      },
      {
        key: 'emergency', type: 'bool', required: false,
        label: { bn: 'জরুরি কল নেন?', en: 'Take emergency calls?' },
      },
    ],
    tenantCard: ['workType', 'visitCharge', 'availability'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // প্লাম্বার — split out of the legacy `repairs` tile ("Plumbing & more").
  // `repairs` stays below as the general handyman catch-all.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'plumber',
    status: 'live',
    icon: 'Wrench',
    label: { bn: 'প্লাম্বার', en: 'Plumber' },
    blurb: { bn: 'পাইপ, বেসিন, ট্যাংক ও পাম্প', en: 'Pipes, basins, tanks & pumps' },
    price: { maxAgeDays: 365, regulated: null },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },   // works unattended inside the flat
    defaultCoverage: { mode: 'radius', radiusKm: 4 },
    nameLabel:  DEFAULT_NAME_LABEL,
    photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [
      {
        key: 'workType', type: 'multi', required: true,
        label: { bn: 'কী কী কাজ করেন', en: 'Work offered' },
        options: [
          { id: 'leak',    bn: 'পাইপ লিক',        en: 'Pipe leaks' },
          { id: 'basin',   bn: 'বেসিন ও কমোড',    en: 'Basin & commode' },
          { id: 'tank',    bn: 'পানির ট্যাংক',     en: 'Water tank' },
          { id: 'pump',    bn: 'মোটর ও পাম্প',     en: 'Motor & pump' },
          { id: 'geyser',  bn: 'গিজার',           en: 'Geyser' },
          { id: 'fitting', bn: 'নতুন ফিটিং',      en: 'New fittings' },
        ],
      },
      {
        key: 'visitCharge', type: 'money', required: true,
        label: { bn: 'ভিজিট চার্জ (৳)', en: 'Visit charge (৳)' },
        hint:  { bn: 'শুধু আসার খরচ — কাজের দাম আলাদা', en: 'Call-out only; repair priced separately' },
      },
      {
        key: 'availability', type: 'choice', required: true,
        label: { bn: 'কখন পাওয়া যায়', en: 'Availability' },
        options: AVAILABILITY,
      },
      {
        key: 'emergency', type: 'bool', required: false,
        label: { bn: 'জরুরি কল নেন?', en: 'Take emergency calls?' },
      },
    ],
    tenantCard: ['workType', 'visitCharge', 'availability'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // ইন্টারনেট — the headline example from the original brief. `contact`, not
  // `order`: an ISP connection is a site survey and a cable pull, never a
  // one-tap purchase. What the tenant needs is the package table and a number.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'internet',                 // legacy id — SellInterest `service_internet`
    status: 'live',
    icon: 'Wifi',
    label: { bn: 'ইন্টারনেট', en: 'Internet' },
    blurb: { bn: 'ব্রডব্যান্ড ও ওয়াইফাই সংযোগ', en: 'Broadband & WiFi connections' },
    // BTRC's "One Country One Rate" fixes the entry broadband tiers; the
    // higher speeds are the ISP's own pricing and are not covered.
    price: {
      maxAgeDays: 180,
      regulated: {
        authority: 'BTRC',
        field: 'packages',
        rows: ['mbps_5', 'mbps_10', 'mbps_20'],
        note: 'BTRC "One Country One Rate" covers the entry tiers only.',
      },
    },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'areas' },   // ISPs sell by covered area, not radius
    nameLabel:  { bn: 'আইএসপি / প্রোভাইডারের নাম', en: 'ISP / provider name' },
    photoLabel: { bn: 'অফিস বা দোকানের ছবি', en: 'Office or shop photo' },
    providerFields: [
      {
        key: 'packages', type: 'price_rows', required: true,
        label: { bn: 'মাসিক প্যাকেজ', en: 'Monthly packages' },
        hint:  { bn: 'যে স্পিডগুলো দেন শুধু সেগুলোর দাম লিখুন', en: 'Price only the speeds you offer' },
        rows: [
          { key: 'mbps_5',   bn: '৫ Mbps',   en: '5 Mbps',   unit: { bn: 'মাস', en: 'month' } },
          { key: 'mbps_10',  bn: '১০ Mbps',  en: '10 Mbps',  unit: { bn: 'মাস', en: 'month' } },
          { key: 'mbps_15',  bn: '১৫ Mbps',  en: '15 Mbps',  unit: { bn: 'মাস', en: 'month' } },
          { key: 'mbps_20',  bn: '২০ Mbps',  en: '20 Mbps',  unit: { bn: 'মাস', en: 'month' } },
          { key: 'mbps_30',  bn: '৩০ Mbps',  en: '30 Mbps',  unit: { bn: 'মাস', en: 'month' } },
          { key: 'mbps_50',  bn: '৫০ Mbps',  en: '50 Mbps',  unit: { bn: 'মাস', en: 'month' } },
          { key: 'mbps_100', bn: '১০০ Mbps', en: '100 Mbps', unit: { bn: 'মাস', en: 'month' } },
        ],
      },
      {
        key: 'connectionFee', type: 'money', required: true,
        label: { bn: 'সংযোগ ফি (৳)', en: 'Connection fee (৳)' },
        hint:  { bn: 'ফ্রি হলে ০ দিন', en: 'Enter 0 if free' },
      },
      {
        key: 'routerIncluded', type: 'bool', required: false,
        label: { bn: 'রাউটার দেন?', en: 'Router included?' },
      },
      {
        key: 'support', type: 'choice', required: false,
        label: { bn: 'সাপোর্ট', en: 'Support hours' },
        options: AVAILABILITY,
      },
      {
        key: 'setupDays', type: 'choice', required: false,
        label: { bn: 'সংযোগ দিতে কত দিন লাগে', en: 'Setup time' },
        options: [
          { id: 'same_day', bn: 'একই দিনে', en: 'Same day' },
          { id: 'd1_2',     bn: '১-২ দিন',  en: '1-2 days' },
          { id: 'd3_7',     bn: '৩-৭ দিন',  en: '3-7 days' },
        ],
      },
    ],
    tenantCard: ['packages', 'connectionFee', 'setupDays'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // খাবার হোটেল — `monthlyMeal` is the real product here, not single plates.
  // A bachelor tenant eats from a মেস/হোটেল on a monthly plan; that is the
  // single most valuable number on this card.
  //
  // The second (and last) category where the name question says দোকান.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'eatery',
    status: 'live',
    icon: 'Utensils',
    label: { bn: 'খাবার হোটেল', en: 'Eatery' },
    blurb: { bn: 'মাসিক মিল ও প্রতিদিনের খাবার', en: 'Monthly meal plans & daily food' },
    price: { maxAgeDays: 30, regulated: null },
    interaction: 'order',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'radius', radiusKm: 2 },
    nameLabel:  { bn: 'হোটেল / দোকানের নাম', en: 'Eatery / shop name' },
    photoLabel: { bn: 'দোকানের ছবি', en: 'Shop photo' },
    providerFields: [
      {
        key: 'mealPlans', type: 'price_rows', required: true,
        label: { bn: 'মাসিক মিল প্যাকেজ', en: 'Monthly meal plans' },
        rows: [
          { key: 'lunch_only',   bn: 'শুধু দুপুর',        en: 'Lunch only',       unit: { bn: 'মাস', en: 'month' } },
          { key: 'dinner_only',  bn: 'শুধু রাত',          en: 'Dinner only',      unit: { bn: 'মাস', en: 'month' } },
          { key: 'lunch_dinner', bn: 'দুপুর + রাত',       en: 'Lunch + dinner',   unit: { bn: 'মাস', en: 'month' } },
          { key: 'all_three',    bn: 'তিন বেলা',          en: 'All three meals',  unit: { bn: 'মাস', en: 'month' } },
        ],
      },
      {
        key: 'singleMeals', type: 'price_rows', required: false,
        label: { bn: 'একবেলার দাম', en: 'Single meal prices' },
        rows: [
          { key: 'rice_veg',   bn: 'ভাত + সবজি',     en: 'Rice + vegetable' },
          { key: 'rice_fish',  bn: 'ভাত + মাছ',      en: 'Rice + fish' },
          { key: 'rice_meat',  bn: 'ভাত + মাংস',     en: 'Rice + meat' },
          { key: 'khichuri',   bn: 'খিচুড়ি',         en: 'Khichuri' },
          { key: 'biryani',    bn: 'বিরিয়ানি',       en: 'Biryani' },
          { key: 'breakfast',  bn: 'সকালের নাস্তা',  en: 'Breakfast' },
        ],
      },
      {
        key: 'delivery', type: 'choice', required: true,
        label: { bn: 'ডেলিভারিতে কত সময় লাগে', en: 'Delivery time' },
        options: DELIVERY_SPEED,
      },
      {
        key: 'minOrder', type: 'money', required: false,
        label: { bn: 'সর্বনিম্ন অর্ডার', en: 'Minimum order' },
      },
    ],
    tenantCard: ['mealPlans', 'singleMeals', 'delivery'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // ─── PLANNED ───────────────────────────────────────────────────────────────
  // Not live. Present so the legacy SellInterest sources still resolve to a
  // real category, and so turning one on is `status: 'live'` plus filling in
  // providerFields. Field lists here are intentionally thin — design them
  // properly at the moment of launch, against real demand data, not now.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'cleaning',                 // legacy — SellInterest `service_cleaning`
    status: 'planned',
    icon: 'Sparkles',
    label: { bn: 'ক্লিনিং সার্ভিস', en: 'Home Cleaning' },
    blurb: { bn: 'ডিপ ও নিয়মিত পরিষ্কার', en: 'Deep & regular cleaning' },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'radius', radiusKm: 5 },
    nameLabel: DEFAULT_NAME_LABEL, photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [], tenantCard: [],
  },
  {
    id: 'repairs',                  // legacy — SellInterest `service_repairs`
    status: 'planned',
    icon: 'Hammer',
    label: { bn: 'সাধারণ মেরামত', en: 'General Repairs' },
    blurb: { bn: 'দরজা, জানালা, আসবাব', en: 'Doors, windows, furniture' },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'radius', radiusKm: 4 },
    nameLabel: DEFAULT_NAME_LABEL, photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [], tenantCard: [],
  },
  {
    id: 'movers',                   // legacy — SellInterest `service_movers`
    status: 'planned',
    icon: 'Truck',
    label: { bn: 'শিফটিং', en: 'Movers' },
    blurb: { bn: 'বাসা বদল ও প্যাকিং', en: 'Shifting & packing' },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'areas' },
    nameLabel: DEFAULT_NAME_LABEL, photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [], tenantCard: [],
  },
  {
    id: 'laundry',                  // legacy — SellInterest `service_laundry`
    status: 'planned',
    icon: 'Shirt',
    label: { bn: 'লন্ড্রি', en: 'Laundry' },
    blurb: { bn: 'ওয়াশ ও আয়রন', en: 'Wash & iron' },
    interaction: 'request',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'radius', radiusKm: 2 },
    nameLabel: DEFAULT_NAME_LABEL, photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [], tenantCard: [],
  },
  {
    id: 'education',                // legacy — SellInterest `service_education`
    status: 'planned',
    icon: 'GraduationCap',
    label: { bn: 'শিক্ষা', en: 'Education' },
    blurb: { bn: 'টিউটর ও কোচিং', en: 'Tutors & coaching' },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'areas' },
    nameLabel: DEFAULT_NAME_LABEL, photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [], tenantCard: [],
  },
  {
    id: 'security',                 // legacy — SellInterest `service_security`
    status: 'planned',
    icon: 'ShieldCheck',
    label: { bn: 'নিরাপত্তা', en: 'Security' },
    blurb: { bn: 'সিসিটিভি ও গার্ড', en: 'CCTV & guards' },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'areas' },
    nameLabel: DEFAULT_NAME_LABEL, photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [], tenantCard: [],
  },
  {
    id: 'pest',                     // legacy — SellInterest `service_pest`
    status: 'planned',
    icon: 'Bug',
    label: { bn: 'পেস্ট কন্ট্রোল', en: 'Pest Control' },
    blurb: { bn: 'নিরাপদ ও সার্টিফায়েড', en: 'Safe & certified' },
    interaction: 'contact',
    kyc: { toList: 'basic', toVerify: 'full' },
    defaultCoverage: { mode: 'radius', radiusKm: 8 },
    nameLabel: DEFAULT_NAME_LABEL, photoLabel: DEFAULT_PHOTO_LABEL,
    providerFields: [], tenantCard: [],
  },
];

// ─── Legacy SellInterest source → category id ────────────────────────────────
// ServicesPage.jsx records `service_<id>` on every category tap. Every old id
// still maps to a real category except `cook`, which is now a workType inside
// domestic_helper. Used when reading historical demand so the launch set is
// chosen from data rather than intuition.
const LEGACY_SOURCE_MAP = {
  service_education:   'education',
  service_internet:    'internet',
  service_electricity: 'electricity',
  service_gas:         'gas',
  service_water:       'water',
  service_cleaning:    'cleaning',
  service_repairs:     'repairs',
  service_security:    'security',
  service_movers:      'movers',
  service_laundry:     'laundry',
  service_pest:        'pest',
  service_cook:        'domestic_helper',   // folded in — রান্না is a workType now
};

// ─── Lookups ─────────────────────────────────────────────────────────────────

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** One category, or null. Never throws — an unknown id is a 404, not a crash. */
function getCategory(id) {
  return BY_ID.get(String(id || '')) || null;
}

/** Only the categories a provider may currently register under. */
function liveCategories() {
  return CATEGORIES.filter((c) => c.status === 'live');
}

/** One field definition inside a category, or null. */
function getField(categoryId, fieldKey) {
  const cat = getCategory(categoryId);
  if (!cat) return null;
  return cat.providerFields.find((f) => f.key === fieldKey) || null;
}

// ─── Price freshness ─────────────────────────────────────────────────────────
// How old a provider's prices are, as a state the UI and the nudge cron can
// both branch on. Four states, deliberately a LADDER rather than a cliff:
//
//   fresh    normal card
//   aging    amber "দাম X দিন আগে আপডেট" stamp + a nudge to the provider
//   stale    ranked below fresh providers, stamp turns red
//   expired  PRICES hidden — the provider is NOT. Name, distance and the Call
//            button stay, labelled "দাম অনির্ধারিত — ফোন করে জেনে নিন".
//
// That last state is the important one. Delisting a provider because he did
// not touch a number punishes someone who PAID a registration fee and whose
// phone number is still perfectly good — and the phone number is the product.
// Hiding a price we can no longer stand behind protects the tenant; hiding the
// provider protects nobody and generates a refund request.
//
// Thresholds derive from the category's own maxAgeDays (1×, 1.5×, 2×) so
// grocery's 7-day clock and internet's 180-day clock use one rule.
function freshnessState(categoryId, pricesUpdatedAt) {
  const cat = getCategory(categoryId);
  const maxAgeDays = cat && cat.price ? cat.price.maxAgeDays : null;

  // Categories whose prices don't decay on a clock (a plumber's visit charge,
  // a গৃহকর্মী's monthly rate) are always fresh. Never nag someone about a
  // number that hasn't changed in a year and didn't need to.
  if (!maxAgeDays) return { state: 'fresh', ageDays: null, maxAgeDays: null };
  if (!pricesUpdatedAt) return { state: 'expired', ageDays: null, maxAgeDays };

  const ageDays = Math.floor((Date.now() - new Date(pricesUpdatedAt).getTime()) / 86_400_000);
  let state = 'fresh';
  if (ageDays >= maxAgeDays * 2) state = 'expired';
  else if (ageDays >= maxAgeDays * 1.5) state = 'stale';
  else if (ageDays >= maxAgeDays) state = 'aging';

  return { state, ageDays, maxAgeDays };
}

/** Categories with a published government cap — who the rate cron watches. */
function regulatedCategories() {
  return CATEGORIES.filter((c) => c.price && c.price.regulated);
}

// ─── Validation ──────────────────────────────────────────────────────────────
// The registration form renders from these definitions and the API validates
// against the same ones, so "the form asked for a field the API rejects" is
// structurally impossible. Errors are returned as a list (not thrown on the
// first) — a provider filling a price table should see every problem at once,
// not be sent back six times.
//
// Returns { ok, errors: [{ key, code, message }], values } where `values` is
// the cleaned payload safe to persist. Unknown keys are DROPPED, not rejected:
// an older app build posting a field we have since removed should still be
// able to save the rest.

const BD_MOBILE = /^(?:\+?88)?01[3-9]\d{8}$/;

function validateProviderFields(categoryId, input, { partial = false, allowNotLive = false } = {}) {
  const cat = getCategory(categoryId);
  if (!cat) {
    return { ok: false, errors: [{ key: null, code: 'unknown_category', message: 'এই ক্যাটাগরি নেই।' }], values: {} };
  }
  // `allowNotLive` exists for the EDITOR, not for registration. A provider
  // already registered under a category we later pulled from the launch set
  // must still be able to fix his own prices; only new registrations are
  // closed off.
  if (cat.status !== 'live' && !allowNotLive) {
    return { ok: false, errors: [{ key: null, code: 'category_not_live', message: 'এই ক্যাটাগরিতে এখন রেজিস্ট্রেশন বন্ধ।' }], values: {} };
  }

  const raw = input && typeof input === 'object' ? input : {};
  const errors = [];
  const values = {};

  for (const field of cat.providerFields) {
    const v = raw[field.key];
    const missing = v === undefined || v === null || v === '' ||
      (Array.isArray(v) && v.length === 0);

    if (missing) {
      // `partial` is what makes save-at-every-step possible. A registration is
      // filled in over several screens and WILL be interrupted by a customer
      // halfway through; rejecting the draft because step 6 has not happened
      // yet is how someone comes back to an empty form and gives up. Required
      // fields are enforced once, at submit.
      if (field.required && !partial) {
        errors.push({ key: field.key, code: 'required', message: `${field.label.bn} দিন।` });
      }
      continue;
    }

    switch (field.type) {
      case 'text': {
        const s = String(v).trim().slice(0, 200);
        if (!s) { errors.push({ key: field.key, code: 'required', message: `${field.label.bn} দিন।` }); break; }
        values[field.key] = s;
        break;
      }

      case 'phone': {
        const s = String(v).replace(/[\s-]/g, '');
        if (!BD_MOBILE.test(s)) {
          errors.push({ key: field.key, code: 'bad_phone', message: 'সঠিক মোবাইল নম্বর দিন।' });
          break;
        }
        values[field.key] = s;
        break;
      }

      case 'money': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
          errors.push({ key: field.key, code: 'bad_amount', message: `${field.label.bn} সঠিক নয়।` });
          break;
        }
        values[field.key] = Math.round(n);
        break;
      }

      case 'bool': {
        values[field.key] = v === true || v === 'true' || v === 1 || v === '1';
        break;
      }

      case 'choice': {
        const allowed = new Set((field.options || []).map((o) => o.id));
        const s = String(v);
        if (!allowed.has(s)) {
          errors.push({ key: field.key, code: 'bad_option', message: `${field.label.bn} সঠিক নয়।` });
          break;
        }
        values[field.key] = s;
        break;
      }

      case 'multi': {
        const allowed = new Set((field.options || []).map((o) => o.id));
        const list = (Array.isArray(v) ? v : [v]).map(String);
        const bad = list.filter((x) => !allowed.has(x));
        if (bad.length) {
          errors.push({ key: field.key, code: 'bad_option', message: `${field.label.bn} সঠিক নয়।` });
          break;
        }
        // De-dupe, and preserve the declaration order so two providers with the
        // same selections always render identically.
        const order = (field.options || []).map((o) => o.id);
        values[field.key] = order.filter((id) => list.includes(id));
        break;
      }

      case 'price_rows': {
        // Shape: { rowKey: price }. A blank/absent row means "I don't stock
        // this" and is simply omitted — never stored as 0, which would read on
        // the tenant card as "free".
        const allowed = new Set((field.rows || []).map((r) => r.key));
        const obj = (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
        if (!obj) {
          errors.push({ key: field.key, code: 'bad_shape', message: `${field.label.bn} সঠিক নয়।` });
          break;
        }
        const priced = {};
        const badRows = [];
        for (const [rowKey, price] of Object.entries(obj)) {
          if (!allowed.has(rowKey)) continue;                 // dropped, not rejected
          if (price === '' || price === null || price === undefined) continue;
          const n = Number(price);
          // A literal 0 is an error, not an omission. Leaving a row blank is how
          // a provider says "I don't stock this"; typing 0 is a fumble, and
          // silently dropping it would make his input vanish with no
          // explanation — the worst outcome for someone who types slowly.
          if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) { badRows.push(rowKey); continue; }
          priced[rowKey] = Math.round(n);
        }
        if (badRows.length) {
          // Name the rows. "কিছু দাম সঠিক নয়" on a 12-row grocery table is a
          // dead end — the form needs to highlight the exact fields.
          const names = badRows
            .map((k) => (field.rows.find((r) => r.key === k) || {}).bn || k)
            .join(', ');
          errors.push({
            key: field.key,
            rows: badRows,
            code: 'bad_amount',
            message: `${field.label.bn} — এই দামগুলো সঠিক নয়: ${names}`,
          });
          break;
        }
        if (field.required && !partial && Object.keys(priced).length === 0) {
          errors.push({ key: field.key, code: 'required', message: `${field.label.bn} — অন্তত একটির দাম দিন।` });
          break;
        }
        values[field.key] = priced;
        break;
      }

      default:
        // An unknown type is a bug in this file, not in the request.
        errors.push({ key: field.key, code: 'bad_field_type', message: 'সার্ভার কনফিগারেশন সমস্যা।' });
    }
  }

  return { ok: errors.length === 0, errors, values };
}

module.exports = {
  CATEGORIES,
  FIELD_TYPES,
  INTERACTIONS,
  KYC_TIERS,
  PRICE_AUTHORITIES,
  LEGACY_SOURCE_MAP,
  getCategory,
  getField,
  liveCategories,
  regulatedCategories,
  freshnessState,
  validateProviderFields,
};
