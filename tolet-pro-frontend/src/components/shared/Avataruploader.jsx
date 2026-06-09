/**
 * AvatarUploader.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Drop-in avatar with upload progress, optimistic preview, initials
 * fallback, and graceful image-load error handling.
 *
 * Sizes:
 *   "sm" → 40px  (navbar)
 *   "md" → 88px  (mobile dashboard)
 *   "lg" → 128px (desktop dashboard)
 */

import React, { useState, useEffect } from 'react';
import { Camera, AlertCircle } from 'lucide-react';
import UploadSourceSheet from './Uploadsourcesheet';

const SIZES = {
  sm: { outer: 'w-10 h-10',           badge: 'w-5  h-5',  badgeIcon: 10, ring: 'ring-2' },
  md: { outer: 'w-[88px] h-[88px]',   badge: 'w-7  h-7',  badgeIcon: 14, ring: 'ring-4' },
  lg: { outer: 'w-32 h-32',           badge: 'w-9  h-9',  badgeIcon: 16, ring: 'ring-4' },
};

const FALLBACK_BGS = [
  'from-rose-400 to-rose-600',
  'from-amber-400 to-orange-600',
  'from-emerald-400 to-teal-600',
  'from-sky-400 to-indigo-600',
  'from-purple-400 to-fuchsia-600',
  'from-slate-400 to-slate-600',
];
function pickFallbackBg(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return FALLBACK_BGS[h % FALLBACK_BGS.length];
}

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AvatarUploader = ({
  src,
  name = '',
  onUpload,
  size = 'md',
  language = 'বাংলা',
  editable = true,
  className = '',
}) => {
  const isBn = language === 'বাংলা';
  const dims = SIZES[size] || SIZES.md;

  const [sheetOpen, setSheetOpen]   = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [progress,  setProgress]    = useState(0);
  const [error,     setError]       = useState('');
  const [optimistic, setOptimistic] = useState(null);
  const [imgError,  setImgError]    = useState(false);

  // Clear optimistic preview as soon as parent's `src` updates
  useEffect(() => {
    if (src) {
      setOptimistic(null);
      setImgError(false);
    }
  }, [src]);

  const displaySrc = optimistic || src;

  const handleFile = async (file, source) => {
    if (!file || !onUpload) return;
    setError('');
    setImgError(false);

    // Optimistic preview from FileReader
    const reader = new FileReader();
    reader.onload = (e) => setOptimistic(e.target.result);
    reader.readAsDataURL(file);

    setUploading(true);
    setProgress(0);
    try {
      await onUpload(file, source, (pct) => setProgress(pct));
    } catch (err) {
      setOptimistic(null);
      setError(
        err?.message ||
        (isBn ? 'আপলোডে সমস্যা হয়েছে। আবার চেষ্টা করুন।' : 'Upload failed. Please try again.'),
      );
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const openSheet = () => {
    if (!editable || uploading) return;
    setError('');
    setSheetOpen(true);
  };

  const fallbackBg = pickFallbackBg(name);
  const initials   = getInitials(name);

  const r = 50;
  const C = 2 * Math.PI * r;
  const offset = C - (progress / 100) * C;

  const showImage = !!displaySrc && !imgError;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={openSheet}
        disabled={!editable}
        className={`relative ${dims.outer} rounded-full overflow-hidden ${dims.ring} ring-white shadow-lg
          ${editable ? 'cursor-pointer group' : 'cursor-default'}
          ${error ? 'ring-red-300' : ''}
          transition-all`}
        aria-label={
          editable
            ? (isBn ? 'প্রোফাইল ছবি পরিবর্তন করুন' : 'Change profile photo')
            : (isBn ? 'প্রোফাইল ছবি' : 'Profile photo')
        }
      >
        {showImage ? (
          <img
            key={displaySrc}
            src={displaySrc}
            alt={name || 'avatar'}
            className={`w-full h-full object-cover ${uploading ? 'opacity-50' : ''}`}
            onError={() => setImgError(true)}
            draggable={false}
          />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${fallbackBg} flex items-center justify-center`}>
            <span
              className="text-white font-black tracking-tight select-none"
              style={{ fontSize: size === 'lg' ? 36 : size === 'md' ? 26 : 14 }}
            >
              {initials}
            </span>
          </div>
        )}

        {editable && !uploading && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors hidden sm:flex items-center justify-center">
            <Camera size={size === 'lg' ? 22 : 16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}

        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r={r} stroke="rgba(255,255,255,0.3)" strokeWidth="6" fill="none" />
              <circle
                cx="60" cy="60" r={r}
                stroke="#ffffff" strokeWidth="6" fill="none"
                strokeDasharray={C} strokeDashoffset={offset} strokeLinecap="round"
                className="transition-[stroke-dashoffset] duration-200"
              />
            </svg>
            {progress > 0 && (
              <span className="absolute text-white font-black text-xs tabular-nums">{progress}%</span>
            )}
          </div>
        )}
      </button>

      {editable && !uploading && (
        <button
          type="button"
          onClick={openSheet}
          className={`absolute -bottom-1 -right-1 ${dims.badge} rounded-full bg-gradient-to-br from-[#ba0036] to-[#7a0024] flex items-center justify-center ring-2 ring-white shadow-md hover:shadow-lg active:scale-95 transition-all`}
          aria-label={isBn ? 'ছবি পরিবর্তন' : 'Change photo'}
        >
          <Camera size={dims.badgeIcon} className="text-white" strokeWidth={2.5} />
        </button>
      )}

      {error && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap z-10">
          <button
            type="button"
            onClick={openSheet}
            className="px-2.5 py-1 rounded-full bg-red-50 border border-red-100 text-red-700 text-[10px] font-black flex items-center gap-1 shadow-sm hover:bg-red-100 transition-colors"
          >
            <AlertCircle size={10} />
            {isBn ? 'ব্যর্থ — পুনরায় চেষ্টা' : 'Failed — retry'}
          </button>
        </div>
      )}

      <UploadSourceSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onFile={(file, source) => {
          setSheetOpen(false);
          handleFile(file, source);
        }}
        docType="photo"
        language={language}
        uploading={false}
      />
    </div>
  );
};

export default AvatarUploader;