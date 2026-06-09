/**
 * callProvider.js — WebRTC provider abstraction layer.
 *
 * Provides a unified interface for voice/video calls that can be backed by:
 *   1. ZegoCloud  (preferred — Bangladesh-optimized CDN)
 *   2. Agora
 *   3. Twilio
 *   4. Native WebRTC (fallback / development)
 *
 * The Socket.IO signaling layer (socket.js on the server) handles call
 * lifecycle events. This module handles the actual media — connecting
 * microphones, cameras, and rendering remote streams.
 *
 * Subscription model:
 *   onIncomingCall(cb), onCallStateChange(cb), onRemoteStream(cb), onOutgoingCall(cb)
 *   all return an unsubscribe function so multiple components can listen
 *   without overwriting each other.
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

const ACTIVE_PROVIDER = import.meta.env.VITE_CALL_PROVIDER || PROVIDERS.NATIVE;

// ─── STUN/TURN servers optimized for Bangladesh ─────────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
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
  // sampleRate removed — some browsers reject 16000 and fail getUserMedia entirely
};

// ─── Reconnect configuration ────────────────────────────────────────────────
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
let _currentCallId = null;
let _reconnectAttempt = 0;
let _reconnectTimer = null;

// Multi-subscriber sets — every component can listen without overwriting.
const _incomingCallCbs   = new Set();
const _callStateCbs      = new Set();
const _remoteStreamCbs   = new Set();
const _outgoingCallCbs   = new Set();
const _localStreamCbs    = new Set();

function _emit(cbSet, ...args) {
  cbSet.forEach((cb) => {
    try { cb(...args); } catch (e) { console.error('[callProvider] listener error:', e); }
  });
}

// ─── Socket.IO connection ───────────────────────────────────────────────────
function getSocket() {
  return _socket;
}

function isConnected() {
  return _socket?.connected === true;
}

/**
 * Connect the Socket.IO client. Idempotent — safe to call multiple times.
 * Called from App-level on login so socket persists across page navigation.
 */
function connect(token) {
  if (_socket?.connected) return _socket;
  if (_socket) {
    // Stale socket object — replace.
    try { _socket.disconnect(); } catch { /* ignore */ }
    _socket = null;
  }

  _socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 15000,
  });

  _socket.on('connect', () => {
    console.log('[callProvider] socket connected:', _socket.id);
    _reconnectAttempt = 0;
  });

  _socket.on('disconnect', (reason) => {
    console.log('[callProvider] socket disconnected:', reason);
  });

  // ── Incoming call ─────────────────────────────────────────────────────
  _socket.on('CALL_RINGING', (data) => {
    console.log('[callProvider] incoming call:', data);
    _emit(_incomingCallCbs, data);
  });

  // ── Call accepted by receiver ─────────────────────────────────────────
  _socket.on('CALL_ACCEPTED', (data) => {
    console.log('[callProvider] call accepted:', data);
    _emit(_callStateCbs, 'accepted', data);
  });

  // ── Call rejected ─────────────────────────────────────────────────────
  _socket.on('CALL_REJECTED', (data) => {
    console.log('[callProvider] call rejected:', data);
    cleanup();
    _emit(_callStateCbs, 'rejected', data);
  });

  // ── Call ended ────────────────────────────────────────────────────────
  _socket.on('CALL_ENDED', (data) => {
    console.log('[callProvider] call ended:', data);
    cleanup();
    _emit(_callStateCbs, 'ended', data);
  });

  // ── Missed call ───────────────────────────────────────────────────────
  _socket.on('CALL_MISSED', (data) => {
    console.log('[callProvider] call missed:', data);
    cleanup();
    _emit(_callStateCbs, 'missed', data);
  });

  // ── WebRTC signaling relay ────────────────────────────────────────────
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
    _emit(_localStreamCbs, _localStream, type);
    return _localStream;
  } catch (err) {
    console.error('[callProvider] getUserMedia failed:', err);
    if (type === 'video') {
      console.warn('[callProvider] falling back to audio-only');
      _localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS_BD, video: false });
      _emit(_localStreamCbs, _localStream, 'voice');
      return _localStream;
    }
    throw err;
  }
}

function createPeerConnection(targetUserId) {
  _peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  if (_localStream) {
    _localStream.getTracks().forEach((track) => {
      _peerConnection.addTrack(track, _localStream);
    });
  }

  _peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      _emit(_remoteStreamCbs, event.streams[0]);
    }
  };

  _peerConnection.onicecandidate = (event) => {
    if (event.candidate && _socket) {
      _socket.emit('ICE_CANDIDATE', {
        callId: _currentCallId,
        targetUserId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

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
  _reconnectTimer = setTimeout(async () => {
    _reconnectAttempt++;
    if (_peerConnection && _peerConnection.iceConnectionState !== 'connected') {
      try {
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

function cleanup() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_localStream) {
    _localStream.getTracks().forEach((t) => t.stop());
    _localStream = null;
  }
  if (_peerConnection) {
    _peerConnection.close();
    _peerConnection = null;
  }
  _currentCallId = null;
  _reconnectAttempt = 0;
}

// ─── Public API ─────────────────────────────────────────────────────────────

async function initiateCall({ receiverId, type, callerName, callerAvatar }) {
  const token = window.localStorage.getItem('auth:token');
  const baseUrl = import.meta.env.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')
    : 'http://localhost:5000/api';

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

  if (ACTIVE_PROVIDER === PROVIDERS.NATIVE) {
    await getLocalStream(type);
    createPeerConnection(receiverId);
    const offer = await _peerConnection.createOffer();
    await _peerConnection.setLocalDescription(offer);
  }

  _socket?.emit('CALL_INITIATED', {
    callId: call.id,
    receiverId,
    type,
    roomId: call.roomId,
    callerName,
    callerAvatar,
  });

  // Notify any local UI (GlobalCallUI) about the outgoing call.
  _emit(_outgoingCallCbs, {
    callId: call.id,
    receiverId,
    type,
    roomId: call.roomId,
    peerName: undefined,        // ChatSystem provides this via its own state
    peerAvatar: undefined,
  });

  return call;
}

async function acceptCall({ callId, callerId, type, roomId }) {
  _currentCallId = callId;
  if (ACTIVE_PROVIDER === PROVIDERS.NATIVE) {
    await getLocalStream(type);
    createPeerConnection(callerId);
    // Create offer for receiver→caller direction (some setups need this).
    // Skipping for now — caller's offer arrives via OFFER event and we answer.
  }
  _socket?.emit('CALL_ACCEPTED', { callId });
}

function rejectCall({ callId }) {
  _socket?.emit('CALL_REJECTED', { callId });
}

function endCall({ callId }) {
  _socket?.emit('CALL_ENDED', { callId: callId || _currentCallId });
  cleanup();
}

// ─── Event listeners (multi-subscriber, return unsub fn) ────────────────────

function onRemoteStream(cb) {
  _remoteStreamCbs.add(cb);
  return () => _remoteStreamCbs.delete(cb);
}

function onCallStateChange(cb) {
  _callStateCbs.add(cb);
  return () => _callStateCbs.delete(cb);
}

function onIncomingCall(cb) {
  _incomingCallCbs.add(cb);
  return () => _incomingCallCbs.delete(cb);
}

function onOutgoingCall(cb) {
  _outgoingCallCbs.add(cb);
  return () => _outgoingCallCbs.delete(cb);
}

function onLocalStream(cb) {
  _localStreamCbs.add(cb);
  return () => _localStreamCbs.delete(cb);
}

// ─── Media controls ─────────────────────────────────────────────────────────

function toggleMute() {
  if (!_localStream) return false;
  const audioTrack = _localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    return !audioTrack.enabled;
  }
  return false;
}

function toggleVideo() {
  if (!_localStream) return false;
  const videoTrack = _localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    return !videoTrack.enabled;
  }
  return false;
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
  isConnected,

  // Call actions
  initiateCall,
  acceptCall,
  rejectCall,
  endCall,

  // Event handlers (return unsubscribe fn)
  onRemoteStream,
  onCallStateChange,
  onIncomingCall,
  onOutgoingCall,
  onLocalStream,

  // Media controls
  toggleMute,
  toggleVideo,
  getLocalStream: getLocalStream$exposed,

  // Cleanup
  cleanup,

  // Constants
  PROVIDERS,
  ACTIVE_PROVIDER,
};

export default callProvider;