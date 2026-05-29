/**
 * InlineField.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Tap-to-edit field card. Shows the value statically with a tiny "edit"
 * pencil; tapping reveals an inline editor with Cancel + Save. Save is
 * optimistic (Twitter-style: instant feedback, roll back on error).
 * Real-time validation: state machine from `validators.js`.
 *
 * Visual states:
 *
 *   Idle:
 *     ┌─────────────────────────────────┐
 *     │ 📋 LABEL                    ✎   │
 *     │ Value here                       │
 *     └─────────────────────────────────┘
 *
 *   Editing:
 *     ┌─────────────────────────────────┐
 *     │ 📋 LABEL                         │
 *     │ [_input field_____________]      │
 *     │ [Cancel]            [Save]       │
 *     └─────────────────────────────────┘
 *
 *   Invalid:
 *     ┌─────────────────────────────────┐
 *     │ 📋 LABEL                         │
 *     │ [J______________________] ⚠️     │  ← red border
 *     │ ⚠ At least 2 characters          │  ← red helper
 *     └─────────────────────────────────┘
 *
 *   Saved (flash):
 *     ┌─────────────────────────────────┐
 *     │ 📋 LABEL                    ✅   │  ← green check for 1.5s
 *     │ Saved value                      │
 *     └─────────────────────────────────┘
 *
 * Props:
 *   label    — { bn, en } or string
 *   value    — current value
 *   onSave   — async (newValue) => void   (throws on failure for rollback)
 *   validator— optional fn from validators.js
 *   icon     — lucide icon component
 *   placeholder — { bn, en } or string
 *   type     — 'text' (default) | 'tel' | 'email' | 'number'
 *   language — 'বাংলা' | 'English'
 *   children — optional custom editor (used by WorkplaceAutocomplete to
 *              swap the default <input> for its dropdown UI)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Pencil, Check, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useValidation } from '../../utils/validators';

const InlineField = ({
  label,
  value,
  onSave,
  validator,
  icon: Icon,
  placeholder,
  type = 'text',
  language = 'বাংলা',
  required = false,
  // Optional render-prop for custom editors (autocomplete, etc.).
  // Signature: ({ value, onChange, onCommit, onCancel }) => JSX
  renderEditor,
  className = '',
}) => {
  const isBn = language === 'বাংলা';

  // Local edit state mirrors the prop value during editing. We commit on
  // save, rollback on cancel. This keeps the parent's state immutable
  // mid-edit so an external update (e.g. server-side trustScore recompute)
  // doesn't clobber what the user is typing.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value ?? '');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const inputRef = useRef(null);

  // Sync draft with external value changes (e.g. after a successful save
  // the parent updates `value`, and we reflect that on the next render).
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const { state, msg, onFocus, onBlur, onChange, reset } =
    useValidation(draft, validator, language);

  // Autofocus when entering edit mode.
  useEffect(() => {
    if (editing) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editing]);

  // Resolve label/placeholder to a string regardless of object/string shape.
  const labelText = typeof label === 'string'
    ? label
    : (isBn ? label?.bn : label?.en) || '';
  const placeholderText = typeof placeholder === 'string'
    ? placeholder
    : (isBn ? placeholder?.bn : placeholder?.en) || '';

  // Display value with light formatting (empty → em-dash).
  const display = value && String(value).trim() ? String(value) : '—';

  // ─── Save flow ──────────────────────────────────────────────────────
  const commit = useCallback(async (newValue = draft) => {
    setError('');
    // If a validator exists and the value is non-empty, must pass.
    if (validator) {
      const t = String(newValue || '').trim();
      if (t || required) {
        const r = validator(newValue);
        if (!r.ok) {
          setError(r.msg[isBn ? 'bn' : 'en'] || r.msg.en);
          return;
        }
      }
    }
    // Don't bother saving if nothing changed.
    if (String(newValue) === String(value ?? '')) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave?.(newValue);
      setEditing(false);
      reset();
      // Green check flash for ~1.5s
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      // Roll back — keep editor open so the user can retry.
      setError(err?.message || (isBn ? 'সংরক্ষণে সমস্যা হয়েছে।' : 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }, [draft, value, validator, required, onSave, isBn, reset]);

  const cancel = () => {
    setDraft(value ?? '');
    setError('');
    setEditing(false);
    reset();
  };

  // Enter to save, Escape to cancel.
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      cancel();
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────
  const borderClass =
    state === 'invalid' ? 'border-red-300 focus-within:border-red-500'
    : state === 'valid' ? 'border-emerald-300 focus-within:border-emerald-500'
    :                     'border-gray-200 focus-within:border-[#ba0036]';

  return (
    <div className={`group relative bg-white rounded-2xl border-2 ${borderClass} transition-colors ${className}`}>
      <div className="p-4">
        {/* Label row */}
        <div className="flex items-center gap-2 mb-1.5">
          {Icon && (
            <div className="w-6 h-6 rounded-lg bg-gray-50 flex items-center justify-center">
              <Icon size={11} className="text-gray-500" />
            </div>
          )}
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-500 flex-1">
            {labelText}
            {required && <span className="text-[#ba0036] ml-1">*</span>}
          </p>
          {/* Right-side status indicator */}
          {savedFlash && (
            <span className="flex items-center gap-1 text-[10px] font-black text-emerald-600">
              <CheckCircle2 size={11} /> {isBn ? 'সংরক্ষিত' : 'Saved'}
            </span>
          )}
          {state === 'valid' && !savedFlash && (
            <CheckCircle2 size={14} className="text-emerald-500" />
          )}
          {!editing && !savedFlash && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-lg hover:bg-gray-100 transition-opacity"
              aria-label={isBn ? 'সম্পাদনা করুন' : 'Edit'}
            >
              <Pencil size={12} className="text-gray-400" />
            </button>
          )}
        </div>

        {/* Body: value display OR editor */}
        {editing ? (
          <div className="space-y-2">
            {renderEditor ? (
              renderEditor({
                value: draft,
                onChange: (v) => { setDraft(v); onChange(); setError(''); },
                onCommit: commit,
                onCancel: cancel,
                inputRef,
              })
            ) : (
              <input
                ref={inputRef}
                type={type}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); onChange(); setError(''); }}
                onFocus={onFocus}
                onBlur={onBlur}
                onKeyDown={onKeyDown}
                placeholder={placeholderText}
                disabled={saving}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#ba0036] focus:bg-white transition-colors disabled:opacity-50"
              />
            )}

            {/* Inline validation message */}
            {state === 'invalid' && msg && (
              <p className="text-[11px] font-bold text-red-600 flex items-center gap-1">
                <AlertCircle size={11} /> {msg}
              </p>
            )}
            {error && (
              <p className="text-[11px] font-bold text-red-600 flex items-center gap-1">
                <AlertCircle size={11} /> {error}
              </p>
            )}

            {/* Cancel / Save */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="px-3 py-1.5 rounded-full text-[11px] font-black text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                <X size={11} /> {isBn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => commit()}
                disabled={saving || state === 'invalid'}
                className="ml-auto px-3 py-1.5 rounded-full text-[11px] font-black text-white bg-gradient-to-r from-[#ba0036] to-[#7a0024] hover:shadow-md disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                {saving ? (
                  <><Loader2 size={11} className="animate-spin" /> {isBn ? 'সংরক্ষণ…' : 'Saving…'}</>
                ) : (
                  <><Check size={11} /> {isBn ? 'সংরক্ষণ' : 'Save'}</>
                )}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full text-left text-sm font-black text-gray-900 hover:text-[#ba0036] transition-colors truncate"
          >
            {display}
          </button>
        )}
      </div>
    </div>
  );
};

export default InlineField;