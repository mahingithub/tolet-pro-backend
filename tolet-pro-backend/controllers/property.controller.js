'use strict';

const propertyService = require('../services/property.service');
const propertyValidators = require('../validators/property.validators');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

exports.createProperty = asyncH(async (req, res) => {
  const doc = await propertyService.createProperty({ body: req.body, user: req.user });
  res.status(201).json({ property: doc.toJSON() });
});

exports.getProperties = asyncH(async (req, res) => {
  const parsed = propertyValidators.listQuery.safeParse(req.query);
  if (!parsed.success) {
    throw ApiError.badRequest('Query params সঠিক নয়।', {
      code: 'validation_error',
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'), message: i.message,
      })),
    });
  }
  const out = await propertyService.listProperties(parsed.data);
  res.json({
    properties: out.items.map((d) => d.toJSON()),
    total: out.total,
    page:  out.page,
    limit: out.limit,
  });
});

exports.getPropertyById = asyncH(async (req, res) => {
  const doc = await propertyService.getPropertyById(req.params.id);
  res.json({ property: doc.toJSON() });
});

exports.updateProperty = asyncH(async (req, res) => {
  const doc = await propertyService.updateProperty({
    idOrSlug: req.params.id,
    body: req.body,
    user: req.user,
  });
  res.json({ property: doc.toJSON() });
});

exports.deleteProperty = asyncH(async (req, res) => {
  const out = await propertyService.deleteProperty({
    idOrSlug: req.params.id,
    user: req.user,
  });
  res.json({ ok: true, ...out });
});

exports.getHostProperties = asyncH(async (req, res) => {
  const items = await propertyService.listMyProperties(req.user);
  res.json({ properties: items.map((d) => d.toJSON()) });
});
