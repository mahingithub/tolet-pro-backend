/**
 * ChipSelector.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Pill-shaped single- or multi-select control.
 *
 * Why a chip selector instead of a <select>?
 *   • All options are visible at a glance — no hidden dropdown
 *   • Touch-friendly on mobile (Uber/Airbnb-style)
 *   • Self-explanatory — labels are the affordance, no chevron needed
 *   • Multi-select works naturally (try doing that with native <select>)
 *
 * Used by:
 *   • Tenant profession picker (single)        — student / job / business / etc.
 *   • Tenant family size (single)              — 1 / 2 / 3 / 4+ persons
 *   • Tenant emergency-contact relation (single) — father / mother / sibling
 *   • Landlord preferred-tenants (multi)       — family / bachelor / student
 *   • Landlord communication channels (multi)  — phone / whatsapp / sms
 *
 * Props:
 *   options    : [{ value, label: { bn, en }, icon?: LucideComponent }]
 *   value      : selected value(s) — string (single) or string[] (multi)
 *   onChange   : (newValue) => void    — for multi gets a new array
 *   mode       : 'single' | 'multi'    — default 'single'
 *   language   : 'বাংলা' | 'English'   — default 'বাংলা'
 *   disabled   : boolean               — greys out the whole row
 *   columns    : number?               — force a grid (e.g. 2 for 2-col), otherwise wraps
 *
 * Accessibility:
 *   • role="radiogroup" (single) or "group" (multi)
 *   • Each chip has aria-pressed for multi, aria-checked for single
 *   • Keyboard: Tab into row, Space/Enter toggles
 */

import React from 'react';
import { Check } from 'lucide-react';

const ChipSelector = ({
  options = [],
  value,
  onChange,
  mode = 'single',
  language = 'বাংলা',
  disabled = false,
  columns,
}) => {
  const isBn   = language === 'বাংলা';
  const isMulti = mode === 'multi';

  // Normalise `value` so the rest of the component can treat it as a Set-lookup.
  // For single mode we wrap in a one-item array; for multi we coerce undefined to [].
  const selected = isMulti
    ? (Array.isArray(value) ? value : [])
    : (value != null ? [value] : []);
  const isSelected = (v) => selected.includes(v);

  const toggle = (v) => {
    if (disabled) return;
    if (isMulti) {
      // Toggle membership in the array. Order is preserved by always
      // appending on add — useful when caller wants "first picked" ordering.
      const next = isSelected(v)
        ? selected.filter((x) => x !== v)
        : [...selected, v];
      onChange?.(next);
    } else {
      // Single-mode: tapping the already-selected chip clears it. This
      // matches the "tap to deselect" pattern Airbnb uses for optional
      // filters. If the field is required, the parent will validate on save.
      onChange?.(isSelected(v) ? '' : v);
    }
  };

  // Grid columns are opt-in. Default to flex-wrap because the chip widths
  // vary (Bengali labels are often longer than English) and a flex row
  // gives a natural newspaper-column flow.
  const containerClass = columns
    ? `grid grid-cols-${columns} gap-2`
    : 'flex flex-wrap gap-2';

  return (
    <div
      role={isMulti ? 'group' : 'radiogroup'}
      className={containerClass}
      aria-disabled={disabled || undefined}
    >
      {options.map((opt) => {
        const active = isSelected(opt.value);
        const Icon = opt.icon;
        const label = (opt.label && (isBn ? opt.label.bn : opt.label.en)) || opt.value;

        // Color states:
        //   active   → brand red bg, white text, soft glow shadow
        //   idle     → light gray bg, dark gray text, hairline border
        //   hover    → slightly stronger gray bg + brand-tinted border
        //   disabled → opacity drop, no hover effects
        const base =
          'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-black ' +
          'transition-all duration-150 select-none border';
        const stateCls = active
          ? 'bg-[#ba0036] text-white border-[#ba0036] shadow-[0_4px_12px_rgba(186,0,54,0.25)]'
          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-white hover:border-[#ba0036]/40 hover:text-gray-900';
        const disabledCls = disabled
          ? 'opacity-50 cursor-not-allowed pointer-events-none'
          : 'cursor-pointer active:scale-[0.97]';

        return (
          <button
            key={opt.value}
            type="button"
            role={isMulti ? undefined : 'radio'}
            aria-checked={isMulti ? undefined : active}
            aria-pressed={isMulti ? active : undefined}
            disabled={disabled}
            onClick={() => toggle(opt.value)}
            className={`${base} ${stateCls} ${disabledCls}`}
          >
            {/* Check icon takes the place of an icon when active in multi mode —
                it's the universal "I picked this" affordance. In single mode
                we keep the original icon visible even when active (less clutter). */}
            {isMulti && active ? (
              <Check size={12} strokeWidth={3} />
            ) : Icon ? (
              <Icon size={12} strokeWidth={2.5} />
            ) : null}
            <span className="whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ChipSelector;