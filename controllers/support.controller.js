'use strict';

/**
 * User Support Controller
 * ──────────────────────────────────────────────────────────────────────────
 * Handles user-facing support ticket endpoints.
 */

const SupportTicket = require('../models/SupportTicket');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const deriveSubject = (text) => {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 60) return trimmed || 'Support request';
  return trimmed.slice(0, 57) + '…';
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/support/tickets
// ─────────────────────────────────────────────────────────────────────────────
exports.openTicket = asyncH(async (req, res) => {
  const { initialMessage, aiTranscript } = req.body;
  if (!initialMessage) throw ApiError.badRequest('Message is required.');

  const seedMessages = [];
  if (aiTranscript && Array.isArray(aiTranscript)) {
    seedMessages.push({
      author: 'system',
      text: 'Conversation handed off from AI Assistant. Full transcript attached.'
    });
  } else {
    seedMessages.push({
      author: 'system',
      text: 'Ticket opened from Help Center.'
    });
  }

  seedMessages.push({
    author: 'user',
    authorId: req.user._id,
    authorName: req.user.name,
    text: initialMessage
  });

  const ticket = await SupportTicket.create({
    userId: req.user._id,
    userName: req.user.name,
    userPhone: req.user.phone,
    subject: deriveSubject(initialMessage),
    status: 'open',
    priority: 'normal',
    origin: {
      source: aiTranscript ? 'ai_widget' : 'help_center',
      aiTranscript: aiTranscript || [],
    },
    messages: seedMessages
  });

  res.status(201).json({ ticket: ticket.toJSON() });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/support/tickets
// ─────────────────────────────────────────────────────────────────────────────
exports.listMyTickets = asyncH(async (req, res) => {
  const tickets = await SupportTicket.find({ userId: req.user._id })
    .sort({ updatedAt: -1 })
    .select('-messages -origin.aiTranscript'); // Exclude heavy arrays for list view
  
  res.json({ tickets: tickets.map(t => t.toJSON()) });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/support/tickets/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getTicket = asyncH(async (req, res) => {
  const ticket = await SupportTicket.findOne({ _id: req.params.id, userId: req.user._id });
  if (!ticket) throw ApiError.notFound('Ticket not found.');
  
  // Format exactly like the mock expects
  const json = ticket.toJSON();
  const messages = json.messages || [];
  delete json.messages;

  res.json({ ticket: json, messages });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/support/tickets/:id/messages
// ─────────────────────────────────────────────────────────────────────────────
exports.sendMessage = asyncH(async (req, res) => {
  const { text } = req.body;
  if (!text) throw ApiError.badRequest('Text is required.');

  const ticket = await SupportTicket.findOne({ _id: req.params.id, userId: req.user._id });
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  ticket.messages.push({
    author: 'user',
    authorId: req.user._id,
    authorName: req.user.name,
    text
  });

  if (ticket.status === 'pending_user') {
    ticket.status = 'open';
  }

  await ticket.save();

  // Return the newly added message
  const newMessage = ticket.messages[ticket.messages.length - 1];
  res.json({ message: newMessage.toJSON() });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/support/tickets/:id/close
// ─────────────────────────────────────────────────────────────────────────────
exports.closeTicket = asyncH(async (req, res) => {
  const ticket = await SupportTicket.findOne({ _id: req.params.id, userId: req.user._id });
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  ticket.status = 'closed';
  await ticket.save();

  res.json({ ok: true });
});
