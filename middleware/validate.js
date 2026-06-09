'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Wraps a Zod schema as Express middleware. Replaces req.body with the
 * parsed/typed value on success, throws 400 with field details on failure.
 */
module.exports = function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      // Use the first issue's message as the top-level user-facing error
      const top = details[0]?.message || 'ইনপুট সঠিক নয়।';
      return next(ApiError.badRequest(top, { code: 'validation_error', details }));
    }
    req.body = result.data;
    next();
  };
};
