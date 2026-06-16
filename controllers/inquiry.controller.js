'use strict';

const inquiryService = require('../services/inquiry.service');
const inquiryHelper  = require('../services/inquiry.helper');
const notifications  = require('../services/notification.service');
const Inquiry        = require('../models/Inquiry');
const { getIo, emitToUser } = require('../socket');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ─── Socket helper ──────────────────────────────────────────────────────────
// CRITICAL: sockets join the room `user:<id>` (see socket.js → roomFor). The
// old code emitted to `io.to(String(userId))` — a raw-id room nobody is in —
// so tenants never received realtime updates. emitToUser() targets the room
// correctly. Always route inquiry emits through here.
function notifySocket(userId, event, payload) {
  if (!userId) return;
  try {
    const io = getIo();
    if (io) emitToUser(io, String(userId), event, payload);
  } catch (err) {
    console.warn('[inquiry] socket emit failed:', err.message);
  }
}

// Serialize a visitSchedule subdoc into a plain socket-safe payload.
function plainVisit(vs) {
  if (!vs) return null;
  return {
    proposedBy: vs.proposedBy || '',
    date:       vs.date || '',
    time:       vs.time || '',
    location:   vs.location || '',
    status:     vs.status || 'none',
  };
}

function plainMessage(m) {
  if (!m) return null;
  return {
    sender:    m.sender,
    senderId:  m.senderId ? String(m.senderId) : null,
    text:      m.text,
    createdAt: m.createdAt,
  };
}

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
  // Keep the tenant's timeline in sync in realtime too.
  notifySocket(doc.inquirerUserId, 'inquiry:status_updated', {
    inquiryId: String(doc._id),
    status:    doc.status,
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

exports.acceptInquiry = asyncH(async (req, res) => {
  const inquiry = await Inquiry.findById(req.params.id);
  if (!inquiry || String(inquiry.propertyOwnerId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Unauthorized or not found' });
  }

  await inquiryHelper.updateInquiryStatus(req.params.id, 'accepted', req.user._id);

  notifySocket(inquiry.inquirerUserId, 'inquiry:status_updated', {
    inquiryId: String(inquiry._id),
    status:    'accepted',
  });

  if (inquiry.inquirerUserId) {
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

  notifySocket(inquiry.inquirerUserId, 'inquiry:status_updated', {
    inquiryId: String(inquiry._id),
    status:    'rejected',
  });

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

// ─── Reply: landlord (or tenant) appends a message to the inquiry thread ────
exports.replyInquiry = asyncH(async (req, res) => {
  const { inquiry, message, targetUserId } = await inquiryService.replyToInquiry({
    id: req.params.id,
    body: req.body,
    user: req.user,
  });

  notifySocket(targetUserId, 'inquiry:status_updated', {
    inquiryId: String(inquiry._id),
    status:    inquiry.status,
    message:   plainMessage(message),
  });

  res.json({ inquiry: inquiry.toJSON(), message: plainMessage(message) });
});

// ─── Propose a visit (either party) ─────────────────────────────────────────
exports.proposeVisit = asyncH(async (req, res) => {
  const { inquiry, targetUserId } = await inquiryService.proposeVisit({
    id: req.params.id,
    body: req.body,
    user: req.user,
  });

  notifySocket(targetUserId, 'inquiry:status_updated', {
    inquiryId:     String(inquiry._id),
    status:        inquiry.status,
    visitSchedule: plainVisit(inquiry.visitSchedule),
  });

  res.json({ inquiry: inquiry.toJSON() });
});

// ─── Accept / reject a pending visit (the OTHER party) ──────────────────────
exports.respondVisit = asyncH(async (req, res) => {
  const { inquiry, targetUserId } = await inquiryService.respondToVisit({
    id: req.params.id,
    body: req.body,
    user: req.user,
  });

  notifySocket(targetUserId, 'inquiry:status_updated', {
    inquiryId:     String(inquiry._id),
    status:        inquiry.status,
    visitSchedule: plainVisit(inquiry.visitSchedule),
  });

  res.json({ inquiry: inquiry.toJSON() });
});