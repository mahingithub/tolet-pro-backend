'use strict';

/**
 * socket.js — Centralized Socket.IO signaling server for WebRTC calls.
 *
 * Handles the full call lifecycle:
 *   CALL_INITIATED   → Caller starts a call; receiver gets CALL_RINGING.
 *   CALL_ACCEPTED    → Receiver accepts; both sides begin WebRTC negotiation.
 *   CALL_REJECTED    → Receiver rejects; caller is notified.
 *   CALL_ENDED       → Either side hangs up.
 *   OFFER / ANSWER / ICE_CANDIDATE → WebRTC SDP/ICE relay.
 *
 * Authentication:
 *   Clients connect with `{ auth: { token: <JWT> } }`.
 *   The middleware verifies the JWT and maps userId → socketId for routing.
 *
 * User presence:
 *   We maintain a simple Map<userId, Set<socketId>> for multi-device support.
 *   When a call event targets a user, we emit to ALL their active sockets.
 *
 * Missed-call detection:
 *   When a call is initiated, we set a 30-second timeout. If the receiver
 *   hasn't answered by then, the call is marked as 'missed'.
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('./config/env');
const Call = require('./models/Call');
// Phase Call-6: push notifications when the receiver's app is closed.
const User = require('./models/User');
const fcm = require('./services/fcm.service');

// callId → TimeoutHandle (for missed-call detection)
const ringTimers = new Map();
let ioInstance = null;

/**
 * Room naming: every socket for a given user joins the room `user:<userId>`.
 *
 * Why rooms instead of tracking socket.id in a Map?
 *   On platforms like Render's free tier the WebSocket/long-poll connection
 *   drops and reconnects constantly, so a socket.id captured at call-start is
 *   stale seconds later — emitting to it silently goes nowhere (which is why
 *   "accept" and "hang up" never reached the other side). A room is keyed by
 *   userId, so no matter how many times the underlying socket reconnects with
 *   a new id, the NEW socket re-joins the same room and routing keeps working.
 *   Socket.IO also cleans membership up automatically on disconnect.
 */
function roomFor(userId) {
  return `user:${String(userId)}`;
}

/**
 * Emit an event to ALL of a user's sockets via their room. Reconnect-safe.
 */
function emitToUser(io, userId, event, payload) {
  io.to(roomFor(userId)).emit(event, payload);
}

function clearRingTimer(callId) {
  const timer = ringTimers.get(String(callId));
  if (!timer) return;
  clearTimeout(timer);
  ringTimers.delete(String(callId));
}

function notifyCallRejected(call) {
  if (!call) return;
  clearRingTimer(call._id || call.id);
  if (!ioInstance) return;
  const payload = {
    callId: String(call._id || call.id),
  };
  emitToUser(ioInstance, call.callerId.toString(), 'CALL_REJECTED', payload);
  emitToUser(ioInstance, call.receiverId.toString(), 'CALL_REJECTED', payload);
}

/**
 * Back-compat helper: report whether a user currently has any live socket.
 * Uses the adapter's room membership rather than a hand-maintained Map.
 */
function getSocketsForUser(io, userId) {
  const room = io.sockets.adapter.rooms.get(roomFor(userId));
  return room || new Set();
}

/**
 * Attach Socket.IO to an existing HTTP server.
 * Called once from server.js during boot.
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins,
      credentials: true,
    },
    // Optimize for Bangladesh mobile networks:
    // • Aggressive ping to detect drops quickly on 3G/4G.
    // • Reasonable timeout before declaring a disconnect.
    pingInterval: 25_000,   // 25s — too-frequent pings on a sleepy free dyno
    pingTimeout:  60_000,   // 60s — give flaky mobile + free-tier room to breathe
    // IMPORTANT (Render free tier): list polling FIRST. Render's proxy does not
    // hold a raw WebSocket reliably, so "websocket-first" makes every client
    // open WS → fail → fall back → retry WS → fail, in a loop. That loop is
    // exactly the connect/disconnect churn seen in the logs, and it's why call
    // signaling never completes. Start on polling (which always works through
    // the proxy); Socket.IO then quietly upgrades to WS only if it actually holds.
    transports: ['polling', 'websocket'],
    // If a socket blips out and reconnects within this window, Socket.IO
    // restores its session + missed packets instead of treating it as brand
    // new. Smooths over the brief drops common on free hosting + mobile.
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 min
      skipMiddlewares: false, // re-run auth on recovery
    },
  });
  ioInstance = io;

  // ─── Authentication middleware ──────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, env.jwtSecret, {
        audience: 'tolet-pro',
        issuer: 'tolet-pro-backend',
      });
      socket.userId = decoded.sub;
      socket.userPhone = decoded.phone;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  // ─── Connection handler ─────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.userId;

    // Join this user's room. Reconnect-safe: a new socket for the same user
    // re-joins the same room automatically, so call routing never breaks even
    // when the underlying connection churns (Render free tier / mobile).
    socket.join(roomFor(userId));

    if (socket.recovered) {
      console.log(`[socket] user ${userId} RECONNECTED+recovered (${socket.id})`);
    } else {
      console.log(`[socket] user ${userId} connected (${socket.id})`);
    }

    // ── CALL_INITIATED ────────────────────────────────────────────────────
    // Payload: { callId, receiverId, type, roomId, callerName, callerAvatar }
    socket.on('CALL_INITIATED', async (data) => {
      try {
        const { callId, receiverId, type, roomId, callerName, callerAvatar } = data;

        // Notify the receiver on all their devices.
        emitToUser(io, receiverId, 'CALL_RINGING', {
          callId,
          callerId: userId,
          callerName: callerName || 'Unknown',
          callerAvatar: callerAvatar || null,
          type,
          roomId,
        });

        // Phase Call-6: ALSO send a push notification so the receiver is
        // alerted even if their PWA is closed/backgrounded (socket only
        // reaches a live tab). Fire-and-forget — never blocks the ring, and
        // failures are swallowed inside the service. Dead tokens get pruned.
        (async () => {
          try {
            const receiver = await User.findById(receiverId)
              .select('deviceTokens preferences')
              .lean();
            if (!receiver) return;
            // Respect the user's toggle (defaults on).
            if (receiver.preferences && receiver.preferences.callNotifications === false) return;
            const tokens = (receiver.deviceTokens || []).map((d) => d.token).filter(Boolean);
            if (tokens.length === 0) return;

            const { invalidTokens } = await fcm.sendIncomingCall(tokens, {
              callId, callerId: userId, receiverId, callerName, callerAvatar, type, roomId,
            });
            // Prune any tokens FCM rejected as dead.
            if (invalidTokens && invalidTokens.length) {
              await User.updateOne(
                { _id: receiverId },
                { $pull: { deviceTokens: { token: { $in: invalidTokens } } } },
              );
            }
          } catch (err) {
            console.warn('[socket] FCM push on CALL_INITIATED failed:', err.message);
          }
        })();

        // Set a 30-second timeout for missed call detection.
        const timer = setTimeout(async () => {
          ringTimers.delete(callId);
          try {
            const call = await Call.findById(callId);
            if (call && call.status === 'ringing') {
              call.status = 'missed';
              call.endedAt = new Date();
              await call.save();

              // Notify both parties.
              emitToUser(io, userId, 'CALL_MISSED', { callId });
              emitToUser(io, receiverId, 'CALL_MISSED', { callId });
            }
          } catch (err) {
            console.error('[socket] missed-call timer error:', err.message);
          }
        }, 30_000);

        ringTimers.set(String(callId), timer);
      } catch (err) {
        console.error('[socket] CALL_INITIATED error:', err.message);
      }
    });

    // ── CALL_ACCEPTED ─────────────────────────────────────────────────────
    // Payload: { callId }
    socket.on('CALL_ACCEPTED', async (data) => {
      try {
        const { callId } = data;
        const call = await Call.findById(callId);
        if (!call || call.status !== 'ringing') return;

        call.status = 'accepted';
        call.startedAt = new Date();
        await call.save();

        // Clear the missed-call timer.
        clearRingTimer(callId);

        // Notify the caller that the receiver picked up.
        emitToUser(io, call.callerId.toString(), 'CALL_ACCEPTED', {
          callId,
          roomId: call.roomId,
        });

        // Confirm to receiver too (useful for multi-device dismiss).
        emitToUser(io, call.receiverId.toString(), 'CALL_ACCEPTED', {
          callId,
          roomId: call.roomId,
        });
      } catch (err) {
        console.error('[socket] CALL_ACCEPTED error:', err.message);
      }
    });

    // ── CALL_REJECTED ─────────────────────────────────────────────────────
    // Payload: { callId }
    socket.on('CALL_REJECTED', async (data) => {
      try {
        const { callId } = data;
        const call = await Call.findById(callId);
        if (!call || !['ringing'].includes(call.status)) return;

        call.status = 'rejected';
        call.endedAt = new Date();
        await call.save();

        // Clear the missed-call timer.
        // Notify the caller.
        notifyCallRejected(call);
      } catch (err) {
        console.error('[socket] CALL_REJECTED error:', err.message);
      }
    });

    // ── CALL_ENDED ────────────────────────────────────────────────────────
    // Either party can end the call. Payload: { callId }
    socket.on('CALL_ENDED', async (data) => {
      try {
        const { callId } = data;
        const call = await Call.findById(callId);
        if (!call || ['ended', 'missed', 'rejected'].includes(call.status)) return;

        call.status = 'ended';
        call.endedAt = new Date();
        await call.save();

        // Clear any lingering ring timer.
        clearRingTimer(callId);

        // Notify the other party.
        const peerId = call.callerId.toString() === userId
          ? call.receiverId.toString()
          : call.callerId.toString();
        emitToUser(io, peerId, 'CALL_ENDED', {
          callId,
          duration: call.duration,
        });
      } catch (err) {
        console.error('[socket] CALL_ENDED error:', err.message);
      }
    });

    // ── WebRTC Signaling Relay ────────────────────────────────────────────
    // These events just relay payloads between peers. No DB writes needed.

    socket.on('OFFER', (data) => {
      // data: { callId, targetUserId, sdp }
      emitToUser(io, data.targetUserId, 'OFFER', {
        callId: data.callId,
        sdp: data.sdp,
        fromUserId: userId,
      });
    });

    socket.on('ANSWER', (data) => {
      // data: { callId, targetUserId, sdp }
      emitToUser(io, data.targetUserId, 'ANSWER', {
        callId: data.callId,
        sdp: data.sdp,
        fromUserId: userId,
      });
    });

    socket.on('ICE_CANDIDATE', (data) => {
      // data: { callId, targetUserId, candidate }
      emitToUser(io, data.targetUserId, 'ICE_CANDIDATE', {
        callId: data.callId,
        candidate: data.candidate,
        fromUserId: userId,
      });
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      // No manual cleanup needed: Socket.IO removes the socket from its rooms
      // automatically. We keep this purely for observability.
      console.log(`[socket] user ${userId} disconnected (${socket.id}) — ${reason}`);
    });
  });

  return io;
}

module.exports = { initSocket, getSocketsForUser, emitToUser, notifyCallRejected, clearRingTimer };
