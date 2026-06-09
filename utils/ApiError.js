'use strict';

class ApiError extends Error {
  constructor(status, message, { code = null, details = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }

  static badRequest(message, opts) { return new ApiError(400, message, opts); }
  static unauthorized(message = 'অননুমোদিত অনুরোধ।', opts) { return new ApiError(401, message, opts); }
  static forbidden(message = 'অনুমতি নেই।', opts) { return new ApiError(403, message, opts); }
  static notFound(message = 'খুঁজে পাওয়া যায়নি।', opts) { return new ApiError(404, message, opts); }
  static conflict(message, opts) { return new ApiError(409, message, opts); }
  static tooMany(message = 'অনেক বেশি অনুরোধ। কিছুক্ষণ পর চেষ্টা করুন।', opts) { return new ApiError(429, message, opts); }
  static internal(message = 'সার্ভারে সমস্যা হয়েছে।', opts) { return new ApiError(500, message, opts); }
}

module.exports = ApiError;
