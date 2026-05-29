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
