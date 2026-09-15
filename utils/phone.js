'use strict';

/**
 * Phone identity always includes the country code and leading + (E.164).
 * The historical *Core field names are retained for their existing indexes;
 * their values are now complete E.164 numbers, never subscriber suffixes.
 *
 * Only well-defined Bangladesh legacy formats may omit the country code.
 * Foreign numbers must include + so a national number is never assigned to
 * a guessed foreign country. Invalid or incomplete values have no identity.
 */
function normalizePhone(input) {
  const raw = String(input == null ? '' : input);
  // Remove presentation separators, never arbitrary letters or extra digits.
  const value = raw.replace(/[\s().-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(value)) return value;
  if (/^8801[3-9]\d{8}$/.test(value)) return `+${value}`;
  if (/^01[3-9]\d{8}$/.test(value)) return `+880${value.slice(1)}`;
  if (/^1[3-9]\d{8}$/.test(value)) return `+880${value}`;
  return '';
}

const phoneCore = normalizePhone;

function samePhone(a, b) {
  const canonical = normalizePhone(a);
  return Boolean(canonical) && canonical === normalizePhone(b);
}

/**
 * An anchored, complete-number matcher for records not yet migrated.
 * Bangladesh gets only the explicit historical variants above; international
 * numbers always keep their + and country code. It cannot match a suffix.
 */
function legacyPhoneRegex(canonical) {
  if (!canonical || normalizePhone(canonical) !== canonical) return null;
  const variants = [canonical];
  if (/^\+8801[3-9]\d{8}$/.test(canonical)) {
    variants.push(canonical.slice(1), `0${canonical.slice(4)}`, canonical.slice(4));
  }
  const separator = '[\\s().-]*';
  const escaped = variants.map((value) => [...value]
    .map((char) => (char === '+' ? '\\+' : char)).join(separator));
  return new RegExp(`^${separator}(?:${escaped.join('|')})${separator}$`);
}

/**
 * Indexed key lookup plus the anchored legacy fallback. Both check the source
 * phone as well: an old or bypassed update must never let a stale key identify
 * a different account. Prefixing new keys with + also isolates all old
 * digit-only comparison keys while the migration is being rolled out.
 */
function phoneMatchBranches(coreField, rawField, canonical) {
  const regex = legacyPhoneRegex(canonical);
  if (!regex) return [];
  return [
    { [coreField]: canonical, [rawField]: regex },
    { [rawField]: regex },
  ];
}

module.exports = {
  normalizePhone,
  normalizePhoneE164: normalizePhone,
  phoneCore,
  samePhone,
  legacyPhoneRegex,
  phoneMatchBranches,
};
