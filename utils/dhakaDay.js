'use strict';

/**
 * The day boundary this product actually lives in.
 * ─────────────────────────────────────────────────────────────────────────────
 * Every "today" here is a Dhaka day, never a UTC one. UTC rolls over at 6pm
 * local — the middle of a shopkeeper's evening shift — so a UTC day key would
 * split one trading evening across two pages and merge two mornings into one.
 *
 * ContactEvent and LedgerEntry each grew their own identical copy of this
 * before it had a home; they still carry theirs, and this is the shared one for
 * anything written since.
 */

/** 'YYYY-MM-DD' in Asia/Dhaka. en-CA is the locale that formats that way. */
function dhakaDayKey(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

module.exports = { dhakaDayKey };
