'use strict';

/**
 * messageFrame — the envelope every WhatsApp / SMS reminder goes out in.
 *
 * These messages arrive from TO-LET PRO's number, not from the landlord, shop
 * or friend they are about. Recipients could not tell where they came from and
 * replied to our number, where nobody reads them. So each one now says, at the
 * top, that it is an automated message from the app, and ends with the real
 * person's number: +880… (WhatsApp makes it tappable → Call / Chat) and a
 * wa.me link that opens their chat directly.
 *
 * shortcut: links, not buttons — OpenWA has no button endpoint and WhatsApp only
 * renders buttons for the Business API; revisit if WHATSAPP_PROVIDER goes to meta.
 *
 * The in-app copy never goes through here: inside the app, the app is obvious.
 *
 * contact = { label, name, phone } — label is the role ("বাড়িওয়ালা"), may be ''.
 */

const { normalizePhone } = require('./phone');
const { toAsciiDigits } = require('./roomKey');

function resolveContact(contact) {
  if (!contact) return null;
  const e164 = normalizePhone(toAsciiDigits(contact.phone || ''));
  const name = String(contact.name || '').trim() || contact.label || '';
  return e164 ? { label: contact.label || '', name, e164 } : null;
}

function whatsappText({ title, body, contact }) {
  const c = resolveContact(contact);
  const lines = ['*TO-LET PRO* অ্যাপ থেকে স্বয়ংক্রিয় বার্তা', '━━━━━━━━━━━━━━'];
  if (title) lines.push(`*${title}*`, '');
  lines.push(body, '', '━━━━━━━━━━━━━━');
  if (c) {
    lines.push(
      `*যোগাযোগ — ${c.label ? `${c.label}: ` : ''}${c.name}*`,
      `📞 কল: ${c.e164}`,
      `💬 WhatsApp: https://wa.me/${c.e164.slice(1)}`,
      '',
      // Not "পাবেন না": in a money message "পাবেন" reads as "you are owed".
      `ℹ️ এই নম্বরে উত্তর দিলে তা ${c.name}-এর কাছে পৌঁছাবে না — উপরের নম্বরে কল বা WhatsApp করুন।`,
    );
  } else {
    lines.push('ℹ️ এই নম্বরে উত্তর দিলে তা কারও কাছে পৌঁছাবে না।');
  }
  return lines.join('\n');
}

// SMS is billed per segment and a Bangla segment is only ~67 characters, so
// the frame here is one prefix and one contact line, not the WhatsApp layout.
function smsText({ title, body, contact }) {
  const c = resolveContact(contact);
  const local = c && (c.e164.startsWith('+880') ? `0${c.e164.slice(4)}` : c.e164);
  return [
    `TO-LET PRO অ্যাপ: ${title ? `${title} — ` : ''}${body}`,
    c ? `যোগাযোগ (${c.name}): ${local}। এই SMS-এ উত্তর দেবেন না।` : 'এই SMS-এ উত্তর দেবেন না।',
  ].join('\n');
}

module.exports = { whatsappText, smsText };
