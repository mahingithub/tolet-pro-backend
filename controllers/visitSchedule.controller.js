'use strict';

const VisitSchedule = require('../models/VisitSchedule');
const Inquiry = require('../models/Inquiry');
const Notification = require('../models/Notification');
const inquiryHelper = require('../services/inquiry.helper');

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
  
  // Notify Tenant
  if (inquiry.inquirerUserId) {
    await Notification.create({
      userId: inquiry.inquirerUserId,
      title: 'নতুন ভিজিট শিডিউল',
      body: notifMsg,
      type: 'visit_scheduled',
      metadata: { inquiryId, scheduleId: schedule._id }
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
  await Notification.create({
    userId: schedule.tenantId,
    title: 'ভিজিট শিডিউল অনুমোদিত',
    body: notifMsg,
    type: 'visit_scheduled',
    metadata: { inquiryId: schedule.inquiryId, scheduleId: schedule._id }
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
  
  await Notification.create({
    userId: String(schedule.landlordId) === String(req.user._id) ? schedule.tenantId : schedule.landlordId,
    title: 'ভিজিট বাতিল',
    body: msg,
    type: 'visit_cancelled',
    metadata: { inquiryId: schedule.inquiryId, scheduleId: schedule._id }
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
  await Notification.create({
    userId: schedule.tenantId,
    title: 'ভিজিট সময় পরিবর্তন',
    body: notifMsg,
    type: 'visit_rescheduled',
    metadata: { inquiryId: schedule.inquiryId, scheduleId: schedule._id }
  });

  res.json({ schedule: schedule.toJSON() });
});
