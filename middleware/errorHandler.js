'use strict';

const ApiError = require('../utils/ApiError');
const env = require('../config/env');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  // Mongoose duplicate key (E11000)
  if (err && err.code === 11000) {
    return res.status(409).json({
      message: 'এই তথ্য আগে থেকেই রয়েছে।',
      code: 'duplicate_key',
      details: err.keyValue,
    });
  }
  // Mongoose validation error
  if (err && err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'ইনপুট সঠিক নয়।',
      code: 'mongoose_validation',
      details: Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message])),
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      message: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  // Unknown — log full details server-side, hide them from the client in prod.
  console.error('[unhandled]', err);
  res.status(500).json({
    message: 'সার্ভারে সমস্যা হয়েছে।',
    code: 'internal_error',
    ...(env.isProd ? {} : { details: err.message }),
  });
};
