/**
 * Skeleton.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Facebook-style shimmer placeholder block. Compose multiple together to
 * mimic the final layout while data is loading. Looks far more polished
 * than a spinner — the user sees the *shape* of what's coming before the
 * data arrives, so the app feels instant even on slow networks.
 *
 * Usage:
 *   <Skeleton className="w-24 h-24 rounded-full" />
 *   <Skeleton className="w-3/4 h-4 rounded" />
 *
 * For complex layouts (full profile, field list, autocomplete dropdown)
 * use the pre-composed variants under `./skeletons/`.
 *
 * Implementation note: the shimmer uses an absolutely-positioned gradient
 * that slides left→right via `transform: translateX`. We avoid background-
 * position animation because it triggers full repaints on some browsers;
 * transform animations are GPU-composited and silky.
 *
 * Tailwind keyframe required (add to tailwind.config.js):
 *   extend: { keyframes: { shimmer: { '100%': { transform: 'translateX(100%)' } } },
 *             animation: { shimmer: 'shimmer 1.5s infinite' } }
 *
 * If your config doesn't have the keyframe, the inline <style> at the
 * bottom of this file provides a fallback so the component still works.
 */

import React from 'react';

const Skeleton = ({ className = '', delay = 0, rounded = 'rounded-lg' }) => (
  <div
    className={`relative overflow-hidden bg-gray-100 ${rounded} ${className}`}
    style={{ animationDelay: `${delay}ms` }}
    aria-hidden="true"
  >
    <div
      className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent"
      style={{
        animation: 'tolet-shimmer 1.5s infinite',
        animationDelay: `${delay}ms`,
      }}
    />
    {/* Inline fallback keyframe so the component works even when the
        tailwind config hasn't been updated yet. Scoped via a unique
        keyframe name so it won't collide with any project animation. */}
    <style>{`
      @keyframes tolet-shimmer {
        100% { transform: translateX(100%); }
      }
    `}</style>
  </div>
);

export default Skeleton;