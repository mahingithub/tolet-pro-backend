'use strict';

/**
 * inquiry.service.js
 *
 * IMPORTANT: field names here MUST match `models/Inquiry.js`.
 *
 * The live status vocabulary is the model enum:
 *   'sent' | 'delivered' | 'viewed' | 'accepted' | 'rejected'
 *   | 'visit_scheduled' | 'final_booking'
 *
 * (The older `new/active/converted` vocabulary referenced by the tenant
 * privacy-unlock query is stale — that query needs a separate follow-up so
 * the phone/email unlock keys off "an inquiry exists between these two
 * users" or the accepted/visit/booking statuses above.)
 *
 * RENTING-LIFECYCLE ADDITIONS:
 *   • createInquiry now APPENDS to an open thread instead of spawning a new
 *     row when the same tenant re-inquires on the same property.
 *   • replyToInquiry  — landlord (or tenant) appends a message to the thread.
 *   • proposeVisit    — either party proposes a visit slot.
 *   • respondToVisit  — the OTHER party accepts/rejects → blue tick on accept.
 */

const mongoose      = require('mongoose');
const Inquiry       = require('../models/Inquiry');
const Property      = require('../models/Property');
const Notification  = require('../models/Notification');
const ApiError      = require('../utils/ApiError');
const notifications = require('./notification.service');

const TERMINAL_STATUSES = ['rejected', 'final_booking'];

async function createInquiry({ body, user }) {
  const property = await Property.findById(body.propertyId);
  if (!property) {
    throw ApiError.notFound('প্রপার্টি পাওয়া যায়নি।', { code: 'property_not_found' });
  }
  if (String(property.ownerUserId) === String(user._id)) {
    throw ApiError.badRequest('আপনি নিজের প্রপার্টিতে inquiry পাঠাতে পারবেন না।', {
      code: 'self_inquiry',
    });
  }

  const text = String(body.message || '').trim();

  // ── Append-to-thread ──────────────────────────────────────────────────
  // If this tenant already has an OPEN inquiry on this property, push the
  // new message into it instead of creating another row (keeps the host
  // inbox clean). 'rejected' / 'final_booking' are terminal — a fresh ask
  // after those legitimately starts a new inquiry.
  const existing = await Inquiry.findOne({
    propertyId:     property._id,
    inquirerUserId: user._id,
    status:         { $nin: TERMINAL_STATUSES },
  }).sort({ createdAt: -1 });

  if (existing) {
    // Backfill dealType on threads created before this shipped so legacy
    // commercial inquiries also badge + branch correctly.
    if (!existing.dealType) {
      existing.dealType = property.intent === 'commercial' ? 'commercial' : 'residential';
    }
    if (text) {
      existing.messages.push({
        sender:    'tenant',
        senderId:  user._id,
        text:      text.slice(0, 2000),
        createdAt: new Date(),
      });
    }
    await existing.save();

    notifications.emit({
      userId: property.ownerUserId,
      // Recipient is the landlord (property owner) → host inbox surface.
      type:   'inquiry_new',
      title:  `${user.name || 'একজন ভাড়াটিয়া'} আবার মেসেজ পাঠিয়েছেন`,
      body:   text.slice(0, 140),
      data:   {
        targetId:      String(existing._id),
        peerId:        String(user._id),
        peerName:      user.name || '',
        peerAvatar:    user.avatar || '',
        propertyId:    String(property._id),
        propertyTitle: property.title || '',
      },
    });

    return existing;
  }

  // ── First inquiry on this property → create a fresh row + seed thread ──
  const doc = await Inquiry.create({
    propertyId:      property._id,
    propTitle:       property.title || '',
    propertyOwnerId: property.ownerUserId,
    inquirerUserId:  user._id,
    user:            user.name  || '',
    phone:           user.phone || '',
    // Commercial listings (intent==='commercial') get the distinct commercial
    // inquiry/booking flow; everything else is a residential rental.
    dealType:        property.intent === 'commercial' ? 'commercial' : 'residential',
    msg:             text,
    messages:        text
      ? [{ sender: 'tenant', senderId: user._id, text: text.slice(0, 2000), createdAt: new Date() }]
      : [],
    leaseStart:      body.leaseStart || null,
    leaseEnd:        body.leaseEnd   || null,
    status:          'sent',
  });

  // Lazy counter bump so the property card's "X inquiries" badge stays
  // accurate. Failure here is non-fatal; the inquiry still went through.
  Property.updateOne({ _id: property._id }, { $inc: { inquiries: 1 } })
    .catch((err) => console.warn('[inquiry] counter bump failed:', err.message));

  // Fire-and-forget notification to the landlord.
  notifications.emit({
    userId: property.ownerUserId,
    // Recipient is the landlord (property owner) → host inbox surface.
    type:   'inquiry_new',
    title:  `New inquiry from ${user.name || 'a tenant'}`,
    body:   text.slice(0, 140),
    data:   {
      targetId:      String(doc._id),
      peerId:        String(user._id),
      peerName:      user.name || '',
      peerAvatar:    user.avatar || '',
      propertyId:    String(property._id),
      propertyTitle: property.title || '',
    },
  });

  return doc;
}

async function listHostInquiries({ user, status }) {
  const filter = { propertyOwnerId: user._id };
  if (status) filter.status = status;
  const inquiries = await Inquiry.find(filter)
    .populate('inquirerUserId', 'avatar')
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  return inquiries.map((i) => {
    i.id = String(i._id);
    i.userAvatar = i.inquirerUserId?.avatar || '';
    if (i.inquirerUserId && i.inquirerUserId._id) {
      i.inquirerUserId = i.inquirerUserId._id;
    }
    delete i._id;
    return i;
  });
}

async function listMyInquiries({ user }) {
  const inquiries = await Inquiry.find({ inquirerUserId: user._id })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  if (inquiries.length === 0) return [];

  // Enrich each inquiry with light property card data (cover URL / location /
  // price) + the landlord's phone, so the tenant's inquiry cards aren't blank
  // and can show a "Call landlord" button. We use an aggregation so the
  // httpOnly $cond collapses any legacy base64 coverPhoto to '' INSIDE Mongo —
  // the base64 never loads into Node memory (same OOM-guard as property.service).
  const propertyIds = [...new Set(
    inquiries.map((i) => String(i.propertyId)).filter(Boolean),
  )].map((id) => new mongoose.Types.ObjectId(id));

  const props = propertyIds.length
    ? await Property.aggregate([
        { $match: { _id: { $in: propertyIds } } },
        {
          $project: {
            coverPhoto: {
              $cond: [
                { $regexMatch: { input: { $ifNull: ['$coverPhoto', ''] }, regex: /^https?:\/\//i } },
                '$coverPhoto',
                '',
              ],
            },
            location: 1, area: 1, district: 1, price: 1, ownerPhone: 1, ownerName: 1,
          },
        },
      ])
    : [];

  const propMap = {};
  props.forEach((p) => { propMap[String(p._id)] = p; });

  return inquiries.map((i) => {
    const p = propMap[String(i.propertyId)] || {};
    return {
      ...i,
      propCover:     p.coverPhoto || '',
      propLocation:  [p.location, p.area, p.district].filter(Boolean)[0] || '',
      propPrice:     p.price ?? null,
      landlordPhone: p.ownerPhone || '',
      landlordName:  p.ownerName  || '',
    };
  });
}

async function updateInquiryStatus({ id, body, user }) {
  const doc = await Inquiry.findById(id);
  if (!doc) throw ApiError.notFound('Inquiry পাওয়া যায়নি।', { code: 'inquiry_not_found' });
  if (String(doc.propertyOwnerId) !== String(user._id)) {
    throw ApiError.forbidden('শুধু মালিকই inquiry এর স্ট্যাটাস পরিবর্তন করতে পারবেন।', {
      code: 'not_owner',
    });
  }
  const prevStatus = doc.status;
  doc.status = body.status;
  await doc.save();

  // Fire-and-forget notification to the tenant who originally inquired.
  if (doc.inquirerUserId && body.status !== prevStatus) {
    notifications.emit({
      userId: doc.inquirerUserId,
      // Recipient is the tenant who inquired → their "applications" surface.
      type:   'inquiry_status',
      title:  `Your inquiry was marked ${body.status}`,
      body:   doc.propTitle ? `Re: ${doc.propTitle}` : '',
      data:   {
        targetId:      String(doc._id),
        peerId:        String(user._id),
        peerName:      user.name || '',
        peerAvatar:    user.avatar || '',
        propertyId:    String(doc.propertyId),
        propertyTitle: doc.propTitle,
        status:        body.status,
      },
    });
  }

  return doc;
}

// ─── Append a message to a thread (landlord "Reply" OR tenant follow-up) ────
async function replyToInquiry({ id, body, user }) {
  const inq = await Inquiry.findById(id);
  if (!inq) throw ApiError.notFound('Inquiry পাওয়া যায়নি।', { code: 'inquiry_not_found' });

  const isOwner    = String(inq.propertyOwnerId) === String(user._id);
  const isInquirer = String(inq.inquirerUserId)  === String(user._id);
  if (!isOwner && !isInquirer) {
    throw ApiError.forbidden('এই থ্রেডে রিপ্লাই করার অনুমতি নেই।', { code: 'not_allowed' });
  }

  const text = String(body.text || body.message || '').trim();
  if (!text) throw ApiError.badRequest('মেসেজ খালি রাখা যাবে না।', { code: 'empty_message' });

  const sender  = isOwner ? 'landlord' : 'tenant';
  const message = { sender, senderId: user._id, text: text.slice(0, 2000), createdAt: new Date() };
  inq.messages.push(message);

  // A landlord reply on a brand-new inquiry advances it past "Delivered".
  if (isOwner && ['sent', 'delivered'].includes(inq.status)) inq.status = 'viewed';
  await inq.save();

  const targetUserId = isOwner ? inq.inquirerUserId : inq.propertyOwnerId;
  if (targetUserId) {
    notifications.emit({
      userId: targetUserId,
      // Owner replying → tenant gets a status-style ping (tenant surface);
      // tenant replying → owner gets it on the host inbox surface.
      type:   isOwner ? 'inquiry_status' : 'inquiry_new',
      title:  isOwner
        ? 'ল্যান্ডলর্ড আপনার ইনকোয়ারিতে রিপ্লাই দিয়েছেন'
        : 'ভাড়াটিয়া একটি নতুন মেসেজ পাঠিয়েছেন',
      body:   text.slice(0, 140),
      data:   { targetId: String(inq._id), propertyId: String(inq.propertyId), status: inq.status },
    });
  }

  return { inquiry: inq, message, targetUserId };
}

// ─── Propose a visit slot (either party) ────────────────────────────────────
async function proposeVisit({ id, body, user }) {
  const inq = await Inquiry.findById(id);
  if (!inq) throw ApiError.notFound('Inquiry পাওয়া যায়নি।', { code: 'inquiry_not_found' });

  const isOwner    = String(inq.propertyOwnerId) === String(user._id);
  const isInquirer = String(inq.inquirerUserId)  === String(user._id);
  if (!isOwner && !isInquirer) {
    throw ApiError.forbidden('অনুমতি নেই।', { code: 'not_allowed' });
  }

  const date = String(body.date || body.scheduledDate || '').trim();
  const time = String(body.time || body.scheduledTime || '').trim();
  if (!date || !time) {
    throw ApiError.badRequest('ভিজিটের তারিখ ও সময় দিন।', { code: 'visit_datetime_required' });
  }

  inq.visitSchedule = {
    proposedBy: isOwner ? 'landlord' : 'tenant',
    date,
    time,
    location:   String(body.location || '').trim().slice(0, 200),
    status:     'pending',
    updatedAt:  new Date(),
  };
  await inq.save();

  const targetUserId = isOwner ? inq.inquirerUserId : inq.propertyOwnerId;
  if (targetUserId) {
    notifications.emit({
      userId: targetUserId,
      // Recipient is whichever party did NOT propose the slot.
      type:   isOwner ? 'inquiry_status' : 'inquiry_new',
      title:  'একটি ভিজিট প্রস্তাব করা হয়েছে',
      body:   `${date} ${time}`.trim(),
      data:   { targetId: String(inq._id), propertyId: String(inq.propertyId), status: inq.status },
    });
  }

  return { inquiry: inq, targetUserId };
}

// ─── Accept / reject a pending visit (the party who did NOT propose) ────────
async function respondToVisit({ id, body, user }) {
  const inq = await Inquiry.findById(id);
  if (!inq) throw ApiError.notFound('Inquiry পাওয়া যায়নি।', { code: 'inquiry_not_found' });

  const isOwner    = String(inq.propertyOwnerId) === String(user._id);
  const isInquirer = String(inq.inquirerUserId)  === String(user._id);
  if (!isOwner && !isInquirer) {
    throw ApiError.forbidden('অনুমতি নেই।', { code: 'not_allowed' });
  }

  const vs = inq.visitSchedule;
  if (!vs || vs.status !== 'pending') {
    throw ApiError.badRequest('গ্রহণযোগ্য কোনো ভিজিট প্রস্তাব নেই।', { code: 'no_pending_visit' });
  }

  // Only the OTHER party may respond — you can't accept your own proposal.
  const mySide = isOwner ? 'landlord' : 'tenant';
  if (mySide === vs.proposedBy) {
    throw ApiError.badRequest('নিজের প্রস্তাব নিজে গ্রহণ করা যাবে না।', { code: 'cannot_self_accept' });
  }

  const accept = body.action === 'accept' || body.accept === true || body.status === 'accepted';
  inq.visitSchedule.status    = accept ? 'accepted' : 'rejected';
  inq.visitSchedule.updatedAt = new Date();
  if (accept) inq.status = 'visit_scheduled';
  await inq.save();

  const targetUserId = isOwner ? inq.inquirerUserId : inq.propertyOwnerId;
  if (targetUserId) {
    notifications.emit({
      userId: targetUserId,
      // Recipient is whichever party did NOT respond to the proposal.
      type:   isOwner ? 'inquiry_status' : 'inquiry_new',
      title:  accept ? 'ভিজিট গ্রহণ করা হয়েছে ✓' : 'ভিজিট প্রস্তাব প্রত্যাখ্যান করা হয়েছে',
      body:   inq.propTitle ? `Re: ${inq.propTitle}` : '',
      data:   { targetId: String(inq._id), propertyId: String(inq.propertyId), status: inq.status },
    });
  }

  return { inquiry: inq, targetUserId, accepted: accept };
}

async function deleteInquiry({ id, user }) {
  const doc = await Inquiry.findById(id);
  if (!doc) throw ApiError.notFound('Inquiry পাওয়া যায়নি।', { code: 'inquiry_not_found' });

  // Either party may remove the inquiry: the tenant who SENT it (withdraw from
  // their own dashboard) or the landlord who OWNS the property (clear it from
  // their inbox). Anyone else is forbidden.
  const isInquirer = String(doc.inquirerUserId)  === String(user._id);
  const isOwner    = String(doc.propertyOwnerId) === String(user._id);
  if (!isInquirer && !isOwner) {
    throw ApiError.forbidden('এই inquiry মুছার অনুমতি নেই।', { code: 'not_allowed' });
  }

  await Inquiry.deleteOne({ _id: id });

  // Clean up notifications that deep-link to THIS inquiry so neither party is
  // left tapping a bell item pointing at a now-deleted record. The codebase
  // emits inquiry notifications in TWO shapes: inquiry.service uses
  // `data.targetId` (stored as a string), while inquiry.controller's
  // accept/reject/deal use `metadata.inquiryId` (stored as an ObjectId). We
  // match both keys, in both string and ObjectId form, so nothing is missed.
  // Fire-and-forget — failure is non-fatal.
  const idStr = String(id);
  let idObj = null;
  try { idObj = new mongoose.Types.ObjectId(idStr); } catch { /* not a castable id */ }
  const idForms = idObj ? [idStr, idObj] : [idStr];
  Notification.deleteMany({
    $or: [
      { 'data.targetId':      { $in: idForms } },
      { 'data.inquiryId':     { $in: idForms } },
      { 'metadata.inquiryId': { $in: idForms } },
    ],
  }).catch((err) => console.warn('[inquiry] notification cleanup failed:', err.message));

  // We deliberately DO NOT delete the chat/conversation here: a conversation is
  // a property-level thread between the two users and can outlive any single
  // inquiry. Killing it on withdraw would make the landlord's chat vanish
  // unexpectedly. (Conversations are removed when the PROPERTY is deleted —
  // see property.service.deleteProperty.)

  // Keep the property's "X inquiries" badge accurate.
  Property.updateOne({ _id: doc.propertyId }, { $inc: { inquiries: -1 } })
    .catch((err) => console.warn('[inquiry] counter decrement failed:', err.message));

  return { success: true, id: String(id) };
}

module.exports = {
  createInquiry,
  listHostInquiries,
  listMyInquiries,
  updateInquiryStatus,
  replyToInquiry,
  proposeVisit,
  respondToVisit,
  deleteInquiry,
};