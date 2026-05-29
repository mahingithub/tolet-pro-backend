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
 * Socket.IO handlers in socket.js will reference the Call model directly
 * for real-time state transitions (accept, reject, end, missed).
 */

const Call = require('../models/Call');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

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

  // Prevent duplicate active calls between the same two users.
  const existingActive = await Call.findOne({
    callerId: req.user._id,
    receiverId,
    status: { $in: ['ringing', 'accepted'] },
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
    .populate('callerId', 'name profilePicture phone')
    .populate('receiverId', 'name profilePicture phone');

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
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('callerId', 'name profilePicture')
    .populate('receiverId', 'name profilePicture')
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
    .populate('callerId', 'name profilePicture phone')
    .populate('receiverId', 'name profilePicture phone');

  res.json({ call: call || null });
});
