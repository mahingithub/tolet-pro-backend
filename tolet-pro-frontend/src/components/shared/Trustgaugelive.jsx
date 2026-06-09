/**
 * TrustGaugeLive.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Circular trust-score gauge with smooth live updates.
 *
 * The "Live" suffix matters: this is designed to re-animate every time the
 * score changes (e.g. user saves a new field and the server-recomputed
 * trustScore comes back higher). The previous static `TrustGauge` in
 * TenantDashboard repainted instantly, which felt jarring — the user
 * saved a field and the gauge just *jumped*. This one tweens the arc
 * over ~700ms so the reward is visible.
 *
 * Why SVG instead of CSS conic-gradient?
 *   • conic-gradient can't be animated smoothly in any browser yet
 *   • SVG `stroke-dashoffset` is the canonical solution and has been
 *     hardware-accelerated everywhere since ~2020
 *   • We can layer a glow filter on top for the brand "shimmer" feel
 *
 * Props:
 *   score     : number 0-100              — live value (animates on change)
 *   tier      : 'bronze' | 'silver' | 'gold' | 'platinum'
 *   size      : 'sm' | 'md' | 'lg'        — default 'md' (160px)
 *   showTier  : boolean                   — show tier name under score, default true
 *   language  : 'বাংলা' | 'English'       — for tier label
 *   subtitle  : string?                   — optional caption below tier
 *
 * Accessibility:
 *   role="meter" + aria-valuenow gives screen readers a real number.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

const SIZE_MAP = {
  sm: { dim: 96,  stroke: 8,  numCls: 'text-2xl',  tierCls: 'text-[9px]' },
  md: { dim: 160, stroke: 12, numCls: 'text-4xl',  tierCls: 'text-[10px]' },
  lg: { dim: 200, stroke: 14, numCls: 'text-5xl',  tierCls: 'text-xs' },
};

// Tier → ring colours (matches the avatar-ring palette used elsewhere
// in the dashboards so the whole identity feels consistent).
const TIER_META = {
  bronze:   { from: '#ba0036', to: '#fbbf24', en: 'Bronze',   bn: 'ব্রোঞ্জ',     glow: 'rgba(186,0,54,0.25)' },
  silver:   { from: '#9ca3af', to: '#e5e7eb', en: 'Silver',   bn: 'সিলভার',     glow: 'rgba(156,163,175,0.25)' },
  gold:     { from: '#f59e0b', to: '#fbbf24', en: 'Gold',     bn: 'গোল্ড',       glow: 'rgba(245,158,11,0.30)' },
  platinum: { from: '#3b82f6', to: '#22d3ee', en: 'Platinum', bn: 'প্ল্যাটিনাম', glow: 'rgba(59,130,246,0.30)' },
};

const TrustGaugeLive = ({
  score = 0,
  tier = 'bronze',
  size = 'md',
  showTier = true,
  language = 'বাংলা',
  subtitle,
}) => {
  const isBn = language === 'বাংলা';
  const { dim, stroke, numCls, tierCls } = SIZE_MAP[size] || SIZE_MAP.md;
  const meta = TIER_META[tier] || TIER_META.bronze;

  // Geometry: a circle of radius (dim/2 - stroke) so the stroke sits
  // inside the SVG box without clipping.
  const radius        = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Clamp score to [0,100] so an out-of-band value (server bug) doesn't
  // draw a negative arc or wrap past the start.
  const clamped       = Math.max(0, Math.min(100, score));

  // ─── Tween animation ──────────────────────────────────────────────
  // We hold a *displayed* score in state and ease toward the prop
  // value over ~700ms. requestAnimationFrame keeps it buttery on slower
  // phones — setInterval would jitter at 60fps boundaries.
  const [displayed, setDisplayed] = useState(clamped);
  const rafRef    = useRef(null);
  const startRef  = useRef(null);
  const fromRef   = useRef(clamped);

  useEffect(() => {
    // Cancel any in-flight tween — we always animate from current
    // displayed value to new target, no matter how fast they change.
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    fromRef.current  = displayed;
    startRef.current = null;
    const target     = clamped;
    const duration   = 700; // ms

    const tick = (ts) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // easeOutCubic — fast start, smooth landing. Feels rewarding rather
      // than mechanical.
      const eased = 1 - Math.pow(1 - t, 3);
      const next  = fromRef.current + (target - fromRef.current) * eased;
      setDisplayed(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Snap to integer at the end so the displayed number doesn't
        // settle at e.g. 47.9999 → 47 when we round.
        setDisplayed(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // We intentionally exclude `displayed` from deps — including it
    // would restart the tween on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamped]);

  // Stroke offset for the current displayed value.
  const offset = circumference - (displayed / 100) * circumference;
  const gradId = `trustGrad-${tier}`; // unique per tier so multiple gauges on the page don't collide

  return (
    <div
      className="flex flex-col items-center justify-center"
      role="meter"
      aria-valuenow={Math.round(displayed)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={isBn ? 'ট্রাস্ট স্কোর' : 'Trust score'}
    >
      <div
        className="relative"
        style={{ width: dim, height: dim, filter: `drop-shadow(0 8px 24px ${meta.glow})` }}
      >
        <svg width={dim} height={dim} className="-rotate-90">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor={meta.from} />
              <stop offset="100%" stopColor={meta.to} />
            </linearGradient>
          </defs>
          {/* Background ring — faint grey track */}
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={stroke}
          />
          {/* Foreground arc — animated via stroke-dashoffset */}
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>

        {/* Center content — big rounded number + small tier label.
            Absolutely positioned because the SVG itself fills the box. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className={`font-black text-gray-900 leading-none ${numCls}`}>
            {Math.round(displayed)}
          </div>
          <div className="text-[9px] font-black tracking-widest text-gray-400 mt-1 uppercase">
            / 100
          </div>
        </div>
      </div>

      {showTier && (
        <div className="mt-3 flex items-center gap-1.5">
          <ShieldCheck size={12} className="text-gray-500" />
          <span className={`font-black tracking-widest uppercase text-gray-700 ${tierCls}`}>
            {isBn ? meta.bn : meta.en}
          </span>
        </div>
      )}

      {subtitle && (
        <p className="mt-2 text-[11px] font-bold text-gray-500 text-center max-w-[200px]">
          {subtitle}
        </p>
      )}
    </div>
  );
};

export default TrustGaugeLive;