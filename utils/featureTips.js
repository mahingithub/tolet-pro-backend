'use strict';

/**
 * featureTips.js — what a new account is told about, and when.
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * Someone installs the app, signs up, looks at one screen and leaves. Nothing
 * ever tells them the app also keeps their rent ledger, or splits a roommate
 * bill, or reminds a tenant before rent is due. They did not decide those
 * features were useless — they never learned they existed.
 *
 * So this is a short, finite drip: four notifications over the first two weeks,
 * each about ONE feature, each opening the screen that feature lives on. Then
 * it stops, forever. It is onboarding, not a newsletter.
 *
 * THE RULES THAT KEEP IT FROM BECOMING SPAM
 *
 *   1. FOUR, AND THEN NEVER AGAIN. Days 1, 3, 7 and 14 after signup. There is
 *      no day 30, no "we miss you", no re-entry. An account that finishes the
 *      tour is done with it permanently — services/featureTour.service.js
 *      records each step and never repeats one.
 *
 *   2. IT IS PROMOTIONAL, AND IS CLASSIFIED AS SUCH. Type 'feature_tip' is
 *      mapped in notifyPolicy to the marketingPush switch and the promos
 *      channel — the one channel a user can mute in Android settings without
 *      losing a single rent alert. We are advertising our own product; the
 *      honest place for that is the channel people can turn off.
 *
 *   3. ROLE-CORRECT OR NOT SENT. A tip's destination is a real route from
 *      utils/campaignTargets.js, and a landlord-only page is never sent to a
 *      tenant — App.jsx would silently redirect them to their own dashboard,
 *      which is a notification that lies about where it goes. Each tip
 *      therefore carries a separate landlord and tenant variant, and a tip with
 *      no variant for someone's role is skipped for that person rather than
 *      substituted.
 *
 *   4. THE USER'S OWN LANGUAGE. Copy is written in both, and the sweep picks by
 *      preferences.language. A Bengali-speaking landlord getting English push
 *      notifications from an app whose entire UI they set to Bengali reads as a
 *      different, careless product.
 *
 * IMAGES ARE OPTIONAL, AND ABSENCE IS A VALID STATE
 * Some tips carry a poster because the feature is visual and a sentence does
 * not land — a ledger screen explains itself in one look. Others are text,
 * because a poster on "your rent reminder is set" adds nothing but weight on a
 * slow connection.
 *
 * Four of the five posters are live (see IMG below); day 3 is deliberately
 * text. A tip whose image is null, or whose URL is unusable, still sends — it
 * just sends without a picture. That degradation is the point: a poster is an
 * enhancement to a notification, never a precondition for one.
 */

// Optional base for tips whose `image` is a bare filename. Unused by the
// posters below — see imageFor() for why this account cannot address assets by
// name — but kept for a host where names ARE the path.
const IMAGE_BASE = String(process.env.FEATURE_TIP_IMAGE_BASE || '').replace(/\/+$/, '');

// ─── The posters ────────────────────────────────────────────────────────────
// Full Cloudinary delivery URLs, because the public_ids carry an auto-generated
// suffix (`tip-search_xoxzfl`) that nothing can derive from the filename.
//
// `f_auto,q_auto,w_1024` is not decoration. The originals are 1774×887 PNGs at
// ~1.5 MB each; through this transformation they arrive at ~100 KB, a 93% cut,
// with no visible difference at the size a notification renders. That matters
// more here than almost anywhere else in the app: the image is fetched over
// whatever connection the recipient happens to have, and a poster that has not
// finished downloading is a notification that shows no poster at all.
const POSTER = 'https://res.cloudinary.com/dsrolbe0j/image/upload/f_auto,q_auto,w_1024';

const IMG = {
  // "কার ভাড়া জমা? কারটা বাকি?" — the rent ledger overview.
  ledger:   `${POSTER}/v1789985371/tip-ledger_e8jnzn.png`,
  // "নিজের খরচ, ভাগাভাগির হিসাব" — the roommate wallet.
  living:   `${POSTER}/v1789985388/tip-living_oxl1vf.png`,
  // "মিস্ত্রি দরকার?" — home services.
  services: `${POSTER}/v1789985394/tip-services_wvennb.png`,
  // "বাসা খালি? বিজ্ঞাপন দিন" — listing a property.
  listing:  `${POSTER}/v1789985397/tip-listing_qeb0ke.png`,
  // "পছন্দের বাসা খুঁজুন সহজে" — searching for a home.
  search:   `${POSTER}/v1789985402/tip-search_xoxzfl.png`,
};

/**
 * Absolute URL for a poster, or null when there isn't a usable one.
 *
 * TWO FORMS ARE ACCEPTED, and the full URL is the one to prefer:
 *
 *   'https://…/tip-ledger.png'  → used as-is
 *   'tip-ledger.png'            → joined onto FEATURE_TIP_IMAGE_BASE
 *
 * The bare-filename form only works when an asset's delivery URL is
 * predictable from its name, and on THIS Cloudinary account it is not: the
 * account is in dynamic-folders mode, where the folder and filename you see in
 * the Media Library are display metadata and the real public_id is an
 * auto-generated string (a live example is `dbjszyt1ynvvhvyz73mx.avif`, sitting
 * at the root with no folder in its path). Guessing a URL there returns 401,
 * which Cloudinary uses for "no such asset" — so a tip would ship a link that
 * silently resolves to nothing.
 *
 * Hence: paste the URL Cloudinary gives you. The base form is kept for a host
 * where names ARE the path, and because it costs one line to support.
 *
 * Only https is ever emitted. FCM fetches this URL from GOOGLE'S servers, not
 * from the phone, and a plain-http or unreachable image is dropped there
 * without an error we ever see — the notification simply arrives missing its
 * picture, which is indistinguishable from not having configured one.
 */
function imageFor(file) {
  if (!file) return null;
  const direct = String(file);
  if (/^https:\/\/\S+$/i.test(direct)) return direct;
  // A full URL that is NOT https is refused rather than quietly joined onto the
  // base, which would produce a nonsense path.
  if (/^[a-z]+:\/\//i.test(direct)) return null;
  if (!IMAGE_BASE) return null;
  const url = `${IMAGE_BASE}/${direct}`;
  return /^https:\/\//i.test(url) ? url : null;
}

/**
 * The tour. `day` is whole days since the account was created — or, for a
 * guest, since the app was first opened on that device.
 *
 * Each entry has `landlord`, `tenant` and `guest` variants. A variant is:
 *   title  { bn, en }   push + in-app heading
 *   body   { bn, en }   one sentence. This is a notification, not a blog post.
 *   path   string       an EXACT path from utils/campaignTargets.js
 *   image  string|null  poster filename, resolved through imageFor()
 *
 * ── WHY `guest` IS NOT JUST THE LANDLORD COPY ─────────────────────────────
 * A guest has not signed up, so we do not know whether they came here to rent
 * out a flat or to find one — and every page behind a login is a dead end for
 * them. RequireAuth would bounce them to the login screen, which turns "look at
 * this useful feature" into "sign in first", which is the opposite of the
 * invitation we meant to send.
 *
 * So every guest destination is a PUBLIC route (access: 'public' in
 * utils/campaignTargets.js), and the copy is written for somebody who has not
 * decided yet. It shows the thing working rather than asking them to commit.
 */
const TIPS = [
  {
    id: 'day1_ledger',
    day: 1,
    // The landlord's reason for installing, restated as a thing they can do
    // right now. Visual: the ledger is a screen that explains itself.
    landlord: {
      title: { bn: 'ভাড়ার হিসাব আর খাতায় লিখতে হবে না', en: 'Your rent ledger, without the notebook' },
      body: {
        bn: 'কে দিয়েছে, কে বাকি — সব এক জায়গায়। রসিদও অ্যাপ থেকেই পাঠানো যায়।',
        en: 'Who paid, who owes — all in one place, with receipts you can send from the app.',
      },
      path: '/tenant-manager',
      image: IMG.ledger,
    },
    tenant: {
      title: { bn: 'বাসার খরচ ভাগ করুন ঝগড়া ছাড়াই', en: 'Split the house bills without the argument' },
      body: {
        bn: 'বাজার, বিল, ধার — কে কত দিল নিজেই হিসাব রাখে।',
        en: 'Groceries, bills, loans — it keeps track of who paid what.',
      },
      path: '/living',
      image: IMG.living,
    },
    // '/tenant-manager' is public — the ভাড়ার খাতা landing page, which shows
    // what the ledger does without an account.
    guest: {
      title: { bn: 'ভাড়ার হিসাব রাখুন ফ্রি-তে', en: 'Keep your rent accounts, free' },
      body: {
        bn: 'কে দিয়েছে, কে বাকি — খাতার বদলে অ্যাপে। দেখে নিন কেমন কাজ করে।',
        en: 'Who paid, who owes — in the app instead of a notebook. See how it works.',
      },
      path: '/tenant-manager',
      image: IMG.ledger,
    },
  },

  {
    id: 'day3_alerts',
    day: 3,
    landlord: {
      title: { bn: 'ভাড়া বাকি পড়লে নিজেই জানিয়ে দেবে', en: 'It tells you when rent is late' },
      body: {
        bn: 'প্রতি মাসে কাকে মনে করাতে হবে, আর খুঁজতে হবে না — স্মার্ট অ্যালার্ট নিজেই ধরিয়ে দেয়।',
        en: 'No more checking who to chase each month — Smart Alerts surfaces it for you.',
      },
      path: '/smart-alerts',
      // Text only: "your reminder is set" is a sentence, not a picture.
      image: null,
    },
    tenant: {
      title: { bn: 'ভাড়ার রসিদ হারানোর ভয় নেই', en: 'Your rent receipts, kept for you' },
      body: {
        bn: 'প্রতিটি পেমেন্টের রসিদ অ্যাপেই জমা থাকে — যখন খুশি দেখে নিন।',
        en: 'Every payment keeps its receipt in the app, ready whenever you need it.',
      },
      path: '/tenant-dashboard',
      image: null,
    },
    guest: {
      title: { bn: 'অ্যাপটা আসলে কী কী করে?', en: 'What this app actually does' },
      body: {
        bn: 'ভাড়ার খাতা, বাসা খোঁজা, বাসার কাজের লোক — এক মিনিটে দেখে নিন।',
        en: 'Rent ledger, finding a home, house repairs — a one-minute look.',
      },
      path: '/how-it-works',
      image: null,
    },
  },

  {
    id: 'day7_services',
    day: 7,
    // Shared feature, so both roles get it — but each is sent to a page their
    // own account can actually open.
    landlord: {
      title: { bn: 'মিস্ত্রি, ইলেকট্রিশিয়ান — অ্যাপ থেকেই', en: 'Plumber, electrician — from the app' },
      body: {
        bn: 'বাড়ির কাজের জন্য যাচাই করা লোক খুঁজুন, দরদাম দেখে তবেই ডাকুন।',
        en: 'Find verified people for house work, see the rate before you call.',
      },
      path: '/services',
      image: IMG.services,
    },
    tenant: {
      title: { bn: 'মিস্ত্রি, ইলেকট্রিশিয়ান — অ্যাপ থেকেই', en: 'Plumber, electrician — from the app' },
      body: {
        bn: 'বাসার কাজের জন্য যাচাই করা লোক খুঁজুন, দরদাম দেখে তবেই ডাকুন।',
        en: 'Find verified people for house work, see the rate before you call.',
      },
      path: '/services',
      image: IMG.services,
    },
    // Identical to both — home services needs no account to browse, so the
    // guest sees exactly what a signed-in user sees.
    guest: {
      title: { bn: 'মিস্ত্রি, ইলেকট্রিশিয়ান — অ্যাপ থেকেই', en: 'Plumber, electrician — from the app' },
      body: {
        bn: 'বাসার কাজের জন্য যাচাই করা লোক খুঁজুন, দরদাম দেখে তবেই ডাকুন।',
        en: 'Find verified people for house work, see the rate before you call.',
      },
      path: '/services',
      image: IMG.services,
    },
  },

  {
    id: 'day14_reach',
    day: 14,
    landlord: {
      title: { bn: 'খালি ঘর? ভাড়াটিয়া খুঁজে দিই', en: 'Empty room? Let tenants find it' },
      body: {
        bn: 'বিজ্ঞাপন দিন কয়েক মিনিটে — যারা ওই এলাকায় বাসা খুঁজছেন তাঁরাই দেখবেন।',
        en: 'Post it in minutes — the people already searching your area will see it.',
      },
      path: '/list-property',
      image: IMG.listing,
    },
    tenant: {
      title: { bn: 'পছন্দের এলাকায় বাসা খুঁজুন', en: 'Find a home where you want to live' },
      body: {
        bn: 'এলাকা আর বাজেট দিন — মিলে গেলে সরাসরি বাড়িওয়ালার সাথে কথা বলুন।',
        en: 'Pick an area and a budget, then talk to the landlord directly.',
      },
      path: '/to-let',
      image: IMG.search,
    },
    // The last thing a guest hears. '/to-let' is the public listing hub — the
    // one page where somebody who has not committed can get real value in one
    // tap, which is the best possible note to end an uninvited tour on.
    guest: {
      title: { bn: 'আপনার এলাকায় কী কী বাসা খালি আছে?', en: 'See what’s available near you' },
      body: {
        bn: 'এলাকা আর বাজেট দিন — অ্যাকাউন্ট ছাড়াই দেখে নিতে পারেন।',
        en: 'Pick an area and a budget — no account needed to look.',
      },
      path: '/to-let',
      image: IMG.search,
    },
  },
];

/** Every day offset the tour fires on, ascending. */
const TIP_DAYS = TIPS.map((t) => t.day).sort((a, b) => a - b);

/** The widest offset — how far back the sweep ever has to look. */
const MAX_TIP_DAY = TIP_DAYS[TIP_DAYS.length - 1];

/**
 * The tip due on `day`, resolved for one person.
 *
 * @param {number} day    whole days since the account (or install) began
 * @param {'landlord'|'tenant'|'guest'} role
 * @param {'bn'|'en'} lang
 * @returns {{id,title,body,path,image}|null} null when no tip is due, or when
 *          this tip has no variant for that role — see rule 3 in the header.
 */
function tipFor(day, role, lang = 'en') {
  const tip = TIPS.find((t) => t.day === day);
  if (!tip) return null;

  const variant = tip[role];
  if (!variant) return null;

  // Anything other than 'bn' falls back to English rather than throwing: the
  // schema constrains this field, but a document written before it existed can
  // still carry undefined, and a missing language must not cost someone their
  // notification.
  const l = lang === 'bn' ? 'bn' : 'en';

  return {
    id: tip.id,
    title: variant.title[l],
    body: variant.body[l],
    path: variant.path,
    image: imageFor(variant.image),
  };
}

module.exports = { TIPS, TIP_DAYS, MAX_TIP_DAY, tipFor, imageFor };
