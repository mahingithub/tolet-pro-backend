'use strict';

/**
 * utils/phoneCountries.js — the countries a person can sign up from.
 * ──────────────────────────────────────────────────────────────────────────
 * Bangladesh, plus the places Bangladeshis most often live and work abroad.
 * Someone in Riyadh or Singapore uses a local SIM, so signup, login and
 * password reset have to accept that number and get an OTP to it.
 *
 * This is the application allowlist for Firebase Phone Authentication. The
 * Firebase SMS region policy must also allow these regions; server validation
 * alone cannot prevent direct client Firebase requests. Patterns reject
 * obviously unsuitable numbers, but do not prove carrier SMS reachability.
 *
 * MIRRORED BY tolet-pro-frontend/src/constants/phoneCountries.js, which adds
 * the names, flags and examples the picker shows. tests/phoneCountries.test.js
 * bundles that file and fails if the dial codes or patterns drift apart — a
 * country added on one side only would appear in the picker and then fail at
 * "send code".
 *
 * `mobile` matches the national significant number: what follows the dial
 * code, with no trunk 0.
 */
const PHONE_COUNTRIES = Object.freeze([
  { iso: 'BD', dial: '880', mobile: /^1[3-9]\d{8}$/ },
  { iso: 'SA', dial: '966', mobile: /^5\d{8}$/ },
  { iso: 'AE', dial: '971', mobile: /^5[024-68]\d{7}$/ },
  { iso: 'QA', dial: '974', mobile: /^[3567]\d{7}$/ },
  { iso: 'KW', dial: '965', mobile: /^[4569]\d{7}$/ },
  { iso: 'OM', dial: '968', mobile: /^[79]\d{7}$/ },
  { iso: 'BH', dial: '973', mobile: /^[36]\d{7}$/ },
  { iso: 'MY', dial: '60', mobile: /^1\d{8,9}$/ },
  { iso: 'SG', dial: '65', mobile: /^[89]\d{7}$/ },
  { iso: 'IN', dial: '91', mobile: /^[6-9]\d{9}$/ },
  { iso: 'MV', dial: '960', mobile: /^[79]\d{6}$/ },
  { iso: 'GB', dial: '44', mobile: /^7\d{9}$/ },
  { iso: 'IT', dial: '39', mobile: /^3\d{8,9}$/ },
  { iso: 'US', dial: '1', mobile: /^[2-9]\d{2}[2-9]\d{6}$/ },
]);

/**
 * Which listed country is this E.164 number a mobile in, if any?
 *
 * Null for an unlisted country or a number outside its allowed mobile shape.
 * Some numbering plans (including +1) do not distinguish landlines by shape.
 * '+6562221234' is a Singapore landline, which cannot receive the OTP and so
 * must not be allowed to spend one.
 *
 * @example
 *   mobileCountryOf('+6581234567')    // { iso: 'SG', … }
 *   mobileCountryOf('+8801712345678') // { iso: 'BD', … }
 *   mobileCountryOf('+6562221234')    // null
 *   mobileCountryOf('+33612345678')   // null — France is not listed
 */
function mobileCountryOf(e164) {
  const s = String(e164 == null ? '' : e164).trim();
  if (!/^\+\d{8,15}$/.test(s)) return null;
  const digits = s.slice(1);
  return PHONE_COUNTRIES.find(
    (c) => digits.startsWith(c.dial) && c.mobile.test(digits.slice(c.dial.length)),
  ) || null;
}

module.exports = { PHONE_COUNTRIES, mobileCountryOf };
