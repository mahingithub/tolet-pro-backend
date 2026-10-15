'use strict';

/**
 * tenantWelcome.service — one WhatsApp when a landlord puts someone in a home.
 *
 * Names the landlord and the building; utils/messageFrame adds the "from the
 * TO-LET PRO app" header and the landlord's own number to call or WhatsApp.
 *
 * Never throws. Callers don't await it: the shared throttle spaces sends
 * seconds apart, and an AI-scan import can seat thirty tenants in one request.
 */

const whatsapp = require('./whatsapp.service');
const { whatsappText } = require('../utils/messageFrame');

async function sendTenantWelcome({ landlord, buildingName, tenantName, tenantPhone }) {
  try {
    if (!tenantPhone) return { success: false, skipped: true };
    // Without the landlord's number the message only invites replies to the bot.
    if (!whatsapp.normalizeMsisdn(landlord && landlord.phone)) return { success: false, skipped: true };
    const landlordName = (landlord.name || '').trim() || 'আপনার বাড়িওয়ালা';
    const building = String(buildingName || '').trim();
    const where = building ? `"${building}"-এ` : 'তাঁর বাসায়';
    const body = [
      `প্রিয় ${tenantName || 'ভাড়াটিয়া'},`,
      `${landlordName} আপনাকে ${where} ভাড়াটিয়া হিসেবে যুক্ত করেছেন।`,
      ...(building ? ['', `🏢 বিল্ডিং: ${building}`] : []),
    ].join('\n');
    const text = whatsappText({
      title: '🏠 ভাড়াটিয়া হিসেবে যুক্ত করা হয়েছে',
      body,
      contact: { label: 'বাড়িওয়ালা', name: landlordName, phone: landlord.phone },
    });
    return await whatsapp.sendWhatsAppMessage(tenantPhone, { body: text });
  } catch (err) {
    console.warn('[tenantWelcome] failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendTenantWelcome };
