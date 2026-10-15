'use strict';

/**
 * subscriptionPayment.service — paying for Plus/Pro without a gateway.
 * ──────────────────────────────────────────────────────────────────────────
 * Same mechanism as the Singapore Cosmetic Shop checkout. The host pays into
 * one of our accounts — bKash / Nagad / Rocket / a bank account, each added
 * by a super admin with "Add Payment System" (BillingSettings.methods) — then
 * submits the TrxID, who paid and optionally a screenshot. Each claim is
 * then checked:
 *
 *   • automatically — the Android phone holding our wallet SIM forwards every
 *     "money received" SMS to POST /api/billing/payments/sms (an SMS-forwarder
 *     app, with the key made in the admin console). A claim is accepted only when one
 *     message has the same TrxID, the same wallet, at least the plan price,
 *     came from the number the host says they paid from, is no older than
 *     EARLIEST_BEFORE_SUBMIT_MS before the claim, and paid for nothing else.
 *   • by an admin otherwise — the console shows the claim, the screenshot and
 *     the matching message (if any) with the reason it wasn't auto-accepted.
 *     Rocket and bank payments always come here: their messages aren't read.
 *
 * approve() is the only path from money to a plan, and it runs once per claim
 * even when the SMS and an admin act at the same moment.
 */

const { createHash, randomBytes, timingSafeEqual } = require('crypto');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const PaymentSms = require('../models/PaymentSms');
const BillingSettings = require('../models/BillingSettings');
const Property = require('../models/Property');
const cloudinary = require('./cloudinary.service');
const notifications = require('./notification.service');
const ApiError = require('../utils/ApiError');
const { planTier } = require('../utils/subscriptionTier');
const { toAsciiDigits } = require('../utils/roomKey');

// The plan catalogue. Ids MUST match the frontend's PLANS in
// tolet-pro-frontend/src/services/subscriptionService.js. Monthly prices here
// are only defaults: a super admin sets the live ones (BillingSettings.prices)
// and the yearly discount; getPlans() is what every price read goes through.
const DEFAULT_PLANS = [
  { id: 'plus_monthly', name: 'Plus Monthly', nameBn: 'প্লাস (মাসিক)',  price: 19, currency: 'BDT', interval: 'month', tier: 'plus' },
  { id: 'plus_yearly',  name: 'Plus Yearly',  nameBn: 'প্লাস (বার্ষিক)',            currency: 'BDT', interval: 'year',  tier: 'plus' },
  { id: 'pro_monthly',  name: 'Pro Monthly',  nameBn: 'প্রো (মাসিক)',   price: 49, currency: 'BDT', interval: 'month', tier: 'pro' },
  { id: 'pro_yearly',   name: 'Pro Yearly',   nameBn: 'প্রো (বার্ষিক)',             currency: 'BDT', interval: 'year',  tier: 'pro' },
];
const MONTHLY_PLANS = DEFAULT_PLANS.filter((p) => p.interval === 'month');

/** % off twelve months when paying for a year, unless a super admin set another. */
const DEFAULT_YEARLY_DISCOUNT = 20;

const METHOD_NAMES = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', bank: 'Bank transfer' };

// Only these wallets' "money received" SMS can be read (parsePaymentSms).
const SMS_WALLETS = ['bkash', 'nagad'];

/** How often a host may correct one open claim before it waits for an admin. */
const MAX_SUBMISSIONS = 5;

/** A message this long before the claim can't be its payment (an old TrxID reused). */
const EARLIEST_BEFORE_SUBMIT_MS = 3 * 24 * 60 * 60_000;

const SETTINGS_ID = 'billing';

/** The settings row, or an empty object before a super admin has saved one. */
async function getSettings() {
  return (await BillingSettings.findById(SETTINGS_ID).lean()) || {};
}

/**
 * The catalogue with the admin's prices applied. A yearly plan costs twelve
 * months less the yearly discount, rounded to the taka; it also carries
 * `listPrice` (twelve months, undiscounted) and `discount` for the strike-through.
 */
async function getPlans(settings) {
  const s = settings || await getSettings();
  const discount = s.yearlyDiscount ?? DEFAULT_YEARLY_DISCOUNT;
  const monthly = (tier) => {
    const plan = MONTHLY_PLANS.find((p) => p.tier === tier);
    return (s.prices && s.prices[plan.id]) || plan.price;
  };
  return DEFAULT_PLANS.map((p) => {
    if (p.interval === 'month') return { ...p, price: monthly(p.tier) };
    const listPrice = monthly(p.tier) * 12;
    return { ...p, price: Math.round(listPrice * (100 - discount) / 100), listPrice, discount };
  });
}

/**
 * A payment method as hosts and the console see it. `autoCheck` is true only
 * when its SMS can be read AND the forwarder key is set — it is what lets the
 * checkout promise "activates instantly".
 */
function publicMethod(m, smsOn) {
  return {
    id: String(m._id),
    type: m.type,
    name: METHOD_NAMES[m.type],
    accountNumber: m.accountNumber,
    accountName: m.accountName || '',
    accountType: m.accountType || '',
    bankName: m.bankName || '',
    branchName: m.branchName || '',
    routingNumber: m.routingNumber || '',
    instructions: m.instructions || '',
    autoCheck: smsOn && SMS_WALLETS.includes(m.type),
  };
}

/** The methods hosts can pay with right now. */
async function payMethods(settings) {
  const s = settings || await getSettings();
  return (s.methods || []).filter((m) => m.enabled).map((m) => publicMethod(m, !!s.smsKeyHash));
}

/** Every method, switched off ones too — for the console. */
async function adminMethods(settings) {
  const s = settings || await getSettings();
  return (s.methods || []).map((m) => ({ ...publicMethod(m, !!s.smsKeyHash), enabled: !!m.enabled }));
}

/** " 9gh7 k2l3-m4 " → "9GH7K2L3M4" */
const normalizeTrxId = (s) => toAsciiDigits(s).toUpperCase().replace(/[\s-]/g, '');

/** bKash TrxIDs have 10 letters/digits, Nagad's 8 — allow a little either way. */
const isTrxId = (s) => /^[A-Z0-9]{6,20}$/.test(s);

/** '+880 1711-234567' / '০১৭১১২৩৪৫৬৭' → '01711234567'; '' when it isn't a BD mobile. */
function localMobile(s) {
  const d = toAsciiDigits(s).replace(/\D/g, '').replace(/^88(?=01)/, '');
  return /^01[3-9]\d{8}$/.test(d) ? d : '';
}

/** A wallet account number: a BD mobile; Rocket may add its 12th check digit. */
function walletNumber(type, raw) {
  const d = toAsciiDigits(raw).replace(/\D/g, '').replace(/^88(?=01)/, '');
  const ok = type === 'rocket' ? /^01[3-9]\d{8}\d?$/ : /^01[3-9]\d{8}$/;
  return ok.test(d) ? d : '';
}

// ─── Reading the wallet messages ────────────────────────────────────────────

/** The official senders: the name the phone shows, or the helpline number. */
function walletOfSender(from) {
  const f = String(from || '').trim().replace(/[\s-]/g, '').toLowerCase();
  if (f === 'bkash' || f === '16247') return 'bkash';
  if (f === 'nagad' || f === '16167') return 'nagad';
  return null;
}

const AMOUNT = String.raw`(?:tk|bdt|৳)\.?\s*(\d[\d,]*(?:\.\d{1,2})?)`;

/**
 * Money RECEIVED, from a bKash or Nagad message — e.g.
 *   bKash: "You have received Tk 49.00 from 01711234567. Fee Tk 0.00. Balance Tk 5,300.00. TrxID 9GH7K2L3M4 at 06/10/2026 14:30"
 *   Nagad: "Money Received. Amount: Tk 49.00 Sender: 01711234567 Ref: N/A TxnID: 73F3ANNJ Balance: Tk 5300.00 06/10/2026 14:30"
 * Anything else — money sent or cashed out, OTPs, offers, or a message from
 * any other number (anyone can text our phone a look-alike) — gives null.
 */
function parsePaymentSms(from, text) {
  const method = walletOfSender(from);
  if (!method) return null;
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const incoming = /\b(?:received|cash[\s-]?in)\b/i.exec(t);
  if (!incoming) return null;
  // The wallet's own credits aren't someone paying: "received Tk 55.50 as Cashout Fee", cashback.
  if (/\bcash\s?back\b/i.test(t) || new RegExp(String.raw`\breceived\s+${AMOUNT}\s+as\b`, 'i').test(t)) return null;
  const trx = /\b(?:trx|txn|trans(?:action)?)\.?\s*id\s*(?:no\.?)?\s*[:.#-]?\s*([a-z0-9]{6,20})\b/i.exec(t);
  // "Amount: Tk 49" when labelled; otherwise the first amount after "received" (later ones are fee and balance).
  const amount = new RegExp(String.raw`\bamount\s*:?\s*${AMOUNT}`, 'i').exec(t)
    || new RegExp(AMOUNT, 'i').exec(t.slice(incoming.index));
  // A mobile number, or an agent's / merchant's code ("from DM2549").
  const sender = /\b(?:from|sender|uddokta|agent)\s*:?\s*(\+?(?:88)?01[3-9]\d{8}|[a-z0-9]{3,20})\b/i.exec(t);
  if (!trx || !amount) return null;
  const value = Number(amount[1].replace(/,/g, ''));
  if (!(value > 0)) return null;
  const who = sender ? sender[1] : '';
  return { method, trxId: trx[1].toUpperCase(), amount: value, sender: localMobile(who) || who.toUpperCase() };
}

const hashKey = (key) => createHash('sha256').update(key).digest('hex');

/** Does the forwarder's `Authorization: Bearer <key>` match the stored hash? */
function smsKeyMatches(storedHash, header) {
  const given = String(header || '').replace(/^Bearer\s+/i, '').trim();
  if (!storedHash || !given) return false;
  const a = Buffer.from(hashKey(given), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─── Settings (super admins, admin console) ─────────────────────────────────

/** Validate and clean "Add Payment System" input into a stored method. */
function cleanMethod(input = {}) {
  const bad = (msg, code) => ApiError.badRequest(msg, { code });
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const type = String(input.type || '').toLowerCase();
  if (!METHOD_NAMES[type]) throw bad('মাধ্যম বেছে নিন: bKash, Nagad, Rocket বা ব্যাংক।', 'bad_method_type');

  const out = {
    type,
    accountName: text(input.accountName, 120),
    instructions: text(input.instructions, 300),
    enabled: input.enabled !== false,
    accountType: '',
    bankName: '',
    branchName: '',
    routingNumber: '',
  };
  if (type === 'bank') {
    out.accountNumber = toAsciiDigits(input.accountNumber).replace(/[\s-]/g, '');
    if (!/^\d{6,20}$/.test(out.accountNumber)) throw bad('ব্যাংক অ্যাকাউন্ট নম্বর ৬–২০ সংখ্যার হতে হবে।', 'bad_account_number');
    out.bankName = text(input.bankName, 120);
    if (!out.bankName) throw bad('ব্যাংকের নাম লিখুন।', 'bad_bank_name');
    // A host typing a bank transfer must be able to check whose account it is.
    if (!out.accountName) throw bad('অ্যাকাউন্টের নাম লিখুন — ইউজার দেখে নিশ্চিত হবেন টাকা কার কাছে যাচ্ছে।', 'bad_account_name');
    out.branchName = text(input.branchName, 120);
    out.routingNumber = toAsciiDigits(input.routingNumber).replace(/\D/g, '').slice(0, 20);
  } else {
    out.accountNumber = walletNumber(type, input.accountNumber);
    if (!out.accountNumber) {
      throw bad(`${METHOD_NAMES[type]} নম্বরটি সঠিক নয় (০১ দিয়ে শুরু, ১১ সংখ্যা${type === 'rocket' ? ', বা চেক ডিজিটসহ ১২' : ''})।`, 'bad_wallet_number');
    }
    out.accountType = input.accountType === 'merchant' ? 'merchant' : 'personal';
  }
  return out;
}

/** "Add Payment System". Returns every method. */
async function addMethod(input, adminId) {
  await BillingSettings.updateOne(
    { _id: SETTINGS_ID },
    { $push: { methods: cleanMethod(input) }, $set: { updatedBy: adminId } },
    { upsert: true },
  );
  return adminMethods();
}

/** Edit a method (also how it is switched on/off). Returns every method. */
async function updateMethod(id, input, adminId) {
  const set = { updatedBy: adminId };
  for (const [k, v] of Object.entries(cleanMethod(input))) set[`methods.$.${k}`] = v;
  const r = await BillingSettings.updateOne({ _id: SETTINGS_ID, 'methods._id': id }, { $set: set });
  if (!r.matchedCount) throw ApiError.notFound('মাধ্যমটি পাওয়া যায়নি।', { code: 'method_not_found' });
  return adminMethods();
}

/** Remove a method. Claims already made on it keep their own copy of the account. */
async function deleteMethod(id, adminId) {
  const r = await BillingSettings.updateOne(
    { _id: SETTINGS_ID, 'methods._id': id },
    { $pull: { methods: { _id: id } }, $set: { updatedBy: adminId } },
  );
  if (!r.matchedCount) throw ApiError.notFound('মাধ্যমটি পাওয়া যায়নি।', { code: 'method_not_found' });
  return adminMethods();
}

/**
 * Set the monthly ৳ price of each plan and the yearly discount (0–50 %).
 * Anything left out keeps its value; yearly prices follow from these.
 */
async function updatePrices(prices, yearlyDiscount, adminId) {
  const set = { updatedBy: adminId };
  for (const plan of MONTHLY_PLANS) {
    if (prices == null || prices[plan.id] === undefined || prices[plan.id] === '') continue;
    const value = Number(toAsciiDigits(prices[plan.id]));
    if (!Number.isInteger(value) || value < 1 || value > 100000) {
      throw ApiError.badRequest(`${plan.nameBn}: দাম ১ থেকে ১,০০,০০০ টাকার মধ্যে পূর্ণ সংখ্যা হতে হবে।`, { code: 'bad_price' });
    }
    set[`prices.${plan.id}`] = value;
  }
  if (yearlyDiscount !== undefined && yearlyDiscount !== '') {
    const pct = Number(toAsciiDigits(yearlyDiscount));
    if (!Number.isInteger(pct) || pct < 0 || pct > 50) {
      throw ApiError.badRequest('বার্ষিক ছাড় ০ থেকে ৫০ শতাংশের মধ্যে পূর্ণ সংখ্যা হতে হবে।', { code: 'bad_discount' });
    }
    set.yearlyDiscount = pct;
  }
  await BillingSettings.updateOne({ _id: SETTINGS_ID }, { $set: set }, { upsert: true });
  return getPlans();
}

/** A new forwarder key, returned once. Any earlier key stops working. */
async function createSmsKey(adminId) {
  const key = randomBytes(18).toString('base64url');
  await BillingSettings.updateOne(
    { _id: SETTINGS_ID },
    { $set: { smsKeyHash: hashKey(key), smsKeyCreatedAt: new Date(), updatedBy: adminId } },
    { upsert: true },
  );
  return key;
}

/** Turn the automatic check off: every claim then waits for an admin. */
async function removeSmsKey(adminId) {
  await BillingSettings.updateOne(
    { _id: SETTINGS_ID },
    { $set: { smsKeyHash: '', smsKeyCreatedAt: null, updatedBy: adminId } },
    { upsert: true },
  );
}

// ─── Money → plan ───────────────────────────────────────────────────────────

/**
 * Put the host on `planId` for one more interval. A renewal paid while the same
 * tier is still running (paid or trial) adds to the end of it instead of
 * throwing the remaining days away; anything else starts today.
 */
async function activatePlan(userId, planId, { method = '', trxId = '' } = {}) {
  const plan = DEFAULT_PLANS.find((p) => p.id === planId);
  if (!plan) throw ApiError.badRequest('অবাস্তব প্ল্যান আইডি।');

  const now = new Date();
  let sub = await Subscription.findOne({ userId });
  if (!sub) sub = new Subscription({ userId, planId: 'free', trialTier: 'free', trialEndsAt: null });

  const from = [now.getTime()];
  if (sub.status === 'active' && sub.currentPeriodEnd && planTier(sub.planId) === plan.tier) {
    from.push(new Date(sub.currentPeriodEnd).getTime());
  }
  if (sub.status === 'trialing' && sub.trialEndsAt && sub.trialTier === plan.tier) {
    from.push(new Date(sub.trialEndsAt).getTime());
  }
  const end = new Date(Math.max(...from));
  if (plan.interval === 'year') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);

  sub.planId = plan.id;
  sub.status = 'active';
  sub.currentPeriodEnd = end;
  // Nothing can pull money from a wallet; every period is paid by hand.
  sub.autoRenew = false;
  sub.lastPaymentMethod = METHOD_NAMES[method] || method;
  sub.lastTransactionId = trxId;
  await sub.save();

  // Existing listings pick up the badge and search sort straight away.
  await Property.updateMany({ ownerUserId: userId }, { $set: { hostTier: plan.tier } });
  return sub;
}

/**
 * Accept a pending claim: once, whoever gets here first (SMS or admin).
 * Returns { payment, subscription }, or null when it was no longer pending.
 */
async function approve(paymentId, { by, adminId = null }) {
  const payment = await SubscriptionPayment.findOneAndUpdate(
    { _id: paymentId, status: 'pending' },
    { $set: { status: 'approved', verifiedBy: by, reviewedBy: adminId, reviewedAt: new Date(), issue: '', rejectionReason: '' } },
    { new: true },
  );
  if (!payment) return null;

  const subscription = await activatePlan(payment.userId, payment.planId, payment);
  const plan = DEFAULT_PLANS.find((p) => p.id === payment.planId);
  notifications.emit({
    userId: payment.userId,
    type: 'payment',
    title: '✅ পেমেন্ট গ্রহণ করা হয়েছে',
    // Notifications are written in Bangla, so is the plan name inside them.
    body: `${plan.nameBn} চালু হয়েছে — ${subscription.currentPeriodEnd.toLocaleDateString('bn-BD')} পর্যন্ত।`,
    data: { kind: 'subscription_payment', paymentId: String(payment._id), url: '/subscription' },
  });
  return { payment, subscription };
}

/** Why `sms` can't be accepted automatically as `payment`, or '' if it can. */
function issueWith(payment, sms) {
  if (sms.paymentId && String(sms.paymentId) !== String(payment._id)) return 'already_used';
  if (sms.method !== payment.method) return 'method_mismatch';
  if (new Date(sms.createdAt) < new Date(payment.createdAt.getTime() - EARLIEST_BEFORE_SUBMIT_MS)) return 'too_old';
  if (Math.round(sms.amount) < Math.round(payment.amount)) return 'amount_short';
  if (!payment.sender || localMobile(sms.sender) !== payment.sender) return 'sender_mismatch';
  return '';
}

/**
 * Check a pending claim against the forwarded messages. Saves the outcome on
 * the claim; returns the claim as it now stands.
 */
async function autoCheck(payment) {
  if (payment.status !== 'pending') return payment;
  // Rocket and bank messages aren't read — those wait for an admin.
  if (!SMS_WALLETS.includes(payment.method)) return payment;

  // The message on the wallet the host chose, or else one on another wallet
  // (so the admin sees "method_mismatch" instead of nothing).
  const found = await PaymentSms.find({ method: { $in: SMS_WALLETS }, trxId: payment.trxId }).lean();
  const sms = found.find((s) => s.method === payment.method) || found[0];

  payment.smsId = sms ? sms._id : null;
  payment.issue = sms ? issueWith(payment, sms) : '';
  if (!sms || payment.issue) {
    await payment.save();
    return payment;
  }

  // Claim the message first: one SMS pays for one claim, even if two race.
  const claimed = await PaymentSms.findOneAndUpdate(
    { _id: sms._id, paymentId: null },
    { $set: { paymentId: payment._id } },
  );
  if (!claimed) {
    payment.issue = 'already_used';
    await payment.save();
    return payment;
  }
  await payment.save();
  const done = await approve(payment._id, { by: 'sms' });
  if (done) return done.payment;

  // An admin decided first. If they rejected it, free the message for the real claim.
  const now = await SubscriptionPayment.findById(payment._id);
  if (now && now.status !== 'approved') {
    await PaymentSms.updateOne({ _id: sms._id, paymentId: payment._id }, { $set: { paymentId: null } });
  }
  return now || payment;
}

// ─── What the host sends ────────────────────────────────────────────────────

/**
 * A host's payment details (+ optional screenshot from multer). Creates the
 * open claim, or corrects it when one is already waiting, then checks it.
 */
async function submit(user, input, file) {
  // The price is read now, so the amount the host is asked for is the one the SMS is checked against.
  const plan = (await getPlans()).find((p) => p.id === input.planId);
  if (!plan) throw ApiError.badRequest('অবাস্তব প্ল্যান আইডি।');

  const chosen = (await payMethods()).find((m) => m.id === String(input.methodId || ''));
  if (!chosen) {
    throw ApiError.badRequest('এই মাধ্যমে এখন পেমেন্ট নেওয়া হচ্ছে না। আরেকটি মাধ্যম বেছে নিন।', { code: 'method_unavailable' });
  }
  const method = chosen.type;
  const name = METHOD_NAMES[method];
  const trxId = normalizeTrxId(input.trxId);
  let sender;
  if (method === 'bank') {
    if (!/^[A-Z0-9]{4,40}$/.test(trxId)) {
      throw ApiError.badRequest('ব্যাংকের স্লিপ বা মেসেজে থাকা রেফারেন্স / ট্রানজেকশন নম্বর লিখুন।', { code: 'bad_trx_id' });
    }
    // Who the transfer came from: the account holder's name or account number.
    sender = String(input.sender || '').trim().slice(0, 80);
    if (sender.length < 2) {
      throw ApiError.badRequest('যে অ্যাকাউন্ট থেকে পাঠিয়েছেন তার নাম বা নম্বর লিখুন।', { code: 'bad_sender' });
    }
  } else {
    if (!isTrxId(trxId)) {
      throw ApiError.badRequest(`${name} মেসেজে যেমন আছে ঠিক তেমন TrxID লিখুন, যেমন 9GH7K2L3M4`, { code: 'bad_trx_id' });
    }
    sender = walletNumber(method, input.sender);
    if (!sender) {
      throw ApiError.badRequest(`যে ${name} নম্বর থেকে পাঠিয়েছেন সেটি লিখুন (১১ সংখ্যা)`, { code: 'bad_sender' });
    }
  }
  if (file && !/^image\/(jpeg|png|webp)$/.test(file.mimetype || '')) {
    throw ApiError.badRequest('শুধু ছবি (JPG/PNG/WEBP) আপলোড করা যাবে।', { code: 'bad_screenshot' });
  }
  if (await SubscriptionPayment.exists({ trxId, method, status: 'approved' })) {
    throw ApiError.conflict('এই TrxID দিয়ে আগেই একটি পেমেন্ট গ্রহণ করা হয়েছে।', { code: 'trx_used' });
  }

  // One open claim per host: sending again corrects it rather than queueing a second.
  let payment = await SubscriptionPayment.findOne({ userId: user._id, status: 'pending' });
  if (payment && payment.submissions >= MAX_SUBMISSIONS) {
    throw ApiError.tooMany(`পেমেন্টের তথ্য ইতিমধ্যে ${MAX_SUBMISSIONS} বার পাঠানো হয়েছে। আমরা যাচাই করে জানাব, অথবা সাপোর্টে যোগাযোগ করুন।`, { code: 'too_many_submissions' });
  }
  if (payment) {
    payment.submissions += 1;
  } else {
    payment = new SubscriptionPayment({
      userId: user._id,
      userName: String(user.name || '').slice(0, 120),
      userPhone: String(user.phone || '').slice(0, 20),
    });
  }
  Object.assign(payment, {
    planId: plan.id,
    amount: plan.price,
    method,
    methodId: chosen.id,
    // A copy of where the money was sent, so the claim reads right even after the method is edited.
    paidTo: method === 'bank' ? `${chosen.bankName} ${chosen.accountNumber}` : `${name} ${chosen.accountNumber}`,
    trxId,
    sender,
  });

  // A new screenshot replaces the old one; details sent again without one keep it.
  // The picture is optional and the money is already sent, so a failed upload
  // must not lose the claim — it is saved without it (the host is told).
  let screenshotFailed = false;
  if (file) {
    try {
      const uploaded = await cloudinary.uploadBuffer(file.buffer, {
        folder: `tolet-pro/subscription-payments/${user._id}`,
        publicId: `proof_${payment._id}`,
        type: 'authenticated',
      });
      payment.screenshotUrl = uploaded.secureUrl;
      payment.screenshotPublicId = uploaded.publicId;
    } catch (err) {
      screenshotFailed = true;
      console.error('[subscription-payment] screenshot upload failed:', err.http_code || err.status || '', err.message);
    }
  }
  await payment.save();

  const checked = await autoCheck(payment);
  checked.screenshotFailed = screenshotFailed;
  if (checked.status === 'pending') {
    notifications.emitToAdmins({
      type: 'payment',
      title: '💳 সাবস্ক্রিপশন পেমেন্ট যাচাই করুন',
      body: `${payment.userName || payment.userPhone} — ${plan.nameBn} ৳${plan.price} (${name} ${trxId})`,
      data: { kind: 'subscription_payment', paymentId: String(payment._id) },
    });
  }
  return checked;
}

/**
 * A message forwarded by the wallet phone. Payments are kept (once each);
 * anything else is dropped unstored. Claims already waiting on this TrxID are
 * checked straight away.
 * @returns {'ignored'|'duplicate'|'saved'|'matched'}
 */
async function receiveSms(from, text) {
  const parsed = parsePaymentSms(from, text);
  if (!parsed) return 'ignored';
  try {
    await PaymentSms.create({ ...parsed, text: String(text).trim().slice(0, 1000) });
  } catch (err) {
    if (err && err.code === 11000) return 'duplicate';
    throw err;
  }
  let matched = false;
  const waiting = await SubscriptionPayment.find({ trxId: parsed.trxId, status: 'pending' });
  for (const p of waiting) {
    if ((await autoCheck(p)).status === 'approved') matched = true;
  }
  return matched ? 'matched' : 'saved';
}

// ─── The admin's decisions ──────────────────────────────────────────────────

/** "Received": the admin saw the money. */
async function adminApprove(paymentId, adminId) {
  const payment = await SubscriptionPayment.findById(paymentId);
  if (!payment) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');
  if (payment.status !== 'pending') throw ApiError.conflict('এই পেমেন্ট ইতিমধ্যে রিভিউ করা হয়েছে।');
  if (await SubscriptionPayment.exists({ _id: { $ne: payment._id }, trxId: payment.trxId, method: payment.method, status: 'approved' })) {
    throw ApiError.conflict('এই TrxID দিয়ে আগেই আরেকটি পেমেন্ট গ্রহণ করা হয়েছে।', { code: 'trx_used' });
  }
  // Tie up the matching message if nobody used it, so it can't pay again.
  await PaymentSms.updateOne(
    { method: payment.method, trxId: payment.trxId, paymentId: null },
    { $set: { paymentId: payment._id } },
  );
  const done = await approve(payment._id, { by: 'admin', adminId });
  if (!done) throw ApiError.conflict('এই পেমেন্ট ইতিমধ্যে রিভিউ করা হয়েছে।');
  return done.payment;
}

/** "Not received": the host is told why and may send the details again. */
async function adminReject(paymentId, reason, adminId) {
  const payment = await SubscriptionPayment.findOneAndUpdate(
    { _id: paymentId, status: 'pending' },
    { $set: { status: 'rejected', rejectionReason: String(reason || '').trim().slice(0, 300), reviewedBy: adminId, reviewedAt: new Date() } },
    { new: true },
  );
  if (!payment) throw ApiError.conflict('এই পেমেন্ট ইতিমধ্যে রিভিউ করা হয়েছে বা পাওয়া যায়নি।');
  notifications.emit({
    userId: payment.userId,
    type: 'payment',
    title: '❌ পেমেন্ট যাচাই করা যায়নি',
    body: payment.rejectionReason
      ? `TrxID ${payment.trxId}: ${payment.rejectionReason}`
      : `TrxID ${payment.trxId} এর পেমেন্ট খুঁজে পাওয়া যায়নি। সঠিক তথ্য দিয়ে আবার পাঠান।`,
    data: { kind: 'subscription_payment', paymentId: String(payment._id), url: '/subscription' },
  });
  return payment;
}

/** What the host's own app needs about a claim — no SMS or review internals. */
function publicPayment(p) {
  return {
    id: String(p._id),
    planId: p.planId,
    amount: p.amount,
    method: p.method,
    paidTo: p.paidTo || '',
    trxId: p.trxId,
    sender: p.sender,
    status: p.status,
    rejectionReason: p.status === 'rejected' ? p.rejectionReason : '',
    hasScreenshot: !!p.screenshotUrl,
    // Only on the response to the submit that tried to upload one.
    screenshotFailed: !!p.screenshotFailed,
    createdAt: p.createdAt,
    reviewedAt: p.reviewedAt,
  };
}

module.exports = {
  DEFAULT_PLANS,
  METHOD_NAMES,
  MAX_SUBMISSIONS,
  getSettings,
  getPlans,
  updatePrices,
  payMethods,
  adminMethods,
  addMethod,
  updateMethod,
  deleteMethod,
  createSmsKey,
  removeSmsKey,
  normalizeTrxId,
  localMobile,
  parsePaymentSms,
  smsKeyMatches,
  activatePlan,
  submit,
  receiveSms,
  adminApprove,
  adminReject,
  publicPayment,
};
