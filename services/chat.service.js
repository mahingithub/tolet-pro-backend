'use strict';

/**
 * chat.service.js
 *
 * Handles Conversation + Message creation/lookup for the polling-based
 * chat surface. The frontend polls /api/conversations every 15 s for the
 * sidebar list and /api/conversations/:id/messages?since=<iso> every 5 s
 * for the active thread.
 *
 * Auto-emits a `message_new` notification to the OTHER participant whenever
 * a message is created.
 */

const mongoose      = require('mongoose');
const Conversation  = require('../models/Conversation');
const Message       = require('../models/Message');
const User          = require('../models/User');
const Property      = require('../models/Property');
const ApiError      = require('../utils/ApiError');
const notifications = require('./notification.service');
const cloudinary    = require('./cloudinary.service');

const oid = (v) => new mongoose.Types.ObjectId(String(v));

function sortParticipants(a, b) {
  const sa = String(a); const sb = String(b);
  return sa < sb ? [oid(a), oid(b)] : [oid(b), oid(a)];
}

async function openConversation({ user, body }) {
  const { peerUserId, propertyId = null, inquiryId = null } = body || {};
  if (!peerUserId) throw ApiError.badRequest('peerUserId দরকার।', { code: 'peer_required' });
  if (String(peerUserId) === String(user._id)) {
    throw ApiError.badRequest('নিজের সাথে চ্যাট করা যায় না।', { code: 'self_chat' });
  }

  const peer = await User.findById(peerUserId).select('_id name');
  if (!peer) throw ApiError.notFound('User পাওয়া যায়নি।', { code: 'peer_not_found' });

  // Optional property scope — verifies it exists if provided.
  if (propertyId) {
    const p = await Property.findById(propertyId).select('_id');
    if (!p) throw ApiError.notFound('Property পাওয়া যায়নি।', { code: 'property_not_found' });
  }

  const participants = sortParticipants(user._id, peer._id);

  // Find existing thread first (scoped to property if provided).
  const filter = { participants };
  if (propertyId) filter.propertyId = oid(propertyId);
  else            filter.propertyId = null;

  let convo = await Conversation.findOne(filter);
  if (!convo) {
    convo = await Conversation.create({
      participants,
      propertyId: propertyId ? oid(propertyId) : null,
      inquiryId:  inquiryId  ? oid(inquiryId)  : null,
      unreadCounts: new Map([
        [String(user._id), 0],
        [String(peer._id), 0],
      ]),
    });
  }
  return convo;
}

async function listConversations({ user }) {
  const items = await Conversation.find({ participants: user._id })
    .sort({ lastMessageAt: -1, updatedAt: -1, _id: -1 })
    .lean();

  // Hydrate peer name/avatar for the sidebar without forcing the frontend
  // to do N round-trips. Keep it minimal — name + avatar + role.
  const peerIds = new Set();
  for (const c of items) {
    for (const pid of c.participants || []) {
      if (String(pid) !== String(user._id)) peerIds.add(String(pid));
    }
  }
  const users = await User.find({ _id: { $in: [...peerIds] } })
    .select('_id name avatar avatarUrl tenantProfile.avatar landlordProfile.avatar roles')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  return items.map((c) => {
    const peerId = c.participants.find((p) => String(p) !== String(user._id));
    const peer   = userMap.get(String(peerId)) || null;
    const unread = (c.unreadCounts || {})[String(user._id)] || 0;
    return {
      id:              String(c._id),
      peerUserId:      String(peerId),
      peerName:        peer?.name || 'User',
      peerAvatar:      peer?.avatar || peer?.avatarUrl
                          || peer?.tenantProfile?.avatar
                          || peer?.landlordProfile?.avatar
                          || null,
      peerRoles:       peer?.roles || [],
      propertyId:      c.propertyId ? String(c.propertyId) : null,
      inquiryId:       c.inquiryId  ? String(c.inquiryId)  : null,
      lastMessageText: c.lastMessageText || '',
      lastMessageAt:   c.lastMessageAt,
      lastSenderId:    c.lastSenderId ? String(c.lastSenderId) : null,
      unread,
      createdAt:       c.createdAt,
      updatedAt:       c.updatedAt,
    };
  });
}

async function getConversationOr403({ id, user }) {
  const convo = await Conversation.findById(id);
  if (!convo) throw ApiError.notFound('Conversation পাওয়া যায়নি।', { code: 'convo_not_found' });
  if (!convo.participants.some((p) => String(p) === String(user._id))) {
    throw ApiError.forbidden('এই কথোপকথনে আপনার অ্যাক্সেস নেই।', { code: 'not_participant' });
  }
  return convo;
}

async function listMessages({ id, user, since, limit }) {
  await getConversationOr403({ id, user });
  const filter = { conversationId: oid(id) };
  if (since) {
    const d = new Date(since);
    if (!isNaN(d.getTime())) filter.createdAt = { $gt: d };
  }
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return Message.find(filter).sort({ createdAt: 1, _id: 1 }).limit(cap);
}

async function sendMessage({ id, body, user }) {
  const convo = await getConversationOr403({ id, user });
  const text  = (body?.text || '').trim();
  if (!text) throw ApiError.badRequest('Message ফাঁকা থাকতে পারে না।', { code: 'empty_message' });
  if (text.length > 4000) {
    throw ApiError.badRequest('Message অনেক বড় (>4000)।', { code: 'too_long' });
  }

  const msg = await Message.create({
    conversationId: convo._id,
    senderId:       user._id,
    text,
    readBy:         [user._id],
  });

  // Update conversation denormalised fields + bump unread for OTHER party.
  const peerId = convo.participants.find((p) => String(p) !== String(user._id));
  const peerKey = String(peerId);

  convo.lastMessageText = text.slice(0, 600);
  convo.lastMessageAt   = msg.createdAt;
  convo.lastSenderId    = user._id;
  convo.unreadCounts    = convo.unreadCounts || new Map();
  const prev            = convo.unreadCounts.get(peerKey) || 0;
  convo.unreadCounts.set(peerKey, prev + 1);
  convo.unreadCounts.set(String(user._id), 0);
  await convo.save();

  // Fire-and-forget notification to the peer.
  notifications.emit({
    userId: peerId,
    type:   'message_new',
    title:  user.name || 'New message',
    body:   text.slice(0, 140),
    data:   { conversationId: String(convo._id), messageId: String(msg._id) },
  }).catch(() => { /* already swallowed inside emit */ });

  return msg;
}

/**
 * Send an IMAGE or AUDIO message.
 * Uploads the buffer (from multer memoryStorage) to Cloudinary, then creates
 * a Message of the given type. Mirrors sendMessage's conversation bookkeeping
 * (last-message preview, unread bump, peer notification).
 *
 * @param {object}  args
 * @param {string}  args.id      conversation id
 * @param {object}  args.user    req.user
 * @param {Buffer}  args.buffer  file bytes (req.file.buffer)
 * @param {string}  args.mimetype
 * @param {string}  args.kind    'image' | 'audio'
 * @param {string=} args.caption optional text caption (image only, usually '')
 * @param {number=} args.durationSec optional voice length
 */
async function sendMediaMessage({ id, user, buffer, mimetype, kind, caption = '', durationSec = null }) {
  const convo = await getConversationOr403({ id, user });

  if (!buffer || !buffer.length) {
    throw ApiError.badRequest('কোনো ফাইল পাওয়া যায়নি।', { code: 'no_file' });
  }
  if (kind !== 'image' && kind !== 'audio') {
    throw ApiError.badRequest('অজানা মিডিয়া টাইপ।', { code: 'bad_kind' });
  }

  // Mime allow-list per kind.
  const okImage = /^image\/(jpe?g|png|webp|gif|heic|heif)$/i.test(mimetype || '');
  const okAudio = /^audio\/(webm|ogg|mpeg|mp3|mp4|m4a|aac|wav|x-m4a)$/i.test(mimetype || '');
  if (kind === 'image' && !okImage) {
    throw ApiError.badRequest('শুধু ছবি পাঠানো যাবে।', { code: 'bad_image_mime' });
  }
  if (kind === 'audio' && !okAudio) {
    throw ApiError.badRequest('শুধু অডিও পাঠানো যাবে।', { code: 'bad_audio_mime' });
  }

  // Hard size cap (5 MB) — multer lets 8 MB through so we can give a clean error.
  if (buffer.length > 5 * 1024 * 1024) {
    throw ApiError.badRequest('ফাইল অনেক বড় (সর্বোচ্চ ৫ MB)।', { code: 'too_large' });
  }

  // Cloudinary: images as 'image', audio as 'video' (Cloudinary stores audio
  // under the video resource type).
  const resourceType = kind === 'image' ? 'image' : 'video';
  const folder = `tolet-pro/chat/${String(convo._id)}`;

  let up;
  try {
    up = await cloudinary.uploadBuffer(buffer, { folder, resourceType });
  } catch (e) {
    if (e?.code === 'cloudinary_not_configured') throw e;
    throw ApiError.badRequest('আপলোড ব্যর্থ হয়েছে।', { code: 'upload_failed' });
  }

  const cap = (caption || '').trim().slice(0, 4000);

  const msg = await Message.create({
    conversationId: convo._id,
    senderId:       user._id,
    type:           kind,
    text:           cap,
    mediaUrl:       up.secureUrl,
    mediaPublicId:  up.publicId,
    mediaMeta: {
      durationSec: durationSec != null ? Number(durationSec) : null,
      bytes:       up.bytes || buffer.length,
      format:      up.format || null,
    },
    readBy: [user._id],
  });

  // Denormalised preview text shown in the sidebar.
  const preview = kind === 'image' ? '📷 Photo' : '🎤 Voice message';

  const peerId  = convo.participants.find((p) => String(p) !== String(user._id));
  const peerKey = String(peerId);
  convo.lastMessageText = cap ? `${preview}: ${cap}`.slice(0, 600) : preview;
  convo.lastMessageAt   = msg.createdAt;
  convo.lastSenderId    = user._id;
  convo.unreadCounts    = convo.unreadCounts || new Map();
  const prev            = convo.unreadCounts.get(peerKey) || 0;
  convo.unreadCounts.set(peerKey, prev + 1);
  convo.unreadCounts.set(String(user._id), 0);
  await convo.save();

  notifications.emit({
    userId: peerId,
    type:   'message_new',
    title:  user.name || 'New message',
    body:   preview,
    data:   { conversationId: String(convo._id), messageId: String(msg._id) },
  }).catch(() => {});

  return msg;
}

async function markRead({ id, user }) {
  const convo = await getConversationOr403({ id, user });
  // Zero my unread counter.
  convo.unreadCounts = convo.unreadCounts || new Map();
  convo.unreadCounts.set(String(user._id), 0);
  await convo.save();

  // Mark every message in this convo as read-by-me.
  await Message.updateMany(
    { conversationId: convo._id, readBy: { $ne: user._id } },
    { $addToSet: { readBy: user._id } },
  );
  return { ok: true };
}

module.exports = {
  openConversation,
  listConversations,
  listMessages,
  sendMessage,
  sendMediaMessage,
  markRead,
};
