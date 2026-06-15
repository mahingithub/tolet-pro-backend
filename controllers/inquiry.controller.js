'use strict';

const inquiryService = require('../services/inquiry.service');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

exports.createInquiry = asyncH(async (req, res) => {
  const doc = await inquiryService.createInquiry({ body: req.body, user: req.user });
  res.status(201).json({ inquiry: doc.toJSON() });
});

exports.getHostInquiries = asyncH(async (req, res) => {
  const items = await inquiryService.listHostInquiries({
    user: req.user,
    status: req.query.status,
  });
  res.json({ inquiries: items });
});

exports.getMyInquiries = asyncH(async (req, res) => {
  const items = await inquiryService.listMyInquiries({ user: req.user });
  res.json({ inquiries: items });
});

exports.updateInquiryStatus = asyncH(async (req, res) => {
  const doc = await inquiryService.updateInquiryStatus({
    id: req.params.id,
    body: req.body,
    user: req.user,
  });
  res.json({ inquiry: doc.toJSON() });
});

exports.deleteInquiry = asyncH(async (req, res) => {
  await inquiryService.deleteInquiry({
    id: req.params.id,
    user: req.user,
  });
  res.json({ success: true });
});

const inquiryHelper = require('../services/inquiry.helper');
const notifications = require('../services/notification.service');
const Property = require('../models/Property');
const Inquiry = require('../models/Inquiry');
const Booking = require('../models/Booking');
// Assuming socket io can be imported like this, I will check if socket is available.
// If socket io is not easily importable from a file, we might have to use req.app.get('io')
// We will assume a hypothetical io getter or use req.app.get('io') inside the route.

exports.acceptInquiry = asyncH(async (req, res) => {
  const inquiry = await Inquiry.findById(req.params.id);
  if (!inquiry || String(inquiry.propertyOwnerId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }
  
  await inquiryHelper.updateInquiryStatus(req.params.id, 'accepted', req.user._id);
  
  // Agent 3 Notifications
  const io = req.app.get('io');
  if (io && inquiry.inquirerUserId) {
    io.to(String(inquiry.inquirerUserId)).emit('inquiry:status_updated', { inquiryId: inquiry._id, status: 'accepted' });
  }
  if (inquiry.inquirerUserId) {
    // Non-fatal + uses the shared notification service so the tenant also gets
    // an FCM push. type 'inquiry' + data.targetId match the rest of the app
    // (raw Notification.create with type:'inquiry_accepted'/metadata used to
    // THROW — that value isn't in the schema enum and `metadata` isn't a field).
    notifications.emit({
      userId: inquiry.inquirerUserId,
      type:   'inquiry',
      title:  'আপনার ইনকোয়ারি গ্রহণ করা হয়েছে! ভিজিট শিডিউল করুন।',
      body:   'Your inquiry has been accepted by the landlord.',
      data:   {
        targetId:   String(inquiry._id),
        propertyId: String(inquiry.propertyId),
        status:     'accepted',
      },
    });
  }

  res.json({ success: true, status: 'accepted' });
});

exports.rejectInquiry = asyncH(async (req, res) => {
  const inquiry = await Inquiry.findById(req.params.id);
  if (!inquiry || String(inquiry.propertyOwnerId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }
  
  await inquiryHelper.updateInquiryStatus(req.params.id, 'rejected', req.user._id);

  // Agent 3 Notifications
  const io = req.app.get('io');
  if (io && inquiry.inquirerUserId) {
    io.to(String(inquiry.inquirerUserId)).emit('inquiry:status_updated', { inquiryId: inquiry._id, status: 'rejected' });
  }
  if (inquiry.inquirerUserId) {
    notifications.emit({
      userId: inquiry.inquirerUserId,
      type:   'inquiry',
      title:  'দুঃখিত, আপনার ইনকোয়ারি প্রত্যাখ্যান করা হয়েছে',
      body:   'Your inquiry has been rejected by the landlord.',
      data:   {
        targetId:   String(inquiry._id),
        propertyId: String(inquiry.propertyId),
        status:     'rejected',
      },
    });
  }
  
  res.json({ success: true, status: 'rejected' });
});

exports.confirmDeal = asyncH(async (req, res) => {
  const inquiry = await Inquiry.findById(req.params.id);
  if (!inquiry || String(inquiry.propertyOwnerId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }
  
  // Update property
  const property = await Property.findById(inquiry.propertyId);
  if (property) {
    // `status` is what search/listing filters on (default query is status:'active'),
    // so flip it to 'rented' to actually remove the unit from public results.
    // `availabilityStatus` is the separate availability indicator. Set both.
    property.status = 'rented';
    property.availabilityStatus = 'rented';
    await property.save();
  }
  
  // Update inquiry
  await inquiryHelper.updateInquiryStatus(req.params.id, 'accepted', req.user._id);
  
  // Create Booking
  if (inquiry.inquirerUserId) {
    await Booking.create({
      propertyId: inquiry.propertyId,
      landlordId: inquiry.propertyOwnerId,
      tenantId: inquiry.inquirerUserId,
      inquiryId: inquiry._id,
      status: 'confirmed',
    });
  }

  // Agent 3 Notifications
  const io = req.app.get('io');
  if (io && inquiry.inquirerUserId) {
    io.to(String(inquiry.inquirerUserId)).emit('inquiry:status_updated', { inquiryId: inquiry._id, status: 'accepted' });
    io.to(String(inquiry.inquirerUserId)).emit('rent:updated', { propertyId: inquiry.propertyId });
  }
  if (inquiry.inquirerUserId) {
    notifications.emit({
      userId: inquiry.inquirerUserId,
      type:   'inquiry',
      title:  `অভিনন্দন! ${property ? property.title : 'প্রপার্টি'} এর ডিল নিশ্চিত হয়েছে`,
      body:   'Your deal has been confirmed.',
      data:   {
        targetId:   String(inquiry._id),
        propertyId: String(inquiry.propertyId),
        status:     'final_booking',
      },
    });
  }

  res.json({ success: true, status: 'accepted' });
});