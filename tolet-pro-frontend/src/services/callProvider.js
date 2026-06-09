/**
 * callProvider.js — WebRTC provider abstraction layer.
 *
 * Provides a unified interface for voice/video calls that can be backed by:
 *   1. ZegoCloud  (preferred — Bangladesh-optimized CDN, TURN, auto-reconnect)
 *   2. Agora
 *   3. Twilio
 *   4. Native WebRTC (fallback / development)
 *
 * The Socket.IO signaling layer (socket.js on the server) handles call
 * lifecycle events. This module handles the actual media — connecting
 * microphones, cameras, and rendering remote streams.
 *
 * ── Provider switch ────────────────────────────────────────────────────────
 *   Set VITE_CALL_PROVIDER=zegocloud to use ZegoCloud (production).
 *   Leave it unset (or =native) to use the built-in WebRTC path (dev/fallback).
 *
 * ── Public API (UNCHANGED across providers — ChatSystem relies on this) ─────
 *   connect, disconnect, getSocket
 *   initiateCall, acceptCall, rejectCall, endCall
 *   onRemoteStream, onLocalStream, onCallStateChange, onIncomingCall, onOutgoingCall
 *   toggleMute, toggleVideo, getLocalStream, cleanup
 *   PROVIDERS, ACTIVE_PROVIDER
 *
 *   Additive (no-op under native): onNetworkQuality, onReconnectStateChange, switchCamera
 *
 * Bangladesh mobile optimization notes:
 *   • Default resolution is 360p to conserve bandwidth on 3G/4G.
 *   • Audio-only fallback is enabled when video capture fails.
 *   • ZegoCloud routes through its Singapore data center with TURN relays,
 *     which fixes the symmetric-NAT failures common on BD mobile carriers.
 */

import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_BASE_URL
  ? import.meta.env.VITE_API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')
  : 'http://localhost:5000';

// ─── Provider configuration ─────────────────────────────────────────────────

const PROVIDERS = {
  ZEGO: 'zegocloud',
  AGORA: 'agora',
  TWILIO: 'twilio',
  NATIVE: 'native',
};

// Which provider to use. Defaults to NATIVE for development.
// Set VITE_CALL_PROVIDER=zegocloud in .env to switch.
const ACTIVE_PROVIDER = import.meta.env.VITE_CALL_PROVIDER || PROVIDERS.NATIVE;

const _isZego = () => ACTIVE_PROVIDER === PROVIDERS.ZEGO;

// ─── STUN/TURN servers optimized for Bangladesh (native path only) ──────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Add TURN servers here for production native use (essential for BD mobile
  // carriers which frequently use symmetric NAT):
  // { urls: 'turn:your-turn-server.com:3478', username: '...', credential: '...' },
];

// ─── Bangladesh bandwidth constraints ───────────────────────────────────────
const VIDEO_CONSTRAINTS_BD = {
  width:  { ideal: 640, max: 640 },
  height: { ideal: 360, max: 360 },
  frameRate: { ideal: 15, max: 24 },
};

const AUDIO_CONSTRAINTS_BD = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 16000,
};

// Zego createStream camera config for video calls (mirrors the BD profile).
const ZEGO_VIDEO_CAMERA = {
  audio: true,
  video: true,
  width: 640,
  height: 360,
  frameRate: 15,
  bitrate: 400, // kbps — conservative for 3G/4G
};

// ─── Reconnect configuration (native ICE-restart path) ──────────────────────
const RECONNECT = {
  initialDelayMs: 1000,
  maxDelayMs: 15000,
  maxAttempts: 5,
  backoffMultiplier: 2,
};

// ─── Internal state ─────────────────────────────────────────────────────────
let _socket = null;
let _localStream = null;
let _peerConnection = null;
const _onRemoteStreamCbs = new Set();
const _onLocalStreamCbs = new Set();
const _onCallStateCbs = new Set();
const _onIncomingCallCbs = new Set();
const _onOutgoingCallCbs = new Set();
let _currentCallId = null;
let _reconnectAttempt = 0;
let _reconnectTimer = null;

// Shared call context (used by both providers).
let _currentRoomId = null;
let _currentCallType = null;
let _currentPeerId = null;

// Additive callbacks (fire only under ZegoCloud; harmless no-ops otherwise).
const _onNetworkQualityCbs = new Set();
const _onReconnectStateCbs = new Set();

function _emit(cbs, ...args) {
  for (const cb of cbs) {
    try { cb(...args); } catch (err) { console.warn('[callProvider] listener failed:', err); }
  }
}

function _subscribe(cbs, cb) {
  if (typeof cb !== 'function') {
    cbs.clear();
    return () => {};
  }
  cbs.add(cb);
  return () => cbs.delete(cb);
}

// ── ZegoCloud-specific state ────────────────────────────────────────────────
let _zegoEngine = null;
let _zegoEventsBound = false;
let _zegoInRoom = false;
let _zegoLocalStreamId = null;
let _zegoRemoteStreamId = null;
let _zegoUserId = null;
let _camIndex = 0;

// ─── Socket.IO connection ───────────────────────────────────────────────────

function getSocket() {
  return _socket;
}

/**
 * Connect the Socket.IO client. Called once when the app boots (or the
 * user logs in). The token is pulled from localStorage by the caller.
 */
function connect(token) {
  if (_socket?.connected) return _socket;

  _socket = io(SOCKET_URL, {
    auth: { token },
    // Must mirror the server: polling FIRST. On Render's free tier a
    // websocket-first client loops (WS fail → poll → WS fail …), which shows
    // up as constant connect/disconnect churn and stops call signaling from
    // ever completing. Start on polling (always works through the proxy);
    // Socket.IO silently upgrades to WS only if the connection truly holds.
    transports: ['polling', 'websocket'],
    // Let Socket.IO keep retrying essentially forever — a free dyno can take
    // ~50s to wake from sleep, and we want the client still trying when it does
    // rather than giving up after 10 tries.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    // Wait long enough for a cold/sleeping server to answer the first handshake.
    timeout: 60000,
  });

  _socket.on('connect', () => {
    console.log('[callProvider] socket connected:', _socket.id);
    _reconnectAttempt = 0;
  });

  // On every (re)connection attempt, refresh the auth token from storage so a
  // socket that comes back AFTER the server's recovery window still
  // authenticates cleanly instead of being rejected as an unauthenticated
  // brand-new connection. Cheap, and prevents a whole class of "socket
  // reconnects but server doesn't know who it is" bugs on flaky hosting.
  _socket.io.on('reconnect_attempt', () => {
    const fresh = window.localStorage.getItem('auth:token');
    if (fresh) _socket.auth = { token: fresh };
  });

  _socket.on('disconnect', (reason) => {
    console.log('[callProvider] socket disconnected:', reason);
  });

  // ── Incoming call ─────────────────────────────────────────────────────
  _socket.on('CALL_RINGING', (data) => {
    console.log('[callProvider] incoming call:', data);
    _emit(_onIncomingCallCbs, data);
  });

  // ── Call accepted by receiver ─────────────────────────────────────────
  _socket.on('CALL_ACCEPTED', async (data) => {
    console.log('[callProvider] call accepted:', data);

    // ZegoCloud caller side: the receiver just picked up, so NOW we join the
    // room and start publishing. (The receiver already joined in acceptCall.)
    // Joining only on accept avoids burning ZegoCloud minutes while ringing.
    if (_isZego() && !_zegoInRoom) {
      if (data?.roomId) _currentRoomId = data.roomId; // authoritative from server
      try {
        await _zegoLoginAndPublish();
      } catch (err) {
        console.error('[callProvider] zego caller join failed:', err);
      }
    }

    _emit(_onCallStateCbs, 'accepted', data);
  });

  // ── Call rejected ─────────────────────────────────────────────────────
  _socket.on('CALL_REJECTED', (data) => {
    console.log('[callProvider] call rejected:', data);
    cleanup();
    _emit(_onCallStateCbs, 'rejected', data);
  });

  // ── Call ended ────────────────────────────────────────────────────────
  _socket.on('CALL_ENDED', (data) => {
    console.log('[callProvider] call ended:', data);
    cleanup();
    _emit(_onCallStateCbs, 'ended', data);
  });

  // ── Missed call ───────────────────────────────────────────────────────
  _socket.on('CALL_MISSED', (data) => {
    console.log('[callProvider] call missed:', data);
    cleanup();
    _emit(_onCallStateCbs, 'missed', data);
  });

  // ── WebRTC signaling relay (NATIVE provider only) ─────────────────────
  _socket.on('OFFER', async (data) => {
    if (ACTIVE_PROVIDER === PROVIDERS.NATIVE) {
      await handleRemoteOffer(data);
    }
  });

  _socket.on('ANSWER', async (data) => {
    if (ACTIVE_PROVIDER === PROVIDERS.NATIVE && _peerConnection) {
      try {
        await _peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } catch (err) {
        console.error('[callProvider] failed to set remote answer:', err);
      }
    }
  });

  _socket.on('ICE_CANDIDATE', async (data) => {
    if (ACTIVE_PROVIDER === PROVIDERS.NATIVE && _peerConnection) {
      try {
        await _peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('[callProvider] failed to add ICE candidate:', err);
      }
    }
  });

  return _socket;
}

function disconnect() {
  cleanup();
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

// ─── Native WebRTC helpers ──────────────────────────────────────────────────

async function getLocalStream(type) {
  const constraints = {
    audio: AUDIO_CONSTRAINTS_BD,
    video: type === 'video' ? VIDEO_CONSTRAINTS_BD : false,
  };
  try {
    _localStream = await navigator.mediaDevices.getUserMedia(constraints);
    _emit(_onLocalStreamCbs, _localStream, type);
    return _localStream;
  } catch (err) {
    console.error('[callProvider] getUserMedia failed:', err);
    // Fallback to audio-only if video fails (common on low-end BD phones).
    if (type === 'video') {
      console.warn('[callProvider] falling back to audio-only');
      _localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS_BD, video: false });
      _emit(_onLocalStreamCbs, _localStream, 'voice');
      return _localStream;
    }
    throw err;
  }
}

function createPeerConnection(targetUserId) {
  _peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Send local tracks to the peer.
  if (_localStream) {
    _localStream.getTracks().forEach((track) => {
      _peerConnection.addTrack(track, _localStream);
    });
  }

  // Receive remote tracks.
  _peerConnection.ontrack = (event) => {
    if (event.streams[0]) _emit(_onRemoteStreamCbs, event.streams[0]);
  };

  // Relay ICE candidates to the peer via Socket.IO.
  _peerConnection.onicecandidate = (event) => {
    if (event.candidate && _socket) {
      _socket.emit('ICE_CANDIDATE', {
        callId: _currentCallId,
        targetUserId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  // Reconnect handling for unstable networks.
  _peerConnection.oniceconnectionstatechange = () => {
    const state = _peerConnection?.iceConnectionState;
    console.log('[callProvider] ICE state:', state);

    if (state === 'disconnected' || state === 'failed') {
      attemptReconnect(targetUserId);
    }
    if (state === 'connected' || state === 'completed') {
      _reconnectAttempt = 0;
      if (_reconnectTimer) {
        clearTimeout(_reconnectTimer);
        _reconnectTimer = null;
      }
    }
  };

  return _peerConnection;
}

async function handleRemoteOffer(data) {
  if (!_peerConnection) return;
  try {
    await _peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await _peerConnection.createAnswer();
    await _peerConnection.setLocalDescription(answer);

    _socket.emit('ANSWER', {
      callId: data.callId,
      targetUserId: data.fromUserId,
      sdp: answer,
    });
  } catch (err) {
    console.error('[callProvider] handleRemoteOffer failed:', err);
  }
}

function attemptReconnect(targetUserId) {
  if (_reconnectAttempt >= RECONNECT.maxAttempts) {
    console.warn('[callProvider] max reconnect attempts reached');
    return;
  }

  const delay = Math.min(
    RECONNECT.initialDelayMs * Math.pow(RECONNECT.backoffMultiplier, _reconnectAttempt),
    RECONNECT.maxDelayMs,
  );

  console.log(`[callProvider] reconnecting in ${delay}ms (attempt ${_reconnectAttempt + 1}/${RECONNECT.maxAttempts})`);

  _reconnectTimer = setTimeout(async () => {
    _reconnectAttempt++;
    if (_peerConnection && _peerConnection.iceConnectionState !== 'connected') {
      try {
        // ICE restart.
        const offer = await _peerConnection.createOffer({ iceRestart: true });
        await _peerConnection.setLocalDescription(offer);

        _socket?.emit('OFFER', {
          callId: _currentCallId,
          targetUserId,
          sdp: offer,
        });
      } catch (err) {
        console.error('[callProvider] reconnect failed:', err);
        attemptReconnect(targetUserId);
      }
    }
  }, delay);
}

// ─── ZegoCloud helpers ──────────────────────────────────────────────────────

function _sanitizeStreamId(s) {
  // Zego stream IDs allow [A-Za-z0-9_-]; roomIds are usually hex/uuid (safe),
  // but sanitize defensively so a stray char never breaks publishing.
  return String(s).replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Lazily create the ZegoExpressEngine. The SDK is dynamically imported so the
 * native build never loads it. Engine-level event handlers are bound once.
 */
async function _initZego() {
  if (_zegoEngine) return _zegoEngine;

  const mod = await import('zego-express-engine-webrtc');
  const ZegoExpressEngine = mod.ZegoExpressEngine || (mod.default && mod.default.ZegoExpressEngine) || mod.default;

  const appID = Number(import.meta.env.VITE_ZEGO_APP_ID || 0);
  const server = import.meta.env.VITE_ZEGO_SERVER || '';
  if (!appID || !server) {
    throw new Error('ZegoCloud not configured: set VITE_ZEGO_APP_ID and VITE_ZEGO_SERVER');
  }

  _zegoEngine = new ZegoExpressEngine(appID, server);
  try { _zegoEngine.setLogConfig && _zegoEngine.setLogConfig({ logLevel: 'error', remoteLogLevel: 'disable' }); } catch (_) {}

  if (!_zegoEventsBound) {
    _bindZegoEvents(_zegoEngine);
    _zegoEventsBound = true;
  }
  return _zegoEngine;
}

function _bindZegoEvents(engine) {
  // Streams entering/leaving the room → play/stop remote media.
  engine.on('roomStreamUpdate', async (roomID, updateType, streamList) => {
    if (updateType === 'ADD') {
      for (const s of (streamList || [])) {
        if (s.streamID === _zegoLocalStreamId) continue; // never play our own
        try {
          const remoteStream = await engine.startPlayingStream(s.streamID, { audio: true, video: true });
          _zegoRemoteStreamId = s.streamID;
          if (remoteStream) _emit(_onRemoteStreamCbs, remoteStream);
        } catch (err) {
          console.error('[callProvider] zego startPlayingStream failed:', err);
        }
      }
    } else if (updateType === 'DELETE') {
      for (const s of (streamList || [])) {
        try { engine.stopPlayingStream(s.streamID); } catch (_) {}
        if (s.streamID === _zegoRemoteStreamId) _zegoRemoteStreamId = null;
      }
    }
  });

  // Room connection state → drives the "Reconnecting…" overlay.
  engine.on('roomStateUpdate', (roomID, state) => {
    if (state === 'CONNECTING') _emit(_onReconnectStateCbs, true);
    else if (state === 'CONNECTED') _emit(_onReconnectStateCbs, false);
    else if (state === 'DISCONNECTED') _emit(_onReconnectStateCbs, false);
  });

  // Network quality (fires ~every 2s). Local user reports with userID === ''
  // (or our own id). Level 0 = excellent … 4 = unusable. We surface the worse
  // of up/down so the indicator reflects perceived quality.
  engine.on('networkQuality', (userID, upstreamQuality, downstreamQuality) => {
    const isLocal = userID === '' || userID === _zegoUserId;
    if (!isLocal) return;
    const level = Math.max(Number(upstreamQuality), Number(downstreamQuality));
    _emit(_onNetworkQualityCbs, { level, upstreamQuality, downstreamQuality });
  });
}

/**
 * Fetch a short-lived, room-scoped ZegoCloud token from our backend.
 * Returns { token, appId, userId, userName, roomId, expiresIn }.
 */
async function _fetchZegoToken(roomId) {
  const token = window.localStorage.getItem('auth:token');
  const baseUrl = import.meta.env.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')
    : 'http://localhost:5000/api';

  const res = await fetch(`${baseUrl}/calls/zego-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ roomId }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `Failed to get call token (${res.status})`);
  }
  return res.json();
}

/**
 * Acquire the local media stream via Zego. Stored in _localStream so
 * ChatSystem's getLocalStream() poll renders the self-view, identical to native.
 */
async function _zegoCreateLocalStream(type) {
  const engine = await _initZego();
  const wantVideo = type === 'video';
  try {
    _localStream = await engine.createStream({
      camera: wantVideo ? { ...ZEGO_VIDEO_CAMERA } : { audio: true, video: false },
    });
    _emit(_onLocalStreamCbs, _localStream, type);
    return _localStream;
  } catch (err) {
    console.error('[callProvider] zego createStream failed:', err);
    if (wantVideo) {
      console.warn('[callProvider] falling back to audio-only (zego)');
      _localStream = await engine.createStream({ camera: { audio: true, video: false } });
      _emit(_onLocalStreamCbs, _localStream, 'voice');
      return _localStream;
    }
    throw err;
  }
}

/**
 * Log into the room (fetching a fresh token) and start publishing. Idempotent:
 * a second call while already in-room is a no-op. Used by the receiver in
 * acceptCall, and by the caller on CALL_ACCEPTED.
 */
async function _zegoLoginAndPublish() {
  if (_zegoInRoom) return;
  const engine = await _initZego();
  const roomId = _currentRoomId;
  if (!roomId) throw new Error('No roomId to join');

  const creds = await _fetchZegoToken(roomId);
  _zegoUserId = creds.userId;

  await engine.loginRoom(
    roomId,
    creds.token,
    { userID: creds.userId, userName: creds.userName || 'User' },
    { userUpdate: true },
  );
  _zegoInRoom = true;

  if (!_localStream) {
    await _zegoCreateLocalStream(_currentCallType || 'voice');
  }

  _zegoLocalStreamId = _sanitizeStreamId(`${roomId}_${creds.userId}`);
  engine.startPublishingStream(_zegoLocalStreamId, _localStream);
}

/**
 * Tear down the Zego room/streams. Called from cleanup() under Zego.
 * Runs BEFORE the generic track-stop so destroyStream still has the stream.
 */
function _zegoLeave() {
  const engine = _zegoEngine;
  if (!engine) return;
  try { if (_zegoLocalStreamId) engine.stopPublishingStream(_zegoLocalStreamId); } catch (_) {}
  try { if (_zegoRemoteStreamId) engine.stopPlayingStream(_zegoRemoteStreamId); } catch (_) {}
  try { if (_localStream && engine.destroyStream) engine.destroyStream(_localStream); } catch (_) {}
  try { if (_currentRoomId && _zegoInRoom) engine.logoutRoom(_currentRoomId); } catch (_) {}
  _zegoInRoom = false;
  _zegoLocalStreamId = null;
  _zegoRemoteStreamId = null;
  _zegoUserId = null;
}

// ─── Shared cleanup ─────────────────────────────────────────────────────────

function cleanup() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }

  // Zego-specific teardown first (uses _localStream before we stop its tracks).
  if (_isZego()) {
    _zegoLeave();
  }

  if (_localStream) {
    _localStream.getTracks().forEach((t) => t.stop());
    _localStream = null;
    _emit(_onLocalStreamCbs, null, null);
  }
  if (_peerConnection) {
    _peerConnection.close();
    _peerConnection = null;
  }
  _currentCallId = null;
  _currentRoomId = null;
  _currentCallType = null;
  _currentPeerId = null;
  _reconnectAttempt = 0;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initiate a call. Creates the Call record via REST, then emits
 * CALL_INITIATED via Socket.IO to ring the receiver.
 *
 * @param {Object} opts
 * @param {string} opts.receiverId   — Target user's Mongo ID.
 * @param {string} opts.type         — 'voice' or 'video'.
 * @param {string} opts.callerName   — Display name shown to receiver.
 * @param {string} opts.callerAvatar — Avatar URL shown to receiver.
 * @returns {Promise<Object>} The created Call document.
 */
async function initiateCall({ receiverId, type, callerName, callerAvatar }) {
  const token = window.localStorage.getItem('auth:token');
  const baseUrl = import.meta.env.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')
    : 'http://localhost:5000/api';

  // 1. Create the call record via REST.
  const res = await fetch(`${baseUrl}/calls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ receiverId, type }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create call');
  }

  const { call } = await res.json();
  _currentCallId = call.id;
  _currentRoomId = call.roomId;
  _currentCallType = type;
  _currentPeerId = receiverId;
  _emit(_onOutgoingCallCbs, {
    callId: call.id || call._id,
    receiverId,
    type,
    roomId: call.roomId,
  });

  // 2. Acquire local media stream.
  if (ACTIVE_PROVIDER === PROVIDERS.NATIVE) {
    await getLocalStream(type);
    createPeerConnection(receiverId);

    // Create the initial SDP offer.
    const offer = await _peerConnection.createOffer();
    await _peerConnection.setLocalDescription(offer);
  } else if (_isZego()) {
    // Acquire local media now so the caller sees their own preview while
    // ringing. We DON'T join the room / publish until the receiver accepts
    // (handled in the CALL_ACCEPTED socket listener) to avoid wasting minutes.
    try {
      await _zegoCreateLocalStream(type);
    } catch (err) {
      console.error('[callProvider] zego local stream (caller) failed:', err);
    }
  }

  // 3. Emit CALL_INITIATED via socket to ring the receiver.
  _socket?.emit('CALL_INITIATED', {
    callId: call.id,
    receiverId,
    type,
    roomId: call.roomId,
    callerName,
    callerAvatar,
  });

  return call;
}

/**
 * Accept an incoming call.
 */
async function acceptCall({ callId, callerId, type, roomId }) {
  _currentCallId = callId;
  _currentRoomId = roomId;
  _currentCallType = type;
  _currentPeerId = callerId;

  if (ACTIVE_PROVIDER === PROVIDERS.NATIVE) {
    await getLocalStream(type);
    createPeerConnection(callerId);
  } else if (_isZego()) {
    // Receiver joins & publishes immediately on accept; the caller joins when
    // it receives CALL_ACCEPTED. roomStreamUpdate then wires up both remotes.
    try {
      await _zegoCreateLocalStream(type);
      await _zegoLoginAndPublish();
    } catch (err) {
      console.error('[callProvider] zego accept/join failed:', err);
    }
  }

  // Emit acceptance via socket.
  _socket?.emit('CALL_ACCEPTED', { callId });
}

/**
 * Reject an incoming call.
 */
function rejectCall({ callId }) {
  _socket?.emit('CALL_REJECTED', { callId });
  cleanup();
}

/**
 * End an active call.
 */
function endCall({ callId }) {
  _socket?.emit('CALL_ENDED', { callId: callId || _currentCallId });
  cleanup();
}

// ─── Event listeners ────────────────────────────────────────────────────────

function onRemoteStream(cb) {
  return _subscribe(_onRemoteStreamCbs, cb);
}

function onLocalStream(cb) {
  return _subscribe(_onLocalStreamCbs, cb);
}

function onCallStateChange(cb) {
  return _subscribe(_onCallStateCbs, cb);
}

function onIncomingCall(cb) {
  return _subscribe(_onIncomingCallCbs, cb);
}

function onOutgoingCall(cb) {
  return _subscribe(_onOutgoingCallCbs, cb);
}

// Additive — used by the call overlay's quality indicator / reconnect banner.
// Under the native provider these simply never fire.
function onNetworkQuality(cb) {
  return _subscribe(_onNetworkQualityCbs, cb);
}

function onReconnectStateChange(cb) {
  return _subscribe(_onReconnectStateCbs, cb);
}

// ─── Media controls ─────────────────────────────────────────────────────────

function toggleMute() {
  if (!_localStream) return false;
  const audioTrack = _localStream.getAudioTracks()[0];
  if (!audioTrack) return false;

  audioTrack.enabled = !audioTrack.enabled;
  const isMuted = !audioTrack.enabled; // true if now muted

  // Also tell Zego to stop relaying the audio (belt-and-suspenders).
  if (_isZego() && _zegoEngine && _zegoLocalStreamId) {
    try { _zegoEngine.mutePublishStreamAudio(_zegoLocalStreamId, isMuted); } catch (_) {}
  }
  return isMuted;
}

function toggleVideo() {
  if (!_localStream) return false;
  const videoTrack = _localStream.getVideoTracks()[0];
  if (!videoTrack) return false;

  videoTrack.enabled = !videoTrack.enabled;
  const isOff = !videoTrack.enabled; // true if now off

  if (_isZego() && _zegoEngine && _zegoLocalStreamId) {
    try { _zegoEngine.mutePublishStreamVideo(_zegoLocalStreamId, isOff); } catch (_) {}
  }
  return isOff;
}

/**
 * Switch between front/back cameras (mobile). ZegoCloud only.
 * Returns true if it switched, false if not possible (e.g. one camera, native).
 */
async function switchCamera() {
  if (!_isZego() || !_zegoEngine || !_localStream) return false;
  try {
    const devices = await _zegoEngine.enumDevices();
    const cams = (devices && devices.cameras) || [];
    if (cams.length < 2) return false;
    _camIndex = (_camIndex + 1) % cams.length;
    await _zegoEngine.useVideoDevice(_localStream, cams[_camIndex].deviceID);
    return true;
  } catch (err) {
    console.warn('[callProvider] switchCamera failed:', err);
    return false;
  }
}

function getLocalStream$exposed() {
  return _localStream;
}

// ─── Export ─────────────────────────────────────────────────────────────────

const callProvider = {
  // Connection
  connect,
  disconnect,
  getSocket,

  // Call actions
  initiateCall,
  acceptCall,
  rejectCall,
  endCall,

  // Event handlers
  onRemoteStream,
  onLocalStream,
  onCallStateChange,
  onIncomingCall,
  onOutgoingCall,
  onNetworkQuality,        // additive
  onReconnectStateChange,  // additive

  // Media controls
  toggleMute,
  toggleVideo,
  switchCamera,            // additive (Zego)
  getLocalStream: getLocalStream$exposed,

  // Cleanup
  cleanup,

  // Constants
  PROVIDERS,
  ACTIVE_PROVIDER,
};

export default callProvider;
