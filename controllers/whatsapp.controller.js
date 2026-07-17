'use strict';

/**
 * whatsapp.controller.js
 * ──────────────────────────────────────────────────────────────────────────
 * Inbound WhatsApp webhook (Meta WhatsApp Business Cloud API).
 *
 *   GET  /api/whatsapp/webhook  → one-time verification handshake. Meta calls
 *        this when you press "Verify and save" in the App Dashboard. We echo
 *        back hub.challenge ONLY IF hub.verify_token equals the configured
 *        WHATSAPP_VERIFY_TOKEN. This is what makes the dashboard turn green.
 *
 *   POST /api/whatsapp/webhook  → live events (incoming user messages + our
 *        outgoing messages' delivery/read statuses). We verify the
 *        X-Hub-Signature-256 HMAC (when an app secret is configured), ACK with
 *        200 FAST — Meta retries on any non-2xx and disables the webhook after
 *        repeated failures — then process the payload.
 *
 * Tokens/secret live in config/env.js → whatsapp.verifyToken / whatsapp.appSecret.
 */

const crypto = require('crypto');
const env = require('../config/env');

const cfg = env.whatsapp || {};

// @desc    Webhook verification handshake
// @route   GET /api/whatsapp/webhook
// @access  Public (Meta calls this; guarded by the verify token)
exports.verifyWebhook = (req, res) => {
	const mode = req.query['hub.mode'];
	const token = req.query['hub.verify_token'];
	const challenge = req.query['hub.challenge'];

	if (!cfg.verifyToken) {
		console.error('[whatsapp:webhook] WHATSAPP_VERIFY_TOKEN is not set — cannot verify.');
		return res.sendStatus(500);
	}

	if (mode === 'subscribe' && token === cfg.verifyToken) {
		console.log('[whatsapp:webhook] verification handshake OK ✓');
		// Meta expects the raw challenge string echoed back with a 200.
		return res.status(200).send(challenge);
	}

	console.warn('[whatsapp:webhook] verification failed — mode/token mismatch.');
	return res.sendStatus(403);
};

// Verify Meta's X-Hub-Signature-256 over the RAW request body. Returns true
// when no app secret is configured (we can't verify, so we don't block) — the
// webhook still works before you add WHATSAPP_APP_SECRET, and becomes tamper-
// proof the moment you do.
function signatureValid(req) {
	if (!cfg.appSecret) return true; // not enforced until a secret is set
	const header = req.get('x-hub-signature-256') || '';
	const raw = req.rawBody;
	if (!header || !raw || !raw.length) return false;

	const expected =
		'sha256=' + crypto.createHmac('sha256', cfg.appSecret).update(raw).digest('hex');

	// Constant-time compare; timingSafeEqual throws if lengths differ.
	const a = Buffer.from(header);
	const b = Buffer.from(expected);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// @desc    Receive live WhatsApp events (incoming messages + delivery statuses)
// @route   POST /api/whatsapp/webhook
// @access  Public (Meta calls this; guarded by the signature when configured)
exports.receiveWebhook = (req, res) => {
	if (!signatureValid(req)) {
		console.warn('[whatsapp:webhook] rejected — bad X-Hub-Signature-256.');
		return res.sendStatus(401);
	}

	// ACK immediately so Meta never retries / disables the webhook. Any real
	// work happens after the response has been sent.
	res.sendStatus(200);

	try {
		const body = req.body || {};
		if (body.object !== 'whatsapp_business_account') return;

		for (const entry of body.entry || []) {
			for (const change of entry.changes || []) {
				const value = change.value || {};
				const contacts = value.contacts || [];

				// Incoming messages from users.
				for (const msg of value.messages || []) {
					const from = msg.from; // sender's WhatsApp number (msisdn)
					const name = contacts.find(Boolean)?.profile?.name || '';
					const text =
						msg.text?.body ||
						msg.button?.text ||
						msg.interactive?.list_reply?.title ||
						msg.interactive?.button_reply?.title ||
						`[${msg.type}]`;

					console.log(
						`[whatsapp:webhook] message from ${from} (${name || 'unknown'}): "${text}"`,
					);
					handleIncomingMessage({ from, name, text, type: msg.type, raw: msg }).catch((e) =>
						console.error('[whatsapp:webhook] handleIncomingMessage failed:', e.message),
					);
				}

				// Delivery / read status updates for messages WE sent.
				for (const status of value.statuses || []) {
					console.log(
						`[whatsapp:webhook] status "${status.status}" for message ${status.id} → ${status.recipient_id}`,
					);
				}
			}
		}
	} catch (err) {
		// We've already 200'd; just log so a malformed payload can't crash us.
		console.error('[whatsapp:webhook] error processing payload:', err.message);
	}
};

/**
 * EXTENSION POINT — decide what an inbound WhatsApp message should DO.
 *
 * Currently a no-op (the caller above already logs it), so nothing is sent
 * back and no WhatsApp send-costs are incurred until you choose a behaviour.
 * When ready, wire ONE of these in here:
 *   • Auto-reply with the AI assistant — reuse the Gemini logic from
 *     controllers/aiChatController.js, then send the reply via
 *     services/whatsapp.service.js → sendWhatsAppMessage(from, replyText).
 *   • Open/append a Help & Support ticket so a human can respond.
 *   • Persist the thread in a WhatsApp conversation collection.
 *
 * @param {{from:string, name:string, text:string, type:string, raw:object}} _message
 */
async function handleIncomingMessage(_message) {
	// no-op for now — see the options above.
}
