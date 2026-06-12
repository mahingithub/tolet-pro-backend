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

const Inquiry       = require('../models/Inquiry');
const Property      = require('../models/Property');
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
  return Inquiry.find({ inquirerUserId: user._id }).sort({ createdAt: -1, _id: -1 });
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
  if (String(doc.propertyOwnerId) !== String(user._id)) {
    throw ApiError.forbidden('শুধু মালিকই inquiry ডিলেট করতে পারবেন।', { code: 'not_owner' });
  }
  
  await Inquiry.deleteOne({ _id: id });
  
  // Optionally decrement property inquiries counter
  Property.updateOne({ _id: doc.propertyId }, { $inc: { inquiries: -1 } })
    .catch((err) => console.warn('[inquiry] counter decrement failed:', err.message));
    
  return { success: true };
}

module.exports = {
  createInquiry,
  listHostInquiries,
  listMyInquiries,
  updateInquiryStatus,
  deleteInquiry,
};
