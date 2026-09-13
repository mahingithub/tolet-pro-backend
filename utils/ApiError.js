'use strict';

/**
 * The ONLY option keys that reach the client.
 *
 * middleware/errorHandler.js serialises `message`, `code` and `details` and
 * nothing else, so anything passed here under another name is dropped between
 * the throw and the response. Client-facing data belongs under `details`.
 */
const KNOWN_OPTIONS = ['code', 'details'];

class ApiError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    const { code = null, details = null } = options;
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    // A tripwire, not a rule. Every throw in this codebase that meant to send
    // an extra field spelled it as a sibling of `code` — `enforcementLevel`,
    // `blockedUntil`, `securityEvent` — and every one of them was accepted
    // without complaint and then silently discarded. Nothing failed, so nobody
    // looked.
    //
    // Deliberately a warning and NOT a throw: this constructor runs on the
    // error path, and turning a mis-spelled option into a second exception
    // would replace a degraded error response with a 500 — the code that is
    // already in trouble is the last place to add a new way to crash. Silent
    // in production for the same reason, and because by then the message has
    // no one left to reach.
    if (process.env.NODE_ENV !== 'production') {
      const unknown = Object.keys(options).filter((k) => !KNOWN_OPTIONS.includes(k));
      if (unknown.length) {
        console.warn(
          `[ApiError] dropped option${unknown.length > 1 ? 's' : ''} ` +
          `${unknown.join(', ')} on code=${code || '(none)'} — only ` +
          `${KNOWN_OPTIONS.join(' and ')} reach the client. ` +
          'Nest client-facing fields under `details`.'
        );
      }
    }
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
