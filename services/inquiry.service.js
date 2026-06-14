'use strict';

/**
 * inquiry.service.js
 *
 * IMPORTANT: field names here MUST match `models/Inquiry.js`:
 *   - propertyId, propTitle
 *   - propertyOwnerId (required)
 *   - inquirerUserId, user, phone
 *   - msg
 *   - status ∈ {'new','active','archived','converted','rejected'}
 *
 * The `tenant.controller.js` privacy-unlock query relies on
 *   { inquirerUserId, propertyOwnerId, status ∈ ['new','active','converted'] }
 * so any deviation here breaks the tenant-profile phone/email unlock.
 */

const mongoose      = require('mongoose');
const Inquiry       = require('../models/Inquiry');
const Property      = require('../models/Property');
const Notification  = require('../models/Notification');
const ApiError      = require('../utils/ApiError');
const notifications = require('./notification.service');

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

  const doc = await Inquiry.create({
    propertyId:      property._id,
    propTitle:       property.title || '',
    propertyOwnerId: property.ownerUserId,
    inquirerUserId:  user._id,
    user:            user.name  || '',
    phone:           user.phone || '',
    msg:             body.message,
    leaseStart:      body.leaseStart || null,
    leaseEnd:        body.leaseEnd   || null,
    status:          'new',
  });

  // Lazy counter bump so the property card's "X inquiries" badge stays
  // accurate. Failure here is non-fatal; the inquiry still went through.
  Property.updateOne({ _id: property._id }, { $inc: { inquiries: 1 } })
    .catch((err) => console.warn('[inquiry] counter bump failed:', err.message));

  // Fire-and-forget notification to the landlord.
  notifications.emit({
    userId: property.ownerUserId,
    type:   'inquiry',
    title:  `New inquiry from ${user.name || 'a tenant'}`,
    body:   (body.message || '').slice(0, 140),
    data:   {
      targetId:    String(doc._id),
      peerId:      String(user._id),
      peerName:    user.name || '',
      peerAvatar:  user.avatar || '',
      propertyId:  String(property._id),
      propertyTitle: property.title || '',
    },
  });

  return doc;
}

async function listHostInquiries({ user, status }) {
  const filter = { propertyOwnerId: user._id };
  if (status) filter.status = status;
  return Inquiry.find(filter).sort({ createdAt: -1, _id: -1 });
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
    inquiries.map((i) => i.propertyId ? String(i.propertyId) : null).filter(Boolean),
  )].filter(id => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));

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
      id:            String(i._id),
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
      type:   'inquiry',
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
  // left tapping a bell item pointing at a now-deleted record. Inquiry
  // notifications carry the inquiry id as `data.targetId` (see createInquiry /
  // updateInquiryStatus above). Fire-and-forget — failure is non-fatal.
  Notification.deleteMany({ 'data.targetId': String(id) })
    .catch((err) => console.warn('[inquiry] notification cleanup failed:', err.message));

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
  deleteInquiry,
};
