'use strict';

const svc = require('../services/chat.service');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

exports.openConversation = asyncH(async (req, res) => {
  const convo = await svc.openConversation({ body: req.body, user: req.user });
  // Return through listConversations() shape for the single item so the
  // frontend can use the same row renderer.
  const all = await svc.listConversations({ user: req.user });
  const hydrated = all.find((c) => c.id === String(convo._id));
  res.status(201).json({ conversation: hydrated || { id: String(convo._id) } });
});

exports.listConversations = asyncH(async (req, res) => {
  const items = await svc.listConversations({ user: req.user });
  res.json({ conversations: items });
});

exports.listMessages = asyncH(async (req, res) => {
  const items = await svc.listMessages({
    id:    req.params.id,
    user:  req.user,
    since: req.query.since,
    limit: req.query.limit,
  });
  res.json({ messages: items.map((d) => d.toJSON()) });
});

exports.sendMessage = asyncH(async (req, res) => {
  const msg = await svc.sendMessage({
    id:   req.params.id,
    body: req.body,
    user: req.user,
  });
  res.status(201).json({ message: msg.toJSON() });
});

exports.markRead = asyncH(async (req, res) => {
  const r = await svc.markRead({ id: req.params.id, user: req.user });
  res.json(r);
});

// Send an image or voice message. The file arrives via multer (field 'file').
// The `kind` ('image' | 'audio') + optional caption/duration come from the
// multipart body.
exports.sendMedia = asyncH(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'কোনো ফাইল পাওয়া যায়নি।', code: 'no_file' });
  }
  const msg = await svc.sendMediaMessage({
    id:          req.params.id,
    user:        req.user,
    buffer:      req.file.buffer,
    mimetype:    req.file.mimetype,
    kind:        req.body.kind,
    filename:    req.body.filename || req.file.originalname,
    caption:     req.body.caption || '',
    durationSec: req.body.durationSec,
  });
  res.status(201).json({ message: msg.toJSON() });
});

exports.getMissedMessagesCount = asyncH(async (req, res) => {
  const result = await svc.getMissedMessagesCount({
    user: req.user,
    since: req.query.since,
  });
  res.json(result);
});
