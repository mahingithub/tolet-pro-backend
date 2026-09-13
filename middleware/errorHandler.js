'use strict';

const multer = require('multer');
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
  // multer rejects (size cap, unexpected field, too many parts) fire before
  // any controller runs, so nothing else gets a chance to shape them. Without
  // this branch they fell through to the generic 500 below and an oversized
  // avatar looked to the client like the server had crashed.
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      message: tooLarge
        ? 'ফাইলটি অনেক বড়। ছোট একটি ফাইল বেছে নিন।'
        : 'ফাইল আপলোড করা যায়নি।',
      code: err.code,
      ...(err.field ? { details: { field: err.field } } : {}),
    });
  }
  if (err instanceof ApiError) {
    // A 429 that already knows when the caller may come back should say so in
    // the header as well as the body. Same number, two audiences: the app
    // reads `details.retryAfterSeconds` to word its countdown, while proxies,
    // SDK retry helpers and curl only ever look at `Retry-After`.
    //
    // middleware/advancedRateLimiter.js sets this itself because it answers
    // without passing through here; this covers the 429s that are thrown —
    // services/otpQuota.service.js and services/otpAbuse.service.js.
    if (err.status === 429) {
      const secs = Number(err.details?.retryAfterSeconds);
      if (Number.isFinite(secs) && secs > 0) {
        res.setHeader('Retry-After', String(Math.ceil(secs)));
      }
    }
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
