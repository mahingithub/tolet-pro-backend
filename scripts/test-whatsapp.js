'use strict';

/**
 * scripts/test-whatsapp.js — one-off manual test for WhatsApp reminders.
 *
 * Usage:
 *   node scripts/test-whatsapp.js                 # sends to the default number
 *   node scripts/test-whatsapp.js 01706066407     # sends to a specific number
 *   node scripts/test-whatsapp.js +8801706066407  # any BD format works
 *
 * It prints WHETHER WhatsApp is configured (booleans only — never your secret
 * keys), shows how the recipient number is normalised, then actually attempts
 * to send one test message and prints the provider's response.
 */

const env = require('../config/env');
const whatsapp = require('../services/whatsapp.service');

const phone = process.argv[2] || '01706066407';
const cfg = env.whatsapp || {};
const line = '─'.repeat(62);

console.log(line);
console.log('  WhatsApp reminder — manual test');
console.log(line);
console.log('  provider              :', cfg.provider);
if (cfg.provider === 'twilio') {
  console.log('  TWILIO_ACCOUNT_SID    :', cfg.twilioAccountSid ? 'set ✓' : 'MISSING ✗');
  console.log('  TWILIO_AUTH_TOKEN     :', cfg.twilioAuthToken ? 'set ✓' : 'MISSING ✗');
  console.log('  TWILIO_WHATSAPP_FROM  :', cfg.twilioFrom ? 'set ✓' : 'MISSING ✗');
} else {
  console.log('  WHATSAPP_PHONE_NUMBER_ID:', cfg.phoneNumberId ? 'set ✓' : 'MISSING ✗');
  console.log('  WHATSAPP_ACCESS_TOKEN   :', cfg.accessToken ? 'set ✓' : 'MISSING ✗');
  console.log('  api version             :', cfg.apiVersion);
}
console.log('  isConfigured()        :', whatsapp.isConfigured());
console.log('  recipient (input)     :', phone);
console.log('  recipient (normalised):', whatsapp.normalizeMsisdn(phone));
console.log(line);

(async () => {
  const msg =
    `✅ To-Let Pro — WhatsApp রিমাইন্ডার টেস্ট। এই মেসেজটি পেলে ইন্টিগ্রেশন ঠিকভাবে কাজ করছে। ` +
    `(${new Date().toLocaleString('en-GB')})`;

  const result = await whatsapp.sendWhatsAppMessage(phone, { body: msg });

  console.log('  send result           :', JSON.stringify(result));
  console.log(line);

  if (result.success) {
    console.log(`  ✅ SENT — open WhatsApp on ${phone} to confirm.`);
  } else if (result.skipped && result.error === 'not_configured') {
    console.log('  ⚠️  NOT SENT — WhatsApp credentials are missing from backend/.env.');
    console.log('     Add them (Meta): WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN');
    console.log('     or (Twilio): WHATSAPP_PROVIDER=twilio + TWILIO_* keys, then re-run.');
  } else if (result.skipped && result.error === 'invalid_recipient') {
    console.log('  ⚠️  NOT SENT — the phone number looks invalid.');
  } else {
    console.log('  ❌ NOT SENT — the provider rejected the message (details above).');
    console.log('     NOTE (Meta): free-form text only delivers inside the 24-hour');
    console.log('     customer-service window. If you see a "re-engagement"/template');
    console.log('     error, the API auth is actually WORKING — Meta just needs the');
    console.log('     recipient to message your business first, or an approved template.');
  }

  process.exit(result.success ? 0 : 1);
})();
