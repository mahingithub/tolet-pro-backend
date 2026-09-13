'use strict';

/**
 * otpQuota.service.js — the per-phone cap on OTP requests.
 * ═══════════════════════════════════════════════════════════════════════════
 * One function, called by every path that can cause an SMS to be sent:
 *
 *   services/auth.service.js          startSignup, forgotPassword   (rental)
 *   services/merchantAuth.service.js  startSignup, forgotPassword   (provider)
 *
 * See models/OtpQuota.js for why this is keyed on the phone rather than the
 * requester, and why it lives in Mongo rather than in the Redis limiter.
 */

const OtpQuota = require('../models/OtpQuota');
const ApiError = require('../utils/ApiError');

/**
 * Five per quarter-hour, per number.
 *
 * Sized against the worst REAL case rather than the average one: a shopkeeper
 * mistypes nothing, gets no SMS because the tower is busy, and taps "আবার কোড
 * পাঠান" as often as the 60-second cooldown in the UI allows. Three, maybe
 * four. Five leaves him a spare and still caps a bombing run at five messages
 * before the number goes quiet for the rest of the window.
 */
const MAX_PER_WINDOW = 5;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Count one OTP request against `phone`, or refuse it.
 *
 * ─── CALL THIS BEFORE ASKING WHETHER THE ACCOUNT EXISTS ──────────────────────
 * Not a style preference — it is what stops this limiter from becoming an
 * account-enumeration oracle.
 *
 * merchantAuth.forgotPassword answers identically for a registered and an
 * unregistered number, on purpose, so that the reset form cannot be used to ask
 * "is this shopkeeper on To-Let Pro?" about any number in the country. If the
 * quota were consumed only when a message actually went out, then a registered
 * number would start returning 429 after five tries while an unregistered one
 * returned 200 forever — and the limiter would hand back exactly the answer the
 * endpoint refuses to give.
 *
 * Counting every request, before the lookup, keeps both cases identical.
 *
 * The cost of that choice, stated plainly: someone can burn a specific person's
 * quota and keep them from starting a reset for up to fifteen minutes. That is
 * the better half of the trade — the alternative is not "no denial of service",
 * it is the same denial of service WITH the victim's phone buzzing each time.
 *
 * @param {string} phone E.164, already validated by the caller.
 * @returns {Promise<{count:number, remaining:number, resetsAt:Date}>}
 * @throws {ApiError} 429 `otp_quota_exceeded` once the window is spent.
 */
async function consume(phone) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  const doc = await incrementOrOpenWindow(phone, now, windowStart);

  if (doc.count > MAX_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((doc.expiresAt - now) / 1000));
    const minutes = Math.ceil(retryAfterSeconds / 60);
    // `retryAfterSeconds` goes in `details`, NOT as a sibling of `code`.
    // ApiError only carries `code` and `details` onto the wire (see
    // utils/ApiError.js and middleware/errorHandler.js) — anything else passed
    // here is accepted silently and then dropped, which is how the fields
    // otpAbuse.service.js attaches to its 429s have always vanished.
    throw ApiError.tooMany(
      `এই নম্বরে অনেকবার কোড চাওয়া হয়েছে। ${minutes} মিনিট পর আবার চেষ্টা করুন।`,
      { code: 'otp_quota_exceeded', details: { retryAfterSeconds } },
    );
  }

  return {
    count: doc.count,
    remaining: MAX_PER_WINDOW - doc.count,
    resetsAt: doc.expiresAt,
  };
}

/**
 * The counter itself: increment the running window, or start a new one, in ONE
 * atomic operation.
 *
 * ─── WHY AN AGGREGATION PIPELINE AND NOT read-then-write ─────────────────────
 * Because the traffic this exists to stop is precisely the traffic that breaks
 * read-then-write. Fifty requests fired in parallel would every one of them
 * read `count: 0`, every one of them decide it was under the limit, and every
 * one of them send an SMS — a limiter that holds under normal load and
 * evaporates under attack is not a limiter.
 *
 * A pipeline update lets the decision "is the running window still open?" be
 * made by the server, inside the same write that applies it, so there is no
 * window between reading and acting for a concurrent request to slip through.
 *
 * On insert, `$windowStartedAt` is missing; a missing field compares below any
 * date, so the `$cond` takes its else branch and the row is born with
 * `count: 1` and a window opening now — which is exactly right for a first
 * request. `phone` is set from the query's equality condition, as upserts do.
 */
async function incrementOrOpenWindow(phone, now, windowStart, isRetry = false) {
  const stillOpen = { $gt: ['$windowStartedAt', windowStart] };

  try {
    return await OtpQuota.findOneAndUpdate(
      { phone },
      [
        {
          $set: {
            windowStartedAt: { $cond: [stillOpen, '$windowStartedAt', now] },
            count: { $cond: [stillOpen, { $add: [{ $ifNull: ['$count', 0] }, 1] }, 1] },
          },
        },
        // Second stage so it reads the value the first stage just wrote.
        { $set: { expiresAt: { $add: ['$windowStartedAt', WINDOW_MS] } } },
      ],
      { upsert: true, new: true },
    );
  } catch (err) {
    // Two first-ever requests for one number can race into the same upsert;
    // the unique index lets exactly one win and the loser sees E11000. The row
    // now exists, so the same call succeeds as a plain increment. Retried once
    // only — a second collision would mean something other than this race.
    if (err?.code === 11000 && !isRetry) {
      return incrementOrOpenWindow(phone, now, windowStart, true);
    }
    throw err;
  }
}

module.exports = { consume, MAX_PER_WINDOW, WINDOW_MS };
