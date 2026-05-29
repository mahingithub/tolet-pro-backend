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

// userId → Set<socketId>
const userSockets = new Map();

// callId → TimeoutHandle (for missed-call detection)
const ringTimers = new Map();

/**
 * Look up all socket IDs for a given user.
 */
function getSocketsForUser(userId) {
  return userSockets.get(String(userId)) || new Set();
}

/**
 * Emit an event to ALL sockets belonging to a user.
 */
function emitToUser(io, userId, event, payload) {
  const sockets = getSocketsForUser(userId);
  for (const sid of sockets) {
    io.to(sid).emit(event, payload);
  }
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
    pingInterval: 10_000,   // 10s
    pingTimeout:  15_000,   // 15s
    // Allow polling as a fallback for restrictive networks.
    transports: ['websocket', 'polling'],
  });

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

    // Register socket in presence map.
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    console.log(`[socket] user ${userId} connected (${socket.id})`);

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

        ringTimers.set(callId, timer);
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
        const timer = ringTimers.get(callId);
        if (timer) {
          clearTimeout(timer);
          ringTimers.delete(callId);
        }

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
        const timer = ringTimers.get(callId);
        if (timer) {
          clearTimeout(timer);
          ringTimers.delete(callId);
        }

        // Notify the caller.
        emitToUser(io, call.callerId.toString(), 'CALL_REJECTED', { callId });
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
        const timer = ringTimers.get(callId);
        if (timer) {
          clearTimeout(timer);
          ringTimers.delete(callId);
        }

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
    socket.on('disconnect', () => {
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);
        }
      }
      console.log(`[socket] user ${userId} disconnected (${socket.id})`);
    });
  });

  return io;
}

module.exports = { initSocket, getSocketsForUser, emitToUser };
