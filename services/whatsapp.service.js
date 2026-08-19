
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const puppeteerConfig = {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
};

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
} else if (process.platform === 'darwin') {
    puppeteerConfig.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerConfig
});

let isClientReady = false;

client.on('qr', (qr) => {
    console.log('\n=============================================');
    console.log('⬆️  SCAN THIS QR CODE TO CONNECT WHATSAPP (BOT) ⬆️');
    console.log('=============================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n✅ Unofficial WhatsApp Client is ready! Bot is running.');
    isClientReady = true;
});

client.initialize();

/**
 * Normalise a phone number to the international form WITHOUT a leading '+'
 * (Copied exactly from the old implementation to maintain compatibility)
 */
function normalizeMsisdn(phone) {
  let s = String(phone || '').replace(/\D/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('0') && s.length === 11) s = `880${s.slice(1)}`;
  return s;
}

function isConfigured() {
  return true; // The unofficial bot is always active if this script runs
}

function normalizeTemplateData(templateData) {
  if (templateData == null) return { kind: 'text', body: '' };
  if (typeof templateData === 'string') return { kind: 'text', body: templateData };

  if (templateData.template) {
    return {
      kind: 'text',
      body: templateData.body || templateData.text || `[Template: ${templateData.template}]`
    };
  }
  return { kind: 'text', body: templateData.body || templateData.text || '' };
}

/**
 * Send a WhatsApp message. NEVER throws — always resolves to a result object.
 * Compatible with the old signature.
 */
async function sendWhatsAppMessage(phone, templateData) {
  const msisdn = normalizeMsisdn(phone);
  const tpl = normalizeTemplateData(templateData);
  const summary = (tpl.body || '').slice(0, 80);

  if (!msisdn || msisdn.length < 8) {
    console.warn(`[whatsapp] skip — no valid recipient phone (got "${phone}")`);
    return { success: false, skipped: true, error: 'invalid_recipient' };
  }

  if (!isClientReady) {
    console.warn(`[whatsapp] Client not ready (scan QR code first). Would send to ${msisdn}: "${summary}"`);
    return { success: false, skipped: true, error: 'client_not_ready' };
  }

  const chatId = `${msisdn}@c.us`;

  try {
    console.log(`[whatsapp] → ${msisdn} via whatsapp-web.js: "${summary}"`);
    const response = await client.sendMessage(chatId, tpl.body);
    console.log(`[whatsapp] sent ok → ${msisdn} (id: ${response.id._serialized})`);
    return { success: true, messageId: response.id._serialized, raw: response };
  } catch (err) {
    console.error(`[whatsapp] send failed → ${msisdn}:`, err.message);
    return { success: false, error: err.message, details: err };
  }
}

module.exports = { sendWhatsAppMessage, isConfigured, normalizeMsisdn };
