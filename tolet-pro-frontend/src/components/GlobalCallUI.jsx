// GlobalCallUI.jsx
//
// App-level call UI that handles BOTH incoming and outgoing calls regardless
// of which page the user is on. Mounted once in AppLayout, listens to
// callProvider events, and shows a full-screen overlay when there's an
// active call.
//
// Features:
//   • Incoming call ringing UI with Accept / Reject (works from any page).
//   • Outgoing call ringing UI when user initiates from ChatSystem.
//   • Audio + Video elements that attach the remote stream after accept.
//   • Local video preview for video calls.
//   • Synthesized ringtone via Web Audio API (no audio file needed).
//   • Mute, hang-up, camera toggle controls.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, UserPlus } from 'lucide-react';
import callProvider from '../services/callProvider';
import { getCurrentToken } from '../services/authService';

// ─── Ringtone — Web Audio API synthesized tone, no file needed ──────────────
class Ringtone {
  constructor() {
    this.ctx = null;
    this.timer = null;
    this.active = false;
  }
  start({ outgoing = false } = {}) {
    if (this.active) return;
    this.active = true;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
      }
      // Resume if browser suspended it.
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const beep = () => {
        if (!this.active || !this.ctx) return;
        const osc  = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = outgoing ? 420 : 480; // slightly different tone in/out
        const now = this.ctx.currentTime;
        // gentle envelope, ~0.4s beep
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gain.gain.setValueAtTime(0.12, now + 0.35);
        gain.gain.linearRampToValueAtTime(0, now + 0.4);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
      };
      // ring pattern: short beep, 800ms gap, repeat.
      beep();
      this.timer = setInterval(beep, 1300);
    } catch (e) {
      console.warn('[Ringtone] failed:', e);
    }
  }
  stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const GlobalCallUI = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // callState shape:
  //   null  — no call
  //   { status: 'ringing'|'accepted', direction: 'incoming'|'outgoing',
  //     callId, callerId, peerName, peerAvatar, type, roomId }
  const [callState, setCallState] = useState(null);
  const [muted, setMuted]         = useState(false);
  const [videoOff, setVideoOff]   = useState(false);

  const remoteAudioRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localVideoRef  = useRef(null);
  const ringtoneRef    = useRef(null);
  const handledNotificationActionsRef = useRef(new Set());

  if (!ringtoneRef.current) ringtoneRef.current = new Ringtone();

  // Attach a stream to whichever element is appropriate based on call type.
  const attachRemoteStream = useCallback((stream) => {
    if (!stream) return;
    // For video calls, prefer the video element.
    if (callState?.type === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.play?.().catch(() => {});
    }
    // Always attach to audio too so voice works even on video.
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.play?.().catch(() => {});
    }
  }, [callState?.type]);

  const attachLocalStream = useCallback((stream, type) => {
    if (type === 'video' && stream && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.play?.().catch(() => {});
    }
  }, []);

  const ensureSocket = useCallback(() => {
    const token = getCurrentToken();
    if (!token) return false;
    callProvider.connect(token);
    return true;
  }, []);

  const toIncomingState = useCallback((data, status = 'ringing') => ({
    status,
    direction: 'incoming',
    callId:      data.callId,
    callerId:    data.callerId,
    peerName:    data.callerName || data.peerName || 'Unknown',
    peerAvatar:  data.callerAvatar || data.peerAvatar || null,
    type:        data.type || 'voice',
    roomId:      data.roomId,
  }), []);

  const acceptIncomingCall = useCallback(async (incoming) => {
    if (!incoming?.callId) return;
    setCallState(toIncomingState(incoming, 'ringing'));
    if (!ensureSocket()) return;

    try {
      await callProvider.acceptCall({
        callId:   incoming.callId,
        callerId: incoming.callerId,
        type:     incoming.type || 'voice',
        roomId:   incoming.roomId,
      });
      setCallState((prev) => (
        prev?.callId === incoming.callId
          ? { ...prev, status: 'accepted' }
          : toIncomingState(incoming, 'accepted')
      ));
    } catch (err) {
      console.error('[GlobalCallUI] acceptCall failed:', err);
      setCallState(null);
    }
  }, [ensureSocket, toIncomingState]);

  const rejectIncomingCall = useCallback((incoming) => {
    if (!incoming?.callId) return;
    if (!ensureSocket()) {
      setCallState(null);
      return;
    }
    callProvider.rejectCall({ callId: incoming.callId });
    setCallState(null);
  }, [ensureSocket]);

  const handleNotificationLaunch = useCallback((incoming, action = 'open') => {
    if (!incoming?.callId) return;

    const key = `${incoming.callId}:${action}:${incoming.roomId || ''}`;
    if (handledNotificationActionsRef.current.has(key)) return;
    handledNotificationActionsRef.current.add(key);

    if (action === 'decline') {
      rejectIncomingCall(incoming);
      return;
    }

    if (action === 'accept') {
      acceptIncomingCall(incoming);
      return;
    }

    ensureSocket();
    setCallState(toIncomingState(incoming, 'ringing'));
  }, [acceptIncomingCall, ensureSocket, rejectIncomingCall, toIncomingState]);

  // ─── Subscribe to provider events ──────────────────────────────────────
  useEffect(() => {
    const unsubIncoming = callProvider.onIncomingCall((data) => {
      setCallState(toIncomingState(data, 'ringing'));
    });

    const unsubOutgoing = callProvider.onOutgoingCall((data) => {
      // ChatSystem already shows its own outgoing overlay; we still set state
      // here so audio/video elements are mounted and remote stream can attach.
      // Direction='outgoing' keeps our overlay hidden in favor of ChatSystem's
      // (see render below — outgoing only shows a minimal status, not full UI).
      setCallState((prev) => ({
        status: 'ringing',
        direction: 'outgoing',
        callId:      data.callId,
        peerName:    prev?.peerName  || 'Calling…',
        peerAvatar:  prev?.peerAvatar || null,
        type:        data.type || 'voice',
        roomId:      data.roomId,
      }));
    });

    const unsubState = callProvider.onCallStateChange((status, data) => {
      if (status === 'accepted') {
        setCallState((prev) => prev ? { ...prev, status: 'accepted', roomId: data?.roomId || prev.roomId } : null);
      } else if (status === 'ended' || status === 'rejected' || status === 'missed') {
        setCallState(null);
        setMuted(false);
        setVideoOff(false);
      }
    });

    const unsubRemoteStream = callProvider.onRemoteStream((stream) => {
      attachRemoteStream(stream);
    });

    const unsubLocalStream = callProvider.onLocalStream(attachLocalStream);

    return () => {
      unsubIncoming?.();
      unsubOutgoing?.();
      unsubState?.();
      unsubRemoteStream?.();
      unsubLocalStream?.();
    };
  }, [attachLocalStream, attachRemoteStream, toIncomingState]);

  useEffect(() => {
    if (callState?.status !== 'accepted' || callState?.type !== 'video') return;
    attachLocalStream(callProvider.getLocalStream(), callState.type);
  }, [attachLocalStream, callState?.status, callState?.type]);

  // Notification click → app launch. The service worker opens /messages with
  // these params when the PWA was closed or in the background.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('incomingCall') !== '1') return;

    const incoming = {
      callId: params.get('callId') || '',
      callerId: params.get('callerId') || '',
      callerName: params.get('callerName') || 'Unknown',
      callerAvatar: params.get('callerAvatar') || '',
      type: params.get('type') || 'voice',
      roomId: params.get('roomId') || '',
    };
    const action = params.get('callAction') || params.get('action') || 'open';

    handleNotificationLaunch(incoming, action);

    [
      'incomingCall',
      'callAction',
      'action',
      'callId',
      'callerId',
      'callerName',
      'callerAvatar',
      'type',
      'roomId',
    ].forEach((key) => params.delete(key));

    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : '',
    }, { replace: true });
  }, [handleNotificationLaunch, location.pathname, location.search, navigate]);

  // Notification click → already-open app tab. This avoids waiting for a route
  // navigation if the browser focuses an existing PWA window.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    const onMessage = (event) => {
      const msg = event.data || {};
      if (msg.type !== 'TOLET_INCOMING_CALL_NOTIFICATION_CLICK') return;
      handleNotificationLaunch(msg.call || {}, msg.action || 'open');
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [handleNotificationLaunch]);

  // Ringtone control — ring while status === 'ringing', stop otherwise.
  useEffect(() => {
    const rt = ringtoneRef.current;
    if (!rt) return;
    if (callState?.status === 'ringing') {
      rt.start({ outgoing: callState.direction === 'outgoing' });
    } else {
      rt.stop();
    }
    return () => rt.stop();
  }, [callState?.status, callState?.direction]);

  // Hang-up on Escape.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && callState) {
        handleHangup();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callState]);

  const handleAccept = async () => {
    if (!callState || callState.direction !== 'incoming') return;
    acceptIncomingCall(callState);
  };

  const handleReject = () => {
    if (!callState) return;
    rejectIncomingCall(callState);
  };

  const handleHangup = () => {
    if (!callState) return;
    callProvider.endCall({ callId: callState.callId });
    setCallState(null);
    setMuted(false);
    setVideoOff(false);
  };

  const handleMute = () => {
    const isMuted = callProvider.toggleMute();
    setMuted(isMuted);
  };

  const handleVideoToggle = () => {
    const isOff = callProvider.toggleVideo();
    setVideoOff(isOff);
  };

  // Only show OUR overlay for incoming calls. Outgoing calls already get
  // ChatSystem's overlay. But we still render hidden audio/video elements
  // for outgoing too so streams play.
  const showOverlay = callState && callState.direction === 'incoming';
  const isVideoCall = callState?.type === 'video';
  const isInCall    = callState?.status === 'accepted';

  return (
    <>
      {/* Hidden audio element — always mounted whenever there's a call so
          remote audio plays even for outgoing calls handled by ChatSystem. */}
      {callState && <audio ref={remoteAudioRef} autoPlay playsInline />}

      <AnimatePresence>
        {showOverlay && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-gray-900/95 backdrop-blur-2xl flex flex-col items-center justify-center text-white p-6"
          >
            {/* Video area when in-call + video */}
            {isInCall && isVideoCall && (
              <div className="absolute inset-0 bg-black">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute bottom-28 right-4 w-32 h-44 sm:w-40 sm:h-56 object-cover rounded-2xl border-2 border-white/20 shadow-2xl bg-black"
                />
              </div>
            )}

            {/* Avatar / caller info (only visible during ringing or voice-call) */}
            {(!isInCall || !isVideoCall) && (
              <>
                <div className="relative mb-6">
                  {!isInCall && (
                    <>
                      <span className="absolute inset-0 rounded-full border-2 border-[#ba0036]/40 animate-ping"></span>
                      <span className="absolute -inset-3 rounded-full border-2 border-[#ba0036]/20 animate-ping" style={{ animationDelay: '0.4s' }}></span>
                    </>
                  )}
                  <div className="w-32 h-32 rounded-full border-4 border-[#ba0036] p-1 relative">
                    {callState?.peerAvatar ? (
                      <img src={callState.peerAvatar} className="w-full h-full rounded-full object-cover" alt=""/>
                    ) : (
                      <div className="w-full h-full rounded-full bg-gradient-to-br from-[#ba0036] to-[#7a0024] flex items-center justify-center text-3xl font-black">
                        {(callState?.peerName || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-[#ba0036] px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                    {isInCall
                      ? 'In Call'
                      : 'Incoming Call'}
                  </div>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black mb-1 text-center">{callState?.peerName}</h2>
                <p className="text-gray-400 font-bold mb-10 text-sm">
                  TO-LET PRO HD {isVideoCall ? 'Video' : 'Voice'} Call
                </p>
              </>
            )}

            {/* Controls */}
            <div className={`flex gap-4 sm:gap-8 ${isInCall && isVideoCall ? 'absolute bottom-8 left-1/2 -translate-x-1/2 z-10' : ''}`}>
              {!isInCall ? (
                /* Ringing controls: Accept / Reject */
                <>
                  <button
                    onClick={handleReject}
                    className="w-16 h-16 sm:w-20 sm:h-20 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center shadow-2xl shadow-red-600/40 transition-all"
                    aria-label="Decline"
                  >
                    <PhoneOff size={28}/>
                  </button>
                  <button
                    onClick={handleAccept}
                    className="w-16 h-16 sm:w-20 sm:h-20 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center shadow-2xl shadow-green-600/40 transition-all animate-bounce"
                    aria-label="Accept"
                  >
                    <Phone size={28}/>
                  </button>
                </>
              ) : (
                /* In-call controls: Mute / Hangup / Video toggle */
                <>
                  <button
                    onClick={handleMute}
                    className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all border ${
                      muted ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-white/10 hover:bg-white/20 border-white/10'
                    }`}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                  >
                    {muted ? <MicOff size={22}/> : <Mic size={22}/>}
                  </button>
                  <button
                    onClick={handleHangup}
                    className="w-16 h-16 sm:w-20 sm:h-20 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center shadow-2xl shadow-red-600/40 transition-all"
                    aria-label="End call"
                  >
                    <PhoneOff size={28}/>
                  </button>
                  {isVideoCall ? (
                    <button
                      onClick={handleVideoToggle}
                      className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all border ${
                        videoOff ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-white/10 hover:bg-white/20 border-white/10'
                      }`}
                      aria-label={videoOff ? 'Turn camera on' : 'Turn camera off'}
                    >
                      {videoOff ? <VideoOff size={22}/> : <Video size={22}/>}
                    </button>
                  ) : (
                    <button
                      className="w-14 h-14 sm:w-16 sm:h-16 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all border border-white/10"
                      aria-label="Add participant"
                    >
                      <UserPlus size={22}/>
                    </button>
                  )}
                </>
              )}
            </div>
            <p className="mt-6 text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Tap Esc to hang up</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default GlobalCallUI;
