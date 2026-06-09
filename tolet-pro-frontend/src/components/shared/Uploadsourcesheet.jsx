/**
 * UploadSourceSheet.jsx (Desktop Camera Fix)
 * ─────────────────────────────────────────────────────────────────────
 * Bug 2 fix — desktop-এ Camera button → gallery খুলছিল
 *
 * Why this is happening:
 *   <input capture="environment"> attribute mobile browser-এ camera force
 *   করে, কিন্তু desktop browser এটা ignore করে — কারণ desktop OS-level-এ
 *   "camera roll" concept নেই, শুধু webcam (যেটা getUserMedia API দিয়ে
 *   access করতে হয়, file input দিয়ে না)।
 *
 *   ফলে desktop-এ "Camera" আর "Gallery" দু'টা button-ই একই OS file picker
 *   খোলে — confusing।
 *
 * Fix:
 *   Desktop-এ Camera button-টা hide করে দাও। User-কে শুধু Gallery + File
 *   দেখাবে। Mobile-এ সব option আগের মতই থাকবে।
 *
 *   Detection: `navigator.maxTouchPoints > 0` || small viewport — দু'টার
 *   combination mobile detect করতে সবচেয়ে reliable, user-agent sniffing-এর
 *   চেয়ে।
 *
 * Apply:
 *   পুরো ফাইল replace করো তোমার current Uploadsourcesheet.jsx-এর সাথে।
 *   ৩টা change marked with 🔧 — বাকি সব unchanged।
 */

import React, { useRef, useEffect, useState } from 'react';
import {
  X, Camera, ImageIcon, FileText, Loader2, ChevronUp,
} from 'lucide-react';

// 🔧 CHANGE 1 — Helper to detect "real" mobile (touch + small viewport).
// Runs once on mount; we don't re-check on resize because the sheet's
// lifetime is too short for that to matter.
function isLikelyMobile() {
  if (typeof window === 'undefined') return false;
  const hasTouch    = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const isNarrowVP  = window.matchMedia?.('(max-width: 768px)')?.matches;
  // Both must be true — a touch-enabled laptop with a big screen
  // (Surface, ThinkPad Yoga) still doesn't have a usable rear camera
  // attached to <input capture>, so we treat it as desktop.
  return hasTouch && isNarrowVP;
}

const SOURCE_ORDER = {
  photo:          ['camera', 'gallery'],
  nid:            ['camera', 'gallery'],
  nidFront:       ['camera', 'gallery'],
  nidBack:        ['camera', 'gallery'],
  utility:        ['gallery', 'camera', 'file'],
  ownershipProof: ['gallery', 'camera', 'file'],
  professionProof:['file',   'gallery', 'camera'],
  default:        ['gallery', 'camera', 'file'],
};

const SOURCE_META = {
  camera: {
    icon: Camera,
    titleBn: 'ক্যামেরা থেকে তুলুন',
    titleEn: 'Take a new photo',
    descBn:  'এখনই একটা ছবি তুলুন',
    descEn:  'Capture with your camera',
    accent:  'from-rose-100 to-rose-50 text-[#ba0036]',
  },
  gallery: {
    icon: ImageIcon,
    titleBn: 'গ্যালারি থেকে নিন',
    titleEn: 'Pick from gallery',
    descBn:  'ফোনের সংরক্ষিত ছবি',
    descEn:  'Use an existing photo',
    accent:  'from-blue-100 to-blue-50 text-blue-600',
  },
  file: {
    icon: FileText,
    titleBn: 'ফাইল থেকে নিন (PDF)',
    titleEn: 'Choose a file (PDF)',
    descBn:  'PDF বা ডকুমেন্ট',
    descEn:  'PDF or document',
    accent:  'from-amber-100 to-amber-50 text-amber-700',
  },
};

const UploadSourceSheet = ({
  open,
  onClose,
  onFile,
  docType   = 'default',
  language  = 'বাংলা',
  uploading = false,
}) => {
  const isBn = language === 'বাংলা';

  const cameraRef  = useRef(null);
  const galleryRef = useRef(null);
  const fileRef    = useRef(null);

  // 🔧 CHANGE 2 — capture mobile state once. SSR-safe (defaults to
  // desktop, which is the safer fallback — never show a broken Camera
  // option to a user who can't use it).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { setIsMobile(isLikelyMobile()); }, []);

  // Lock body scroll while sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // 🔧 CHANGE 3 — filter out 'camera' from the order on desktop.
  // The full SOURCE_ORDER table stays untouched; we just drop the
  // entry at runtime. Cleaner than maintaining two parallel tables.
  const rawOrder    = SOURCE_ORDER[docType] || SOURCE_ORDER.default;
  const order       = isMobile ? rawOrder : rawOrder.filter((s) => s !== 'camera');
  const recommended = order[0];

  const pickSource = (source) => {
    const refMap = { camera: cameraRef, gallery: galleryRef, file: fileRef };
    refMap[source]?.current?.click();
  };

  const handleInputChange = (source) => (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) {
      onClose?.();
      onFile?.(f, source);
    } else {
      onClose?.();
    }
  };

  // Hidden inputs are ALWAYS rendered (both branches) so refs never detach.
  // Camera input only mounts on mobile — saves a wasted ref + makes it
  // obvious in DevTools that desktop won't have a capture-bound input.
  const hiddenInputs = (
    <>
      {isMobile && (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="absolute opacity-0 w-px h-px pointer-events-none overflow-hidden"
          onChange={handleInputChange('camera')}
        />
      )}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="absolute opacity-0 w-px h-px pointer-events-none overflow-hidden"
        onChange={handleInputChange('gallery')}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        className="absolute opacity-0 w-px h-px pointer-events-none overflow-hidden"
        onChange={handleInputChange('file')}
      />
    </>
  );

  if (!open && !uploading) {
    return hiddenInputs;
  }

  return (
    <>
      {hiddenInputs}

      <div
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-[fadeIn_180ms_ease-out]"
        onClick={(e) => { if (e.target === e.currentTarget && !uploading) onClose?.(); }}
      >
        <div className="w-full sm:max-w-md bg-white rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl pb-safe animate-[slideUp_220ms_cubic-bezier(0.16,1,0.3,1)] overflow-hidden">

          <div className="sm:hidden flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-gray-300" />
          </div>

          <div className="px-5 pt-3 pb-2 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ba0036] mb-1">
                {isBn ? 'ছবি বা ফাইল যোগ করুন' : 'Add a photo or file'}
              </p>
              <h3 className="text-lg font-black text-gray-900 tracking-tight">
                {isBn ? 'কীভাবে যোগ করবেন?' : 'How would you like to add it?'}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="p-1.5 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
              aria-label="Close"
            >
              <X size={18} className="text-gray-400" />
            </button>
          </div>

          {uploading ? (
            <div className="px-5 py-10 flex flex-col items-center gap-4">
              <Loader2 size={36} className="text-[#ba0036] animate-spin" />
              <p className="text-sm font-black text-gray-900">
                {isBn ? 'আপলোড হচ্ছে…' : 'Uploading…'}
              </p>
              <p className="text-[12px] font-bold text-gray-500 text-center max-w-xs">
                {isBn
                  ? 'একটু অপেক্ষা করুন। কানেকশন ভালো থাকলে কয়েক সেকেন্ড লাগবে।'
                  : 'Hang tight — should take a few seconds on a good connection.'}
              </p>
            </div>
          ) : (
            <div className="px-5 pt-2 pb-5 space-y-2.5">
              {order.map((source) => {
                const meta = SOURCE_META[source];
                if (!meta) return null;
                const isRecommended = source === recommended;
                const Icon = meta.icon;
                return (
                  <button
                    key={source}
                    type="button"
                    onClick={() => pickSource(source)}
                    className="w-full p-4 rounded-2xl bg-gray-50 hover:bg-white border-2 border-transparent hover:border-gray-200 active:scale-[0.99] transition-all flex items-center gap-4 text-left group"
                  >
                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${meta.accent} flex items-center justify-center shrink-0 shadow-sm`}>
                      <Icon size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-black text-gray-900 truncate">
                          {isBn ? meta.titleBn : meta.titleEn}
                        </p>
                        {isRecommended && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-widest">
                            {isBn ? 'সুপারিশকৃত' : 'Best'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-bold text-gray-500 mt-0.5 truncate">
                        {isBn ? meta.descBn : meta.descEn}
                      </p>
                    </div>
                    <ChevronUp size={16} className="text-gray-300 rotate-90 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
                  </button>
                );
              })}
            </div>
          )}

          {!uploading && (
            <div className="px-5 pb-5">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-sm transition-colors"
              >
                {isBn ? 'বাতিল করুন' : 'Cancel'}
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
};

export default UploadSourceSheet;