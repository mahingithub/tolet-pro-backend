/* eslint-disable no-console */
'use strict';

/**
 * scripts/test-chat-notification-flow.js
 * ──────────────────────────────────────────────────────────────────────────
 * Smoke test for Round 4 — polling chat + per-user notifications.
 *
 *  1. Seed tenant + landlord users, mint JWTs.
 *  2. Seed a property owned by the landlord.
 *  3. Tenant POST /api/inquiries → landlord should get inquiry_new notif.
 *  4. Landlord PATCH inquiry status → tenant should get inquiry_status notif.
 *  5. Tenant POST /api/conversations/open with landlord as peer.
 *  6. Tenant POST /api/conversations/:id/messages "Hi"  → landlord notif + unread = 1.
 *  7. GET /api/conversations as landlord — should show 1 unread, lastMessageText "Hi".
 *  8. Landlord GET /api/conversations/:id/messages?since=<future iso> → empty delta.
 *  9. Landlord GET /api/conversations/:id/messages → message visible.
 *  10. Landlord POST /api/conversations/:id/read → unread → 0.
 *  11. Tenant calls /notifications, marks one as read, checks unread count drops.
 *  12. Cleanup.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

const env          = require('../config/env');
const User         = require('../models/User');
const Property     = require('../models/Property');
const Inquiry      = require('../models/Inquiry');
const Conversation = require('../models/Conversation');
const Message      = require('../models/Message');
const Notification = require('../models/Notification');
const { signAccessToken } = require('../services/token.service');

const API = process.env.SMOKE_API || 'http://localhost:5000/api';

const TENANT_PHONE   = '+8801999000333';
const LANDLORD_PHONE = '+8801999000444';

const log = (label, data) => {
  console.log(`\n── ${label} ──`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ASSERT FAILED: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`✓ ${msg}`);
};

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}

async function upsertUser(phone, name, role) {
  const existing = await User.findOne({ phone });
  if (existing) return existing;
  return User.create({
    name,
    phone,
    password: 'NEVER_USED_smoke_test',
    role,
    roles: [role],
    phoneVerified: true,
  });
}

async function main() {
  console.log(`[smoke] API base = ${API}`);
  await mongoose.connect(env.mongoUri);
  console.log('[smoke] mongo connected');

  // 1. Seed users
  const tenant   = await upsertUser(TENANT_PHONE,   'Chat Tenant',   'tenant');
  const landlord = await upsertUser(LANDLORD_PHONE, 'Chat Landlord', 'landlord');

  const tenantToken   = signAccessToken(tenant);
  const landlordToken = signAccessToken(landlord);

  // Clean any stale records from a previous run.
  await Notification.deleteMany({ userId: { $in: [tenant._id, landlord._id] } });
  await Conversation.deleteMany({ participants: { $in: [tenant._id, landlord._id] } });
  await Message.deleteMany({ senderId: { $in: [tenant._id, landlord._id] } });
  await Inquiry.deleteMany({ inquirerUserId: tenant._id });

  // 2. Seed a property
  let property = await Property.findOne({ ownerUserId: landlord._id, title: 'Chat Smoke Apt' });
  if (!property) {
    property = await Property.create({
      title: 'Chat Smoke Apt',
      description: 'For chat-flow smoke testing only.',
      price: 22222,
      division: 'dhaka',
      location: 'Dhaka',
      address: 'Lane 9',
      ownerUserId: landlord._id,
      ownerName: landlord.name,
      ownerPhone: landlord.phone,
      status: 'active',
      type: 'apartment',
      beds: 1,
      baths: 1,
    });
  }

  // 3. Tenant POST inquiry → landlord notif
  const inqRes = await call('POST', '/inquiries', tenantToken, {
    propertyId: property._id.toString(),
    message:    'I would like to schedule a visit.',
  });
  assert(inqRes.status === 201, 'tenant inquiry created');
  const inquiryId = inqRes.data.inquiry.id;

  // Notification creation is fire-and-forget — give it a beat.
  await new Promise((r) => setTimeout(r, 200));
  let nNew = await Notification.find({ userId: landlord._id, type: 'inquiry_new' });
  assert(nNew.length === 1, 'landlord received inquiry_new notification');
  assert(nNew[0].data?.inquiryId === inquiryId, 'notif payload carries inquiryId');

  // 4. Landlord moves status → tenant notif
  const patchRes = await call('PATCH', `/inquiries/${inquiryId}/status`, landlordToken, { status: 'active' });
  assert(patchRes.status === 200, 'inquiry status patched');
  await new Promise((r) => setTimeout(r, 200));
  let nStat = await Notification.find({ userId: tenant._id, type: 'inquiry_status' });
  assert(nStat.length === 1, 'tenant received inquiry_status notification');
  assert(nStat[0].data?.status === 'active', 'notif carries new status');

  // 5. Open a conversation between tenant and landlord (tenant initiates).
  const openRes = await call('POST', '/conversations/open', tenantToken, {
    peerUserId: landlord._id.toString(),
    propertyId: property._id.toString(),
  });
  log('POST /conversations/open', openRes);
  assert(openRes.status === 201, 'conversation opened');
  const conversationId = openRes.data.conversation.id;
  assert(!!conversationId, 'conversation has id');

  // Idempotency: open again, should reuse the same id.
  const openAgain = await call('POST', '/conversations/open', tenantToken, {
    peerUserId: landlord._id.toString(),
    propertyId: property._id.toString(),
  });
  assert(openAgain.data.conversation.id === conversationId, 'reopen yields same conversation');

  // 6. Tenant sends a message
  const sendRes = await call('POST', `/conversations/${conversationId}/messages`, tenantToken, {
    text: 'Hi, is this still available?',
  });
  log('POST /conversations/:id/messages', sendRes);
  assert(sendRes.status === 201, 'message sent');

  // 7. Landlord sees it in conversation list with unread = 1
  await new Promise((r) => setTimeout(r, 150));
  const llListRes = await call('GET', '/conversations', landlordToken);
  log('GET /conversations (landlord)', llListRes);
  assert(llListRes.status === 200, 'landlord conv list ok');
  const llConv = llListRes.data.conversations.find((c) => c.id === conversationId);
  assert(!!llConv, 'landlord sees the conversation');
  assert(llConv.unread === 1, 'landlord unread === 1');
  assert(llConv.lastMessageText === 'Hi, is this still available?', 'landlord sees last message preview');

  // 8. Delta poll with `since` in the future → empty.
  const future = new Date(Date.now() + 60_000).toISOString();
  const deltaEmpty = await call('GET', `/conversations/${conversationId}/messages?since=${encodeURIComponent(future)}`, landlordToken);
  assert(deltaEmpty.status === 200, 'delta call ok');
  assert(deltaEmpty.data.messages.length === 0, 'future-since delta is empty');

  // 9. Landlord fetches messages
  const msgRes = await call('GET', `/conversations/${conversationId}/messages`, landlordToken);
  log('GET /conversations/:id/messages', msgRes);
  assert(msgRes.status === 200, 'landlord message list ok');
  assert(msgRes.data.messages.length === 1, 'one message present');

  // 10. Landlord marks read → unread → 0
  await call('POST', `/conversations/${conversationId}/read`, landlordToken);
  const llListRes2 = await call('GET', '/conversations', landlordToken);
  const llConv2 = llListRes2.data.conversations.find((c) => c.id === conversationId);
  assert(llConv2.unread === 0, 'landlord unread → 0 after read');

  // 11. Landlord replies → tenant gets message_new notif
  await call('POST', `/conversations/${conversationId}/messages`, landlordToken, { text: 'Yes, available.' });
  await new Promise((r) => setTimeout(r, 150));
  const nMsg = await Notification.find({ userId: tenant._id, type: 'message_new' });
  assert(nMsg.length === 1, 'tenant received message_new notification');

  // 12. Tenant lists notifications & marks one read.
  const notifList = await call('GET', '/notifications', tenantToken);
  log('GET /notifications (tenant)', notifList);
  assert(notifList.status === 200, 'notif list ok');
  assert(notifList.data.unread >= 2, 'tenant has at least 2 unread (status + msg)');

  const first = notifList.data.notifications[0];
  await call('POST', `/notifications/${first.id}/read`, tenantToken);
  const after = await call('GET', '/notifications/unread-count', tenantToken);
  assert(after.data.unread === notifList.data.unread - 1, 'unread count dropped by 1');

  // 13. Mark-all-read
  await call('POST', '/notifications/read-all', tenantToken);
  const final = await call('GET', '/notifications/unread-count', tenantToken);
  assert(final.data.unread === 0, 'all read after read-all');

  // Cleanup
  await Notification.deleteMany({ userId: { $in: [tenant._id, landlord._id] } });
  await Conversation.deleteMany({ _id: conversationId });
  await Message.deleteMany({ conversationId });
  await Inquiry.deleteMany({ inquirerUserId: tenant._id });
  await Property.deleteOne({ _id: property._id });
  await User.deleteMany({ phone: { $in: [TENANT_PHONE, LANDLORD_PHONE] } });
  console.log('\n[smoke] cleanup done');

  await mongoose.disconnect();
  console.log('\n✓ ALL CHAT/NOTIFICATION ASSERTIONS PASSED');
}

main().catch(async (err) => {
  console.error('\n✗ SMOKE FAILED:', err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
