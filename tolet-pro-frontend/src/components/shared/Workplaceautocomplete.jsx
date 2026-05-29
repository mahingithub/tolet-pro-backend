/**
 * WorkplaceAutocomplete.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * LinkedIn-style typeahead for the "Where do you work/study?" field.
 *
 * Behaviour:
 *   • User types 2+ characters → debounced search runs (150ms quiet time)
 *   • Dropdown shows matching workplaces, grouped by category
 *   • Each row: category-tinted icon + name (bilingual fallback) + city
 *   • Arrow keys navigate, Enter selects, Esc closes
 *   • Bottom "Use '<typed>'" row lets users escape the curated list
 *     (Bangladesh has thousands of SMEs we'll never enumerate)
 *   • Click outside dismisses dropdown
 *
 * Why grouping matters:
 *   When a user types "bra" they could mean BRAC (NGO), BRAC Bank, or
 *   BRAC University. Grouping reveals all three under separate headers
 *   so the user picks the right one quickly. Without grouping the list
 *   looks like a soup of similar names.
 *
 * Integration:
 *   Designed to be used as the `renderEditor` prop of <InlineField>:
 *
 *     <InlineField
 *       label={{ bn: 'কোথায় কাজ করেন?', en: 'Where do you work?' }}
 *       value={user.tenantProfile.workPlace}
 *       onSave={(v) => patchProfile({ workPlace: v })}
 *       renderEditor={(p) => (
 *         <WorkplaceAutocomplete
 *           value={p.value}
 *           onChange={p.onChange}
 *           onCommit={p.onCommit}
 *           onCancel={p.onCancel}
 *           language={language}
 *           inputRef={p.inputRef}
 *         />
 *       )}
 *     />
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, GraduationCap, Building2, Briefcase, Heart,
  Landmark, HandHeart, CornerDownLeft, X,
} from 'lucide-react';
import {
  searchWorkplaces, groupByCategory, WORKPLACE_CATEGORIES,
} from '../../data/workplaces';
import { useDebounced } from '../../utils/validators';

// Icon lookup keyed by the iconName strings in WORKPLACE_CATEGORIES.
// Pulled out of the data file so the data stays serialisable (will move
// cleanly to the backend later without lucide imports tagging along).
const ICONS = {
  GraduationCap, Building2, Briefcase, Heart, Landmark, HandHeart,
};

const WorkplaceAutocomplete = ({
  value,
  onChange,             // (newText: string) => void
  onSelect,             // optional: (workplaceObject) => void
  onCommit,             // called when the user picks something (from InlineField)
  onCancel,             // called on Escape (from InlineField)
  language = 'বাংলা',
  inputRef: externalRef,
  placeholder,
}) => {
  const isBn = language === 'বাংলা';

  const [open, setOpen]                 = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const debouncedQuery = useDebounced(value, 150);

  // Use the parent's ref if given, otherwise our own — InlineField wants
  // to focus the input from outside, so we expose the ref upward.
  const localRef = useRef(null);
  const inputRef = externalRef || localRef;
  const dropdownRef = useRef(null);

  // ─── Run search ─────────────────────────────────────────────────────
  const results = searchWorkplaces(debouncedQuery, { limit: 8 });
  const grouped = groupByCategory(results);
  // Flatten the grouped order back into a flat list for keyboard nav —
  // this matches the visual order top-to-bottom.
  const flatResults = [];
  for (const cat of Object.keys(grouped)) {
    for (const w of grouped[cat]) flatResults.push(w);
  }
  // +1 for the "use as typed" fallback row at the bottom.
  const totalRows = flatResults.length + 1;

  // Open the dropdown whenever the query is long enough to be meaningful.
  // We do NOT auto-open on just-focused-empty — that's nagging.
  useEffect(() => {
    if (debouncedQuery && String(debouncedQuery).trim().length >= 2) {
      setOpen(true);
      setHighlightIdx(0);
    } else {
      setOpen(false);
    }
  }, [debouncedQuery]);

  // ─── Click-outside to close ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!dropdownRef.current?.contains(e.target) &&
          !inputRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, inputRef]);

  // ─── Selection handlers ─────────────────────────────────────────────
  const pickWorkplace = useCallback((w) => {
    // Save the canonical display name (English by default — landlords
    // can search by either, so canonical English keeps the data clean
    // even when a Bengali user typed Bengali).
    onChange?.(w.name);
    onSelect?.(w);
    setOpen(false);
    // Auto-commit on selection so the user doesn't need a second click.
    setTimeout(() => onCommit?.(w.name), 0);
  }, [onChange, onSelect, onCommit]);

  const pickAsTyped = useCallback(() => {
    setOpen(false);
    onCommit?.(value);
  }, [onCommit, value]);

  // ─── Keyboard navigation ────────────────────────────────────────────
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (open) {
        setOpen(false);
        e.preventDefault();
        return;
      }
      onCancel?.();
      return;
    }
    if (!open) {
      if (e.key === 'Enter') onCommit?.(value);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % totalRows);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + totalRows) % totalRows);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx < flatResults.length) {
        pickWorkplace(flatResults[highlightIdx]);
      } else {
        pickAsTyped();
      }
    }
  };

  // Resolve a row's index within the flat list so we can highlight via
  // keyboard. The data passes through grouped rendering so we need this
  // mapping (vs the flat array's position).
  const flatIndexOf = (w) => flatResults.findIndex((r) => r.id === w.id);

  return (
    <div className="relative">
      {/* Input */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value || ''}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={() => {
            if (String(value || '').trim().length >= 2) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder || (isBn
            ? 'যেমন: যমুনা ব্যাংক, ঢাকা ইউনিভার্সিটি'
            : 'e.g. Jamuna Bank, Dhaka University')}
          className="w-full pl-9 pr-9 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 placeholder:text-gray-400 placeholder:font-medium focus:outline-none focus:border-[#ba0036] focus:bg-white transition-colors"
          autoComplete="off"
          spellCheck={false}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange?.('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-200 transition-colors"
            aria-label={isBn ? 'মুছুন' : 'Clear'}
          >
            <X size={12} className="text-gray-400" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          ref={dropdownRef}
          className="absolute top-full mt-1.5 left-0 right-0 z-50 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden max-h-80 overflow-y-auto animate-[fadeIn_120ms_ease-out]"
        >
          {flatResults.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Search size={20} className="text-gray-300 mx-auto mb-2" />
              <p className="text-[12px] font-bold text-gray-500">
                {isBn ? 'কোনো মিল পাওয়া যায়নি' : 'No matches found'}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">
                {isBn ? 'নিচের অপশন দিয়ে যেভাবে লিখেছেন সেভাবেই রাখুন।' : 'Use the option below to keep your typed value.'}
              </p>
            </div>
          ) : (
            <>
              {Object.keys(grouped).map((cat) => {
                const meta = WORKPLACE_CATEGORIES[cat];
                const Icon = ICONS[meta?.iconName] || Briefcase;
                return (
                  <div key={cat}>
                    {/* Category header */}
                    <div className="px-3 pt-2 pb-1 bg-gray-50/50 flex items-center gap-1.5">
                      <Icon size={10} className="text-gray-400" />
                      <span className="text-[9px] font-black uppercase tracking-[0.15em] text-gray-400">
                        {isBn ? meta.labelBn : meta.labelEn}
                      </span>
                    </div>
                    {grouped[cat].map((w) => {
                      const idx = flatIndexOf(w);
                      const active = idx === highlightIdx;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onMouseEnter={() => setHighlightIdx(idx)}
                          onClick={() => pickWorkplace(w)}
                          className={`w-full px-3 py-2.5 flex items-center gap-3 text-left transition-colors ${
                            active ? 'bg-rose-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            active ? 'bg-[#ba0036] text-white' : 'bg-white border border-gray-200 text-gray-500'
                          }`}>
                            <Icon size={13} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-black text-gray-900 truncate">
                              {isBn && w.nameBn ? w.nameBn : w.name}
                            </p>
                            {(w.city || (isBn && w.nameBn && w.name !== w.nameBn)) && (
                              <p className="text-[10px] font-bold text-gray-400 truncate">
                                {isBn && w.nameBn ? w.name : ''}{w.city ? (isBn && w.nameBn ? ' · ' : '') + w.city : ''}
                              </p>
                            )}
                          </div>
                          {active && <CornerDownLeft size={11} className="text-[#ba0036]" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}

          {/* "Use as-typed" fallback row */}
          {String(value || '').trim().length >= 2 && (
            <button
              type="button"
              onMouseEnter={() => setHighlightIdx(flatResults.length)}
              onClick={pickAsTyped}
              className={`w-full px-3 py-2.5 border-t border-gray-100 flex items-center gap-3 text-left transition-colors ${
                highlightIdx === flatResults.length ? 'bg-rose-50' : 'hover:bg-gray-50'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <CornerDownLeft size={13} className="text-gray-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-gray-500">
                  {isBn ? 'যেভাবে লিখেছেন সেভাবেই রাখুন' : 'Use what you typed'}
                </p>
                <p className="text-[12px] font-black text-gray-900 truncate">
                  "{value}"
                </p>
              </div>
            </button>
          )}
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};

export default WorkplaceAutocomplete;