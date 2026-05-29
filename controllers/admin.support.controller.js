'use strict';

/**
 * Admin Support Controller
 * ──────────────────────────────────────────────────────────────────────────
 * Handles admin-facing support ticket endpoints.
 */

const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/support/tickets
// ─────────────────────────────────────────────────────────────────────────────
exports.listAllTickets = asyncH(async (req, res) => {
  const { status, search } = req.query;
  const filter = {};
  
  if (status) filter.status = status;
  if (search) {
    const regex = new RegExp(search, 'i');
    filter.$or = [
      { subject: regex },
      { userName: regex },
      { userPhone: regex }
    ];
  }

  const tickets = await SupportTicket.find(filter)
    .sort({ updatedAt: -1 })
    .select('-messages -origin.aiTranscript');

  res.json({ tickets: tickets.map(t => t.toJSON()) });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/support/tickets/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getTicketWithContext = asyncH(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  // Fetch the user to build the context
  const user = await User.findById(ticket.userId);
  
  // Aggregate past tickets
  const pastTickets = await SupportTicket.find({ userId: ticket.userId }).select('status updatedAt');
  const openCount = pastTickets.filter(t => t.status === 'open' || t.status === 'pending_user').length;
  const resolvedCount = pastTickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;
  const lastActivityAt = pastTickets.length > 0 ? pastTickets.sort((a,b) => b.updatedAt - a.updatedAt)[0].updatedAt : ticket.updatedAt;

  const userContext = {
    userId: ticket.userId,
    name: ticket.userName,
    phone: ticket.userPhone,
    email: user ? user.email : '',
    trustScore: user ? user.trustScore : 0,
    kycVerified: user ? user.verificationStatus === 'verified' : false,
    openTicketCount: openCount,
    resolvedTicketCount: resolvedCount,
    lastActivityAt
  };

  const json = ticket.toJSON();
  const messages = json.messages || [];
  delete json.messages;

  res.json({ ticket: json, messages, userContext });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/support/tickets/:id/messages
// ─────────────────────────────────────────────────────────────────────────────
exports.sendAdminMessage = asyncH(async (req, res) => {
  const { text, markPendingUser } = req.body;
  if (!text) throw ApiError.badRequest('Text is required.');

  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  ticket.messages.push({
    author: 'admin',
    authorId: req.user._id,
    authorName: req.user.name,
    text
  });

  if (markPendingUser) {
    ticket.status = 'pending_user';
  }
  
  if (!ticket.assignedAdminId) {
    ticket.assignedAdminId = req.user._id;
    ticket.assignedAdminName = req.user.name;
  }

  await ticket.save();

  const newMessage = ticket.messages[ticket.messages.length - 1];
  res.json({ message: newMessage.toJSON() });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/support/tickets/:id/assign
// ─────────────────────────────────────────────────────────────────────────────
exports.assignTicket = asyncH(async (req, res) => {
  const { adminId, adminName } = req.body;
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  ticket.assignedAdminId = adminId;
  ticket.assignedAdminName = adminName;
  await ticket.save();

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/support/tickets/:id/resolve
// ─────────────────────────────────────────────────────────────────────────────
exports.resolveTicket = asyncH(async (req, res) => {
  const { summary } = req.body;
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  ticket.status = 'resolved';
  ticket.resolvedAt = Date.now();
  if (summary) ticket.resolutionSummary = summary;
  
  await ticket.save();

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/support/tickets/:id/reopen
// ─────────────────────────────────────────────────────────────────────────────
exports.reopenTicket = asyncH(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  ticket.status = 'open';
  ticket.resolvedAt = undefined;
  ticket.resolutionSummary = undefined;
  
  await ticket.save();

  res.json({ ok: true });
});
