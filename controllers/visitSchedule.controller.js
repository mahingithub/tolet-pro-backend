'use strict';

const VisitSchedule = require('../models/VisitSchedule');
const Inquiry = require('../models/Inquiry');
const inquiryHelper = require('../services/inquiry.helper');
// Route visit notifications through the shared service so they (a) use a valid
// notification type, (b) carry data.targetId for deep-linking to the inquiry,
// and (c) fan out over socket + push like every other notification. The old
// Notification.create({ type: 'visit_scheduled', metadata }) calls failed the
// model's enum validation (and used `metadata` instead of `data`), so they
// threw — silently breaking visit scheduling.
const notifications = require('../services/notification.service');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Helper to get socket io safely
const getIo = (req) => req.app.get('io');

exports.createVisitSchedule = asyncH(async (req, res) => {
  const { inquiryId, scheduledDate, scheduledTime, location } = req.body;
  const inquiry = await Inquiry.findById(inquiryId);
  
  if (!inquiry || String(inquiry.propertyOwnerId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }

  const schedule = await VisitSchedule.create({
    inquiryId,
    propertyId: inquiry.propertyId,
    landlordId: inquiry.propertyOwnerId,
    tenantId: inquiry.inquirerUserId,
    scheduledDate,
    scheduledTime,
    location,
    scheduledBy: req.user._id,
    status: 'confirmed',
  });
  
  // Also make sure inquiry is 'visit_scheduled' since visit is scheduled
  if (inquiry.status !== 'visit_scheduled') {
    await inquiryHelper.updateInquiryStatus(inquiryId, 'visit_scheduled', req.user._id);
  }

  const io = getIo(req);
  if (io) {
    io.to(String(inquiry.propertyOwnerId)).emit('visit:scheduled', { scheduleId: schedule._id });
    if (inquiry.inquirerUserId) {
      io.to(String(inquiry.inquirerUserId)).emit('visit:scheduled', { scheduleId: schedule._id });
    }
  }

  const notifMsg = `ভিজিট শিডিউল: ${new Date(scheduledDate).toLocaleDateString()} ${scheduledTime} — ${location || 'প্রপার্টি'}`;
  
  // Notify Tenant (recipient is the inquirer → their applications surface).
  if (inquiry.inquirerUserId) {
    await notifications.emit({
      userId: inquiry.inquirerUserId,
      type:  'inquiry_status',
      title: 'নতুন ভিজিট শিডিউল',
      body:  notifMsg,
      data:  { targetId: String(inquiryId), inquiryId: String(inquiryId), scheduleId: String(schedule._id) },
    });
  }

  res.status(201).json({ schedule: schedule.toJSON() });
});

exports.requestVisitSchedule = asyncH(async (req, res) => {
  const { inquiryId, requestedDate, requestedTime } = req.body;
  const inquiry = await Inquiry.findById(inquiryId);
  
  if (!inquiry || String(inquiry.inquirerUserId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }

  const schedule = await VisitSchedule.create({
    inquiryId,
    propertyId: inquiry.propertyId,
    landlordId: inquiry.propertyOwnerId,
    tenantId: inquiry.inquirerUserId,
    tenantRequest: {
      requestedDate,
      requestedTime,
      status: 'pending',
    },
    scheduledBy: req.user._id,
    status: 'pending',
  });

  res.status(201).json({ schedule: schedule.toJSON() });
});

exports.approveVisitRequest = asyncH(async (req, res) => {
  const schedule = await VisitSchedule.findById(req.params.id);
  if (!schedule || String(schedule.landlordId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }
  
  const { location } = req.body;
  
  schedule.status = 'confirmed';
  schedule.tenantRequest.status = 'approved';
  schedule.scheduledDate = schedule.tenantRequest.requestedDate;
  schedule.scheduledTime = schedule.tenantRequest.requestedTime;
  if (location) schedule.location = location;
  
  await schedule.save();

  // Also make sure inquiry is 'visit_scheduled' since visit is scheduled
  const inquiry = await Inquiry.findById(schedule.inquiryId);
  if (inquiry && inquiry.status !== 'visit_scheduled') {
    await inquiryHelper.updateInquiryStatus(schedule.inquiryId, 'visit_scheduled', req.user._id);
  }

  const io = getIo(req);
  if (io) {
    io.to(String(schedule.landlordId)).emit('visit:scheduled', { scheduleId: schedule._id });
    io.to(String(schedule.tenantId)).emit('visit:scheduled', { scheduleId: schedule._id });
  }

  const notifMsg = `ভিজিট শিডিউল: ${new Date(schedule.scheduledDate).toLocaleDateString()} ${schedule.scheduledTime} — ${schedule.location || 'প্রপার্টি'}`;
  await notifications.emit({
    userId: schedule.tenantId,
    type:  'inquiry_status',
    title: 'ভিজিট শিডিউল অনুমোদিত',
    body:  notifMsg,
    data:  { targetId: String(schedule.inquiryId), inquiryId: String(schedule.inquiryId), scheduleId: String(schedule._id) },
  });

  res.json({ schedule: schedule.toJSON() });
});

exports.completeVisit = asyncH(async (req, res) => {
  const schedule = await VisitSchedule.findById(req.params.id);
  if (!schedule || String(schedule.landlordId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }
  
  schedule.status = 'completed';
  await schedule.save();
  res.json({ schedule: schedule.toJSON() });
});

exports.cancelVisit = asyncH(async (req, res) => {
  const schedule = await VisitSchedule.findById(req.params.id);
  if (!schedule || (String(schedule.landlordId) !== String(req.user._id) && String(schedule.tenantId) !== String(req.user._id))) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }
  
  schedule.status = 'cancelled';
  await schedule.save();

  const io = getIo(req);
  if (io) {
    io.to(String(schedule.landlordId)).emit('visit:cancelled', { scheduleId: schedule._id });
    io.to(String(schedule.tenantId)).emit('visit:cancelled', { scheduleId: schedule._id });
  }

  const cancelDate = schedule.scheduledDate ? new Date(schedule.scheduledDate).toLocaleDateString() : 'আপনার';
  const msg = `${cancelDate} তারিখের ভিজিট বাতিল করা হয়েছে।`;

  // Notify the OTHER party. Landlord cancelled → tenant hears about it
  // (tenant surface); tenant cancelled → landlord hears about it (host inbox).
  const cancelledByLandlord = String(schedule.landlordId) === String(req.user._id);
  await notifications.emit({
    userId: cancelledByLandlord ? schedule.tenantId : schedule.landlordId,
    type:  cancelledByLandlord ? 'inquiry_status' : 'inquiry_new',
    title: 'ভিজিট বাতিল',
    body:  msg,
    data:  { targetId: String(schedule.inquiryId), inquiryId: String(schedule.inquiryId), scheduleId: String(schedule._id) },
  });

  res.json({ schedule: schedule.toJSON() });
});

exports.rescheduleVisit = asyncH(async (req, res) => {
  const schedule = await VisitSchedule.findById(req.params.id);
  if (!schedule || String(schedule.landlordId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }
  
  const { newDate, newTime, newLocation } = req.body;
  
  schedule.rescheduleHistory.push({
    previousDate: schedule.scheduledDate,
    previousTime: schedule.scheduledTime,
    changedBy: req.user._id,
  });
  
  schedule.scheduledDate = newDate;
  schedule.scheduledTime = newTime;
  if (newLocation) schedule.location = newLocation;
  
  await schedule.save();

  const io = getIo(req);
  if (io) {
    io.to(String(schedule.landlordId)).emit('visit:scheduled', { scheduleId: schedule._id }); // Use scheduled or rescheduled
    io.to(String(schedule.tenantId)).emit('visit:scheduled', { scheduleId: schedule._id });
  }

  const notifMsg = `ভিজিট পুনঃনির্ধারিত: ${new Date(newDate).toLocaleDateString()} ${newTime}`;
  await notifications.emit({
    userId: schedule.tenantId,
    type:  'inquiry_status',
    title: 'ভিজিট সময় পরিবর্তন',
    body:  notifMsg,
    data:  { targetId: String(schedule.inquiryId), inquiryId: String(schedule.inquiryId), scheduleId: String(schedule._id) },
  });

  res.json({ schedule: schedule.toJSON() });
});
