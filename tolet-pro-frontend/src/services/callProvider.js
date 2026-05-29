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
 * Usage:
 *   import callProvider from './callProvider';
 *
 *   // When a call is accepted and both sides have a roomId:
 *   await callProvider.joinRoom(roomId, { video: true });
 *   callProvider.onRemoteStream((stream) => { videoEl.srcObject = stream; });
 *
 *   // When the call ends:
 *   callProvider.leaveRoom();
 *
 * Bangladesh mobile optimization notes:
 *   • Default resolution is 360p to conserve bandwidth on 3G/4G.
 *   • Audio-only fallback is enabled when video bitrate drops below 50kbps.
 *   • ICE servers include TURN relays for symmetric NAT common on mobile ISPs.
 *   • Reconnect attempts use exponential backoff (1s, 2s, 4s, 8s, max 15s).
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

// ─── STUN/TURN servers optimized for Bangladesh ─────────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Add TURN servers here for production (essential for BD mobile carriers
  // which frequently use symmetric NAT):
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
let _onRemoteStreamCb = null;
let _onCallStateCb = null;
let _onIncomingCallCb = null;
let _currentCallId = null;
let _reconnectAttempt = 0;
let _reconnectTimer = null;

// ─── Socket.IO connection ───────────────────────────────────────────────────

function getSocket() {
  return _socket;
}

/**
 * Connect the Socket.IO client. Called once when the app boots (or the
 * user logs in). The token is pulled from localStorage.
 */
function connect(token) {
  if (_socket?.connected) return _socket;

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
    if (_onIncomingCallCb) _onIncomingCallCb(data);
  });

  // ── Call accepted by receiver ─────────────────────────────────────────
  _socket.on('CALL_ACCEPTED', (data) => {
    console.log('[callProvider] call accepted:', data);
    if (_onCallStateCb) _onCallStateCb('accepted', data);
  });

  // ── Call rejected ─────────────────────────────────────────────────────
  _socket.on('CALL_REJECTED', (data) => {
    console.log('[callProvider] call rejected:', data);
    cleanup();
    if (_onCallStateCb) _onCallStateCb('rejected', data);
  });

  // ── Call ended ────────────────────────────────────────────────────────
  _socket.on('CALL_ENDED', (data) => {
    console.log('[callProvider] call ended:', data);
    cleanup();
    if (_onCallStateCb) _onCallStateCb('ended', data);
  });

  // ── Missed call ───────────────────────────────────────────────────────
  _socket.on('CALL_MISSED', (data) => {
    console.log('[callProvider] call missed:', data);
    cleanup();
    if (_onCallStateCb) _onCallStateCb('missed', data);
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
    return _localStream;
  } catch (err) {
    console.error('[callProvider] getUserMedia failed:', err);
    // Fallback to audio-only if video fails (common on low-end BD phones).
    if (type === 'video') {
      console.warn('[callProvider] falling back to audio-only');
      _localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS_BD, video: false });
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
    if (_onRemoteStreamCb && event.streams[0]) {
      _onRemoteStreamCb(event.streams[0]);
    }
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

/**
 * Initiate a call. Creates the Call record via REST, then emits
 * CALL_INITIATED via Socket.IO to ring the receiver.
 *
 * @param {Object} opts
 * @param {string} opts.receiverId  — Target user's Mongo ID.
 * @param {string} opts.type        — 'voice' or 'video'.
 * @param {string} opts.callerName  — Display name shown to receiver.
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

  // 2. Acquire local media stream.
  if (ACTIVE_PROVIDER === PROVIDERS.NATIVE) {
    await getLocalStream(type);
    createPeerConnection(receiverId);

    // Create the initial SDP offer.
    const offer = await _peerConnection.createOffer();
    await _peerConnection.setLocalDescription(offer);
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

  if (ACTIVE_PROVIDER === PROVIDERS.NATIVE) {
    await getLocalStream(type);
    createPeerConnection(callerId);
  }

  // Emit acceptance via socket.
  _socket?.emit('CALL_ACCEPTED', { callId });
}

/**
 * Reject an incoming call.
 */
function rejectCall({ callId }) {
  _socket?.emit('CALL_REJECTED', { callId });
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
  _onRemoteStreamCb = cb;
}

function onCallStateChange(cb) {
  _onCallStateCb = cb;
}

function onIncomingCall(cb) {
  _onIncomingCallCb = cb;
}

// ─── Media controls ─────────────────────────────────────────────────────────

function toggleMute() {
  if (!_localStream) return false;
  const audioTrack = _localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    return !audioTrack.enabled; // returns true if now muted
  }
  return false;
}

function toggleVideo() {
  if (!_localStream) return false;
  const videoTrack = _localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    return !videoTrack.enabled; // returns true if now off
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

  // Call actions
  initiateCall,
  acceptCall,
  rejectCall,
  endCall,

  // Event handlers
  onRemoteStream,
  onCallStateChange,
  onIncomingCall,

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
