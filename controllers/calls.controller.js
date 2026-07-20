'use strict';

/**
 * calls.controller.js — REST endpoints for call history & state.
 *
 * The actual real-time signaling (OFFER, ANSWER, ICE_CANDIDATE) happens
 * over Socket.IO (see ../socket.js). These REST endpoints exist for:
 *   • Creating a Call record in Mongo when a call is initiated.
 *   • Querying call history.
 *   • Getting the current call state (used as a fallback if the socket
 *     disconnects and the user needs to reconnect to an active call).
 *
 * The media layer is now plain peer-to-peer WebRTC (see the frontend
 * callProvider.js). There is no third-party media token to issue anymore —
 * the browsers connect directly to each other using free public STUN servers,
 * and Socket.IO only relays the WebRTC handshake (offer/answer/ICE).
 *
 * Socket.IO handlers in socket.js will reference the Call model directly
 * for real-time state transitions (accept, reject, end, missed).
 */

const Call = require('../models/Call');
const ApiError = require('../utils/ApiError');
const { verifyCallActionToken } = require('../utils/callActionToken');
const { notifyCallRejected } = require('../socket');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * Handle a signed service-worker notification action.
 *
 * This route is intentionally unauthenticated because a service worker cannot
 * read the app's localStorage auth token while the PWA is closed. The token is
 * short-lived, HMAC-signed, scoped to one call + receiver, and currently only
 * permits declining a ringing call.
 */
exports.pushAction = asyncH(async (req, res) => {
  const action = String(req.body.action || '').toLowerCase();
  if (!['decline', 'reject'].includes(action)) {
    throw ApiError.badRequest('Unsupported call action.', { code: 'unsupported_call_action' });
  }

  let claims;
  try {
    claims = verifyCallActionToken(req.body.token);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired call action token.', {
      code: err.code || 'invalid_call_action_token',
    });
  }

  if (req.body.callId && String(req.body.callId) !== String(claims.callId)) {
    throw ApiError.badRequest('Call token mismatch.', { code: 'call_token_mismatch' });
  }

  const call = await Call.findById(claims.callId);
  if (!call) throw ApiError.notFound('Call not found');

  if (String(call.receiverId) !== String(claims.receiverId)) {
    throw ApiError.forbidden('Token is not valid for this receiver.', {
      code: 'call_token_receiver_mismatch',
    });
  }

  if (call.status !== 'ringing') {
    return res.json({ ok: true, callId: String(call._id), status: call.status });
  }

  call.status = 'rejected';
  call.endedAt = new Date();
  await call.save();

  notifyCallRejected(call);

  res.json({ ok: true, callId: String(call._id), status: 'rejected' });
});

/**
 * Initiate a new call.
 * Called by the caller just before emitting CALL_INITIATED via socket.
 * Returns the persisted Call document (with its generated roomId).
 */
exports.createCall = asyncH(async (req, res) => {
  const { receiverId, type } = req.body;

  if (!receiverId || !type) {
    throw ApiError.badRequest('Missing receiverId or type.');
  }
  if (!['voice', 'video'].includes(type)) {
    throw ApiError.badRequest('Type must be "voice" or "video".');
  }
  // You can't call yourself.
  if (String(receiverId) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot call yourself.', { code: 'self_call' });
  }

  // Prevent duplicate active calls between the same two users — in EITHER
  // direction. Without the second clause, A→B and B→A could both go active at
  // the same moment and create two conflicting calls.
  const existingActive = await Call.findOne({
    status: { $in: ['ringing', 'accepted'] },
    $or: [
      { callerId: req.user._id, receiverId },
      { callerId: receiverId, receiverId: req.user._id },
    ],
  });
  if (existingActive) {
    return res.json({ call: existingActive });
  }

  const call = await Call.create({
    callerId: req.user._id,
    receiverId,
    type,
    status: 'ringing',
  });

  res.status(201).json({ call });
});

/**
 * Get a specific call by ID.
 * Used for reconnection: if a socket drops mid-call, the client can
 * fetch the call state, check its roomId, and rejoin the media room.
 */
exports.getCall = asyncH(async (req, res) => {
  const call = await Call.findById(req.params.id)
    .populate('callerId', 'name avatar avatarUrl tenantProfile.avatar landlordProfile.avatar phone role')
    .populate('receiverId', 'name avatar avatarUrl tenantProfile.avatar landlordProfile.avatar phone role');

  if (!call) throw ApiError.notFound('Call not found');

  const userId = req.user._id.toString();
  if (call.callerId._id.toString() !== userId &&
      call.receiverId._id.toString() !== userId) {
    throw ApiError.forbidden('Not authorized to view this call');
  }

  res.json({ call });
});

/**
 * Get call history for the current user.
 * Returns both incoming and outgoing calls, sorted by most recent.
 */
exports.getCallHistory = asyncH(async (req, res) => {
  const userId = req.user._id;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const calls = await Call.find({
    $or: [{ callerId: userId }, { receiverId: userId }],
    // Phase Call-4: hide calls this user has soft-deleted from their history.
    deletedBy: { $ne: userId },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('callerId', 'name avatar avatarUrl tenantProfile.avatar landlordProfile.avatar role')
    .populate('receiverId', 'name avatar avatarUrl tenantProfile.avatar landlordProfile.avatar role')
    .lean();

  res.json({ calls });
});

/**
 * Get the user's current active call (if any).
 * Used on reconnect to resume a call that was in progress.
 */
exports.getActiveCall = asyncH(async (req, res) => {
  const userId = req.user._id;

  const call = await Call.findOne({
    $or: [{ callerId: userId }, { receiverId: userId }],
    status: { $in: ['ringing', 'accepted'] },
  })
    .populate('callerId', 'name avatar avatarUrl tenantProfile.avatar landlordProfile.avatar phone')
    .populate('receiverId', 'name avatar avatarUrl tenantProfile.avatar landlordProfile.avatar phone');

  res.json({ call: call || null });
});

/**
 * Mark the current user's missed incoming calls as "seen". (Phase Call-4)
 *
 * POST /api/calls/mark-seen
 *
 * Called when the user opens the Calls tab so the red missed-call badge
 * clears. Only touches calls where the user is the RECEIVER and the status
 * is 'missed' — those are the ones that drive the badge. Idempotent.
 */
exports.markSeen = asyncH(async (req, res) => {
  const userId = req.user._id;

  const result = await Call.updateMany(
    {
      receiverId: userId,
      status: 'missed',
      seenBy: { $ne: userId },
    },
    { $addToSet: { seenBy: userId } },
  );

  // mongoose returns modifiedCount (v6+) — fall back gracefully for older.
  const updated = result.modifiedCount ?? result.nModified ?? 0;
  res.json({ updated });
});

/**
 * Soft-delete a call from the current user's history. (Phase Call-4)
 *
 * DELETE /api/calls/:id
 *
 * This is a PER-USER delete: we add the requester to `deletedBy` rather than
 * removing the document, so the other participant still sees the call in their
 * own history. getCallHistory filters out calls where the user is in deletedBy.
 */
exports.deleteCall = asyncH(async (req, res) => {
  const call = await Call.findById(req.params.id);
  if (!call) throw ApiError.notFound('Call not found');

  const userId = req.user._id.toString();
  if (call.callerId.toString() !== userId &&
      call.receiverId.toString() !== userId) {
    throw ApiError.forbidden('Not authorized to delete this call');
  }

  await Call.updateOne(
    { _id: call._id },
    { $addToSet: { deletedBy: req.user._id } },
  );

  res.json({ deleted: true, id: String(call._id) });
});
