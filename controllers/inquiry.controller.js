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
  res.json({ inquiries: items.map((d) => d.toJSON()) });
});

exports.getMyInquiries = asyncH(async (req, res) => {
  const items = await inquiryService.listMyInquiries({ user: req.user });
  res.json({ inquiries: items.map((d) => d.toJSON()) });
});

exports.updateInquiryStatus = asyncH(async (req, res) => {
  const doc = await inquiryService.updateInquiryStatus({
    id: req.params.id,
    body: req.body,
    user: req.user,
  });
  res.json({ inquiry: doc.toJSON() });
});
