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
const Message = require('./models/Message');
const fcm = require('./services/fcm.service');

// callId → TimeoutHandle (for missed-call detection)
const ringTimers = new Map();
let ioInstance = null;

// ─── Presence ───────────────────────────────────────────────────────────────
// userId(string) → number of live sockets for that user. A user is "online"
// while this count is > 0. We keep a count (not a boolean) so multi-tab /
// multi-device users only flip to offline once their LAST socket drops.
const onlineUsers = new Map();

/** Is this user currently connected on at least one socket? */
function isUserOnline(userId) {
  return (onlineUsers.get(String(userId)) || 0) > 0;
}

/** Snapshot of all currently-online userIds (strings). */
function getOnlineUserIds() {
  return [...onlineUsers.keys()];
}

/**
 * Tell a user's conversation peers that their presence changed, so an open
 * chat header flips between "Active now" and "Last seen …" in real time.
 * Runs on the first connect and the last disconnect only.
 */
async function broadcastPresence(userId, online, lastSeenAt) {
  if (!ioInstance) return;
  try {
    const Conversation = require('./models/Conversation');
    const convos = await Conversation.find({ participants: userId })
      .select('participants')
      .lean();
    const peerIds = new Set();
    for (const c of convos) {
      for (const p of c.participants || []) {
        if (String(p) !== String(userId)) peerIds.add(String(p));
      }
    }
    const payload = {
      userId: String(userId),
      online: !!online,
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
    };
    for (const pid of peerIds) {
      emitToUser(ioInstance, pid, 'PRESENCE_UPDATE', payload);
    }
  } catch (err) {
    console.warn('[socket] broadcastPresence failed:', err.message);
  }
}

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
 * Load a call and authorize the acting user against it. This is the security
 * gate for every call lifecycle + signaling event: handlers must NOT trust
 * client-supplied caller / receiver / target ids.
 *
 *   role 'caller'      → user must be the call's caller (initiate).
 *   role 'receiver'    → user must be the call's receiver (accept / reject).
 *   role 'participant' → user must be caller OR receiver (end / signaling).
 *
 * Returns { call, callerId, receiverId, peerId } on success, or null if the
 * call is missing or the user isn't allowed to act on it (logged as a security
 * warning). A null return means the handler should silently ignore the event.
 */
async function authorizeCallEvent(userId, callId, role, eventName) {
  if (!callId) return null;
  let call;
  try {
    call = await Call.findById(callId);
  } catch {
    return null; // malformed id / cast error
  }
  if (!call) return null;

  const uid        = String(userId);
  const callerId   = String(call.callerId);
  const receiverId = String(call.receiverId);
  const isCaller   = uid === callerId;
  const isReceiver = uid === receiverId;

  const ok = role === 'caller'   ? isCaller
           : role === 'receiver' ? isReceiver
           : isCaller || isReceiver; // 'participant'

  if (!ok) {
    console.warn(
      `[socket][security] user ${uid} not authorized for ${eventName} on call ${callId}`,
    );
    return null;
  }

  return { call, callerId, receiverId, peerId: isCaller ? receiverId : callerId };
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

    // ── Presence: mark this user online (first socket → notify peers) ──────
    const prevCount = onlineUsers.get(String(userId)) || 0;
    onlineUsers.set(String(userId), prevCount + 1);
    if (prevCount === 0) {
      User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
      broadcastPresence(userId, true, null);
    }

    // Let the freshly-connected client learn who among its peers is online
    // right now (so the header doesn't wait for the next REST poll).
    (async () => {
      try {
        const Conversation = require('./models/Conversation');
        const convos = await Conversation.find({ participants: userId })
          .select('participants')
          .lean();
        const onlinePeers = [];
        for (const c of convos) {
          for (const p of c.participants || []) {
            if (String(p) !== String(userId) && isUserOnline(p)) onlinePeers.push(String(p));
          }
        }
        if (onlinePeers.length) {
          socket.emit('PRESENCE_SNAPSHOT', { online: [...new Set(onlinePeers)] });
        }
      } catch { /* non-fatal */ }
    })();

    if (socket.recovered) {
      console.log(`[socket] user ${userId} RECONNECTED+recovered (${socket.id})`);
    } else {
      console.log(`[socket] user ${userId} connected (${socket.id})`);
    }

    // ── CALL_INITIATED ────────────────────────────────────────────────────
    // Payload: { callId, receiverId, type, roomId, callerName, callerAvatar }
    socket.on('CALL_INITIATED', async (data) => {
      try {
        const { callId, callerName, callerAvatar } = data;

        // Authorize: only the real caller of THIS call may initiate it. The
        // receiver / type / roomId come from the DB record, never the client,
        // so a user can't ring arbitrary people or spoof someone else's call.
        const auth = await authorizeCallEvent(userId, callId, 'caller', 'CALL_INITIATED');
        if (!auth) return;
        const { call } = auth;
        if (call.status !== 'ringing') return;
        const receiverId = auth.receiverId;
        const type       = call.type;
        const roomId     = call.roomId;

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

              // Also notify closed/backgrounded PWAs. The socket event above
              // only reaches live tabs, so a user with their phone locked would
              // otherwise never see the missed-call notice until opening the app.
              try {
                const receiver = await User.findById(receiverId)
                  .select('deviceTokens preferences')
                  .lean();
                if (receiver && !(receiver.preferences && receiver.preferences.callNotifications === false)) {
                  const tokens = (receiver.deviceTokens || []).map((d) => d.token).filter(Boolean);
                  if (tokens.length) {
                    const { invalidTokens } = await fcm.sendMissedCall(tokens, {
                      callId,
                      callerId: userId,
                      receiverId,
                      callerName,
                      callerAvatar,
                      type,
                      roomId,
                    });
                    if (invalidTokens && invalidTokens.length) {
                      await User.updateOne(
                        { _id: receiverId },
                        { $pull: { deviceTokens: { token: { $in: invalidTokens } } } },
                      );
                    }
                  }
                }
              } catch (err) {
                console.warn('[socket] FCM push on CALL_MISSED failed:', err.message);
              }
            }
          } catch (err) {
            console.error('[socket] missed-call timer error:', err.message);
          }
        }, 45_000); // 45 second timeout for missed call

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
        // Only the receiver of this call may accept it.
        const auth = await authorizeCallEvent(userId, callId, 'receiver', 'CALL_ACCEPTED');
        if (!auth) return;
        const { call } = auth;
        if (call.status !== 'ringing') return;

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
        // A participant may reject/cancel a RINGING call: the receiver
        // declining, or the caller cancelling their own outgoing call. A
        // third party can never touch it. (Mid-call teardown uses CALL_ENDED.)
        const auth = await authorizeCallEvent(userId, callId, 'participant', 'CALL_REJECTED');
        if (!auth) return;
        const { call } = auth;
        if (call.status !== 'ringing') return;

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
        // Either participant (caller or receiver) may end the call.
        const auth = await authorizeCallEvent(userId, callId, 'participant', 'CALL_ENDED');
        if (!auth) return;
        const { call, peerId } = auth;
        if (['ended', 'missed', 'rejected'].includes(call.status)) return;

        call.status = 'ended';
        call.endedAt = new Date();
        await call.save();

        // Clear any lingering ring timer.
        clearRingTimer(callId);

        // Notify the other party.
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

    socket.on('OFFER', async (data) => {
      // data: { callId, sdp } — the target is derived from the call record,
      // NOT from the client, so signaling can't be injected into other calls.
      const auth = await authorizeCallEvent(userId, data?.callId, 'participant', 'OFFER');
      if (!auth) return;
      emitToUser(io, auth.peerId, 'OFFER', {
        callId: String(auth.call._id),
        sdp: data.sdp,
        fromUserId: userId,
      });
    });

    socket.on('ANSWER', async (data) => {
      // data: { callId, sdp } — target derived from the call, not the client.
      const auth = await authorizeCallEvent(userId, data?.callId, 'participant', 'ANSWER');
      if (!auth) return;
      emitToUser(io, auth.peerId, 'ANSWER', {
        callId: String(auth.call._id),
        sdp: data.sdp,
        fromUserId: userId,
      });
    });

    socket.on('ICE_CANDIDATE', async (data) => {
      // data: { callId, candidate } — target derived from the call, not client.
      const auth = await authorizeCallEvent(userId, data?.callId, 'participant', 'ICE_CANDIDATE');
      if (!auth) return;
      emitToUser(io, auth.peerId, 'ICE_CANDIDATE', {
        callId: String(auth.call._id),
        candidate: data.candidate,
        fromUserId: userId,
      });
    });

    // ── Chat Read Receipts & Typing Indicator ─────────────────────────────
    
    socket.on('MARK_SEEN', async ({ messageIds, senderId }) => {
      if (!messageIds || !messageIds.length || !senderId) return;
      try {
        await Message.updateMany(
          { _id: { $in: messageIds }, senderId },
          { $addToSet: { readBy: userId } }
        );
        emitToUser(io, senderId, 'MESSAGE_SEEN', { messageIds, readerId: userId });
      } catch (err) {
        console.error('[socket] MARK_SEEN error:', err.message);
      }
    });

    let typingTimer = null;
    socket.on('TYPING_START', ({ receiverId }) => {
      if (!receiverId) return;
      emitToUser(io, receiverId, 'USER_TYPING', { senderId: userId });
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        emitToUser(io, receiverId, 'USER_STOPPED_TYPING', { senderId: userId });
      }, 3000);
    });

    socket.on('TYPING_STOP', ({ receiverId }) => {
      if (!receiverId) return;
      if (typingTimer) clearTimeout(typingTimer);
      emitToUser(io, receiverId, 'USER_STOPPED_TYPING', { senderId: userId });
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`[socket] user ${userId} disconnected (${socket.id}) — ${reason}`);

      // ── Presence: last socket dropped → mark offline + stamp lastSeenAt ──
      const cnt = (onlineUsers.get(String(userId)) || 1) - 1;
      if (cnt <= 0) {
        onlineUsers.delete(String(userId));
        const seenAt = new Date();
        User.updateOne({ _id: userId }, { $set: { lastSeenAt: seenAt } }).catch(() => {});
        broadcastPresence(userId, false, seenAt);
      } else {
        onlineUsers.set(String(userId), cnt);
      }

      try {
        // If the CALLER drops off while the call is still RINGING, cancel it so
        // the receiver's phone stops ringing right away. We intentionally do
        // NOT touch already-'accepted' (live) calls here: on flaky mobile /
        // free-tier hosting the socket disconnects and reconnects constantly,
        // and ending a live call on every brief drop would cut people off mid-
        // conversation. Live calls are torn down explicitly via CALL_ENDED.
        const ringingCall = await Call.findOne({
          callerId: userId,
          status: 'ringing',
        });
        if (ringingCall) {
          ringingCall.status = 'ended';
          ringingCall.endedAt = new Date();
          await ringingCall.save();

          // NOTE: the Call id is `_id` (there is no `callId` field). Using the
          // wrong field here previously left the receiver ringing until the
          // 45s missed-call timer fired.
          clearRingTimer(ringingCall._id);

          emitToUser(io, ringingCall.receiverId, 'CALL_ENDED', {
            callId: String(ringingCall._id),
            reason: 'caller_disconnected',
          });
        }
      } catch (err) {
        console.error('[socket] disconnect call cleanup error:', err.message);
      }
    });
  });

  return io;
}

function getIo() { return ioInstance; }

module.exports = { initSocket, getIo, getSocketsForUser, emitToUser, notifyCallRejected, clearRingTimer, roomFor, isUserOnline, getOnlineUserIds };
