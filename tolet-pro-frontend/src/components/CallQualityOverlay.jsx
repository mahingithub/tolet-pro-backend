/**
 * CallQualityOverlay.jsx — Phase Call-3 UI add-ons for the call overlay.
 *
 * Self-contained so ChatSystem only needs to mount it. It subscribes to the
 * additive callProvider callbacks (onNetworkQuality / onReconnectStateChange)
 * and renders:
 *   • a 5-bar network-quality indicator (top-left of the call view)
 *   • a "Reconnecting…" banner when the media room drops
 *   • a front/back camera switch button (video calls only, mobile)
 *
 * Under the NATIVE provider these callbacks never fire, so the indicator stays
 * idle (grey) and the banner never shows — harmless.
 *
 * Styling intentionally mirrors the existing overlay: dark translucent chips,
 * white text, brand accent (#ba0036). Uses only Tailwind + inline SVG, so it
 * adds no icon-library dependency.
 */

import React, { useState, useEffect } from 'react';
import callProvider from '../services/callProvider';

// Zego quality levels: 0 excellent · 1 good · 2 medium · 3 bad · 4 unusable.
// Map to how many of the 5 bars are "active".
function levelToActiveBars(level) {
  if (level === null || level === undefined || Number.isNaN(level)) return 0;
  return Math.max(1, 5 - Number(level)); // 0→5, 1→4, 2→3, 3→2, 4→1
}

function barColor(level) {
  if (level === null || level === undefined) return '#9ca3af'; // grey-400 (idle)
  if (level <= 1) return '#22c55e'; // green-500
  if (level === 2) return '#f59e0b'; // amber-500
  return '#ef4444'; // red-500
}

function qualityLabel(level) {
  if (level === null || level === undefined) return '';
  if (level <= 1) return 'Strong';
  if (level === 2) return 'Fair';
  if (level === 3) return 'Weak';
  return 'Poor';
}

export default function CallQualityOverlay({ callType = 'voice', enableSwitchCamera = true }) {
  const [level, setLevel] = useState(null);       // 0..4 or null
  const [reconnecting, setReconnecting] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const unsubQuality = callProvider.onNetworkQuality((q) => {
      setLevel(q && typeof q.level === 'number' ? q.level : null);
    });
    const unsubReconnect = callProvider.onReconnectStateChange((isReconnecting) => {
      setReconnecting(!!isReconnecting);
    });
    return () => {
      unsubQuality?.();
      unsubReconnect?.();
    };
  }, []);

  const activeBars = levelToActiveBars(level);
  const color = barColor(level);

  const handleSwitch = async () => {
    if (switching) return;
    setSwitching(true);
    try { await callProvider.switchCamera(); }
    finally { setSwitching(false); }
  };

  return (
    <>
      {/* ── Network-quality indicator (top-left) ───────────────────────── */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-black/40 backdrop-blur-md px-2.5 py-1.5 rounded-full border border-white/10">
        <div className="flex items-end gap-[3px] h-4" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-sm transition-all duration-300"
              style={{
                height: `${5 + i * 2.5}px`,
                backgroundColor: i < activeBars ? color : 'rgba(255,255,255,0.18)',
              }}
            />
          ))}
        </div>
        {qualityLabel(level) && (
          <span className="text-[9px] font-black uppercase tracking-widest text-white/70">
            {qualityLabel(level)}
          </span>
        )}
      </div>

      {/* ── Reconnecting banner (top-center) ───────────────────────────── */}
      {reconnecting && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-amber-500/90 text-white px-3.5 py-1.5 rounded-full shadow-lg shadow-amber-900/30">
          <span
            className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin"
            aria-hidden="true"
          />
          <span className="text-[10px] font-black uppercase tracking-widest">Reconnecting…</span>
        </div>
      )}

      {/* ── Switch-camera button (video only) ──────────────────────────── */}
      {enableSwitchCamera && callType === 'video' && (
        <button
          onClick={handleSwitch}
          disabled={switching}
          className="absolute top-4 right-40 sm:right-52 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-md flex items-center justify-center transition-all disabled:opacity-50"
          aria-label="Switch camera"
          title="Switch camera"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.5" />
            <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3.5" />
            <circle cx="12" cy="12" r="3" />
            <path d="M18 9l2-2-2-2" />
            <path d="M6 15l-2 2 2 2" />
          </svg>
        </button>
      )}
    </>
  );
}
