import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Standard loading placeholder used across admin + user-facing async
 * surfaces. Centered spinner with optional caption.
 *
 * @param {{ label?: string, fullHeight?: boolean }} props
 */
const LoadingState = ({ label = 'Loading…', fullHeight = false }) => (
  <div
    className={`flex flex-col items-center justify-center gap-3 text-gray-500 ${
      fullHeight ? 'h-full min-h-[300px]' : 'py-16'
    }`}
  >
    <Loader2 size={28} className="animate-spin text-[#ba0036]" />
    <span className="text-xs font-bold uppercase tracking-widest">{label}</span>
  </div>
);

export default LoadingState;
