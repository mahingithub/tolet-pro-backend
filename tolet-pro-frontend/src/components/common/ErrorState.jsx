import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

/**
 * Standard error placeholder with optional retry. Keep messages
 * actionable — say what failed and how to recover, not just "Error".
 *
 * @param {{
 *   title?: string,
 *   description?: string,
 *   onRetry?: () => void,
 *   retryLabel?: string
 * }} props
 */
const ErrorState = ({
  title = 'Something went wrong',
  description = "We couldn't load this section. Please try again — if it keeps failing, contact support.",
  onRetry,
  retryLabel = 'Retry',
}) => (
  <div className="bg-white rounded-[2rem] p-12 text-center shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
    <div className="w-16 h-16 bg-red-50 text-[#ba0036] rounded-full flex items-center justify-center mx-auto mb-4">
      <AlertTriangle size={28} />
    </div>
    <h3 className="text-xl font-black text-gray-900">{title}</h3>
    <p className="text-gray-500 font-bold mt-2 text-sm max-w-md mx-auto">{description}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="mt-6 inline-flex items-center gap-2 bg-[#ba0036] text-white px-5 py-2.5 rounded-xl font-black text-xs shadow-[0_4px_15px_rgba(186,0,54,0.2)] hover:-translate-y-0.5 transition-all"
      >
        <RefreshCcw size={14} /> {retryLabel}
      </button>
    )}
  </div>
);

export default ErrorState;
