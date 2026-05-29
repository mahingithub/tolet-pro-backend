import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  MapPin,
  ShieldCheck,
  BadgeCheck,
  Sparkles,
  ArrowRight,
  Heart,
  Star,
  Clock,
  Building2,
  ChevronRight,
  ChevronDown,
  Flame,
  Zap,
  Home as HomeIcon,
  Wallet,
  X,
  TrendingUp,
} from 'lucide-react';

import { useLanguage } from '../../context/LanguageContext';
import {
  DIVISIONS,
  POPULAR_AREAS,
  POPULAR_AREA_SUBZONES,
  ALL_SUGGESTIONS,
  RESIDENTIAL_TYPES,
  BUDGET_RANGES,
  getPropertyTypesFor,
  localizedLabel,
  filterLocationSuggestions,
  buildSearchUrl,
} from '../../data/searchData';
// Live data source — propertyService aggregates backend + user-uploaded
// properties. There is NO demo data anywhere; if a host hasn't uploaded yet,
// the feed is empty and we show an empty-state card.
import { propertyService, subscribeUserProperties, propertyLocationHaystack } from '../../services/Propertyservice';

/**
 * MobileHome — TO-LET PRO mobile (md:hidden) home page.
 *
 * Architecture note: this screen now imports its data + helpers from
 * src/data/searchData.js, the same module the desktop hero (HeroSection.jsx)
 * is being migrated onto. That removes the previous "mobile vs desktop
 * duplicate data" smell the user called out.
 *
 *   Search contract is identical to desktop:
 *     /properties/<location-slug>?purpose=<rent|buy|commercial>&category=<id>&budget=<id>
 *
 *   Property feed reads `propertyService.getProperties()` (single source of
 *   truth) — the same list the listings + details screens consume. There is
 *   no demo data anywhere.
 */

// Marketing banner — drop your campaign poster URL here.
const BANNER_IMAGE = 'https://besacenter.org/wp-content/uploads/2024/09/%D7%9C%D7%95%D7%A8%D7%9F-%D7%93%D7%92%D7%9F-%D7%91%D7%A0%D7%92%D7%9C%D7%93%D7%A9-scaled.jpg';

const SEARCH_TYPES = [
  { id: 'rent',       labelKey: 'tabRent' },
  { id: 'buy',        labelKey: 'tabBuy' },
  { id: 'commercial', labelKey: 'tabCommercial' },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Convert a property `date` / `createdAt` string into a real "days ago"
 *  count relative to NOW. No more synthetic reference date — every age you
 *  see on a card is the genuine upload age. */
const daysBetween = (a, b) => Math.max(0, Math.floor((b - a) / (1000 * 60 * 60 * 24)));
const computeDaysAgo = (dateStr) => {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return 0;
  return daysBetween(t, Date.now());
};

/** Friendly area label — strips "Dhaka" suffix when it's redundant. */
const friendlyArea = (loc = '') => {
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  // The middle token is usually the neighbourhood ("Road 12, Gulshan 2, Dhaka").
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || loc;
};

/** Maps a property's rentalCategory + type into the pill stack labels
 *  ("APARTMENT", "FAMILY FLAT") shown on the card. */
const cardLabels = (property, t) => {
  const typeMap = {
    apartment:   t.mobApartment,
    independent: t.mobApartment,
    duplex:      t.mobApartment,
    studio:      t.mobStudio,
    penthouse:   t.mobApartment,
  };
  const catMap = {
    family:          t.mobFamilyFlat,
    bachelor_male:   t.mobBachelor,
    bachelor_female: t.mobBachelor,
    sublet:          t.mobSublet,
    student:         t.mobStudent,
  };
  return {
    typeLabel: typeMap[property.type] || t.mobApartment,
    catLabel:  catMap[property.rentalCategory] || null,
  };
};

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

/**
 * Bottom-sheet picker used for Type + Budget. Renders a fixed overlay with
 * a draggable handle. Tap an option to select + close.
 */
const PickerSheet = ({ open, title, options, value, onPick, onClose, langKey }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end md:hidden bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full bg-white rounded-t-3xl pb-[calc(env(safe-area-inset-bottom)+1rem)] animate-in slide-in-from-bottom-10 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-3 pb-2 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="px-5 pb-3 flex items-center justify-between">
          <h3 className="text-base font-black text-gray-900">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-2 text-gray-500">
            <X size={18} />
          </button>
        </div>
        <div className="px-3 pb-2 max-h-[60vh] overflow-y-auto">
          {options.map((opt) => {
            const active = value?.id === opt.id;
            const lbl = localizedLabel(opt, langKey);
            return (
              <button
                key={opt.id}
                onClick={() => { onPick(opt); onClose(); }}
                className={`w-full flex items-center justify-between px-3 py-3 rounded-2xl text-left active:scale-[0.99] transition-transform ${
                  active ? 'bg-red-50 text-[#ba0036]' : 'hover:bg-gray-50 text-gray-800'
                }`}
              >
                <span className="text-[13px] font-bold">{lbl}</span>
                {active && <BadgeCheck size={16} className="text-[#ba0036]" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** Icon for a suggestion row, matching the desktop hero's vocabulary. */
const SuggestionIcon = ({ category }) => {
  if (category === 'search') return <TrendingUp size={13} className="text-[#ba0036]" />;
  if (category === 'city')   return <Building2  size={13} className="text-blue-500" />;
  return                            <MapPin    size={13} className="text-emerald-500" />;
};

/**
 * Trust card — eye-catching trust anchor below the search panel. Centered,
 * gradient-glow with three 3D "badge" tiles. Replaces the old pill-rail.
 */
const TrustRail = ({ t }) => {
  const badges = [
    { icon: BadgeCheck,  label: t.mobVerifiedHosts,
      iconBg: 'from-emerald-400 to-emerald-600',
      tint:   'shadow-[0_8px_22px_-10px_rgba(16,185,129,0.55)]' },
    { icon: ShieldCheck, label: t.mobSecurePrivate,
      iconBg: 'from-[#ff4d6d] to-[#ba0036]',
      tint:   'shadow-[0_8px_22px_-10px_rgba(186,0,54,0.55)]' },
    { icon: Zap,         label: t.mobInstantBooking,
      iconBg: 'from-amber-300 to-amber-500',
      tint:   'shadow-[0_8px_22px_-10px_rgba(245,158,11,0.55)]' },
  ];
  return (
    <div className="px-4 pt-4">
      <div
        className="relative overflow-hidden rounded-[26px] px-4 py-4 bg-white/85 backdrop-blur-2xl border border-white/70"
        style={{ boxShadow: '0 22px 60px -28px rgba(15,23,42,0.35), 0 0 0 1px rgba(255,255,255,0.45) inset' }}
      >
        {/* holographic glow */}
        <div
          className="absolute -top-12 -left-10 w-44 h-44 rounded-full opacity-50 pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(186,0,54,0.22), transparent 70%)' }}
        />
        <div
          className="absolute -bottom-14 -right-8 w-48 h-48 rounded-full opacity-50 pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(34,211,238,0.20), transparent 70%)' }}
        />

        <div className="relative flex items-center justify-center gap-1.5 mb-3">
          <Sparkles size={12} className="text-[#ba0036]" strokeWidth={3} />
          <span className="text-[9.5px] font-black uppercase tracking-[0.22em] text-gray-700">
            {t.mobTrustHeadline || 'Why renters trust us'}
          </span>
          <Sparkles size={12} className="text-[#ba0036]" strokeWidth={3} />
        </div>

        <div className="relative grid grid-cols-3 gap-2.5">
          {badges.map(({ icon: Icon, label, iconBg, tint }) => (
            <div key={label} className="flex flex-col items-center text-center">
              <div
                className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${iconBg} flex items-center justify-center text-white ring-1 ring-white/50 ${tint}`}
              >
                <Icon size={20} strokeWidth={2.6} />
              </div>
              <span className="mt-1.5 text-[10.5px] font-black text-gray-800 leading-tight">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Horizontally swipeable Explore Divisions strip. Tapping a card opens the
 * DivisionDistrictsSheet (modal of districts) since divisions themselves
 * don't contain homes — their districts do.
 */
const DivisionsStrip = ({ onPick, t }) => (
  <div className="pt-4">
    <div className="flex items-center justify-between px-4 mb-2.5">
      <div>
        <h3 className="text-[16px] font-black text-gray-900 tracking-tight">
          {t.mobExploreDivisions}
        </h3>
        <p className="text-[10.5px] text-gray-500 font-semibold mt-0.5">
          {t.mobExploreDivisionsSub}
        </p>
      </div>
    </div>

    <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory px-4 pb-2 -mr-4 pr-7">
      {DIVISIONS.map((d) => (
        <button
          key={d.id}
          onClick={() => onPick(d)}
          className="snap-start shrink-0 relative w-[170px] h-[210px] rounded-3xl overflow-hidden shadow-[0_14px_36px_-16px_rgba(15,23,42,0.45)] active:scale-[0.98] transition-transform group"
        >
          <img
            src={d.image}
            alt={d.name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/0" />
          <div className="absolute inset-0 ring-1 ring-inset ring-white/15 rounded-3xl pointer-events-none" />

          {d.hot && (
            <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[8.5px] font-black uppercase tracking-widest text-white shadow-[0_4px_12px_-4px_rgba(186,0,54,0.6)]"
              style={{ background: 'linear-gradient(135deg,#ba0036 0%,#ff4d6d 100%)' }}>
              <Flame size={9} strokeWidth={3} /> {t.mobHot}
            </span>
          )}

          <div className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white shadow-md">
            <ChevronRight size={13} strokeWidth={2.5} />
          </div>

          <div className="absolute bottom-0 inset-x-0 p-3.5">
            <span className="block text-[9px] font-black uppercase tracking-[0.18em] text-white/75 mb-1">
              {d.tagline}
            </span>
            <h4 className="text-white text-[19px] font-black tracking-tight leading-none drop-shadow-md">
              {d.name}
            </h4>
            <p className="text-white/80 text-[10.5px] font-semibold mt-1">
              {d.districts.length} {t.mobDistricts}
            </p>
          </div>
        </button>
      ))}
    </div>
  </div>
);

/**
 * Bottom-sheet modal listing every district inside a division. Tap a
 * district → navigates to /properties/<district-slug>.
 */
const DivisionDistrictsSheet = ({ division, onClose, onPickDistrict, t }) => {
  if (!division) return null;
  return (
    <div
      className="fixed inset-0 z-[85] flex items-end md:hidden bg-black/55 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full bg-white rounded-t-3xl pb-[calc(env(safe-area-inset-bottom)+1rem)] animate-in slide-in-from-bottom-10 duration-200 max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-32 shrink-0">
          <img src={division.image} alt={division.name} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/0" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white active:scale-95 transition-transform"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
            <div>
              <p className="text-[9.5px] font-black uppercase tracking-[0.2em] text-white/80">
                {division.tagline} · {t.mobDivisionText}
              </p>
              <h3 className="text-white text-[22px] font-black tracking-tight leading-none mt-1 drop-shadow-md">
                {division.name}
              </h3>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-white/80">
              {division.districts.length} {t.mobDistricts}
            </span>
          </div>
        </div>

        <div className="pt-3 pb-2 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-gray-300 -mt-1.5" />
        </div>
        <div className="px-4 pt-1 pb-3">
          <h4 className="text-[12px] font-black uppercase tracking-widest text-gray-500 mb-2">
            {t.mobPickDistrict}
          </h4>
          <div className="grid grid-cols-2 gap-2 overflow-y-auto" style={{ maxHeight: '40vh' }}>
            {division.districts.map((district) => (
              <button
                key={district}
                onClick={() => { onPickDistrict(district); onClose(); }}
                className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-50 to-white border border-gray-200 hover:border-[#ba0036]/40 hover:from-red-50 hover:to-white px-3 py-2.5 text-left active:scale-[0.98] transition-all"
              >
                <span className="block text-[12.5px] font-black text-gray-800 group-hover:text-[#ba0036] truncate">
                  {district}
                </span>
                <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                  {t.mobViewHomes}
                </span>
                <ChevronRight size={13} className="absolute top-1/2 -translate-y-1/2 right-3 text-gray-300 group-hover:text-[#ba0036] transition-colors" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * "Popular Areas" — futuristic bento. Each tile represents a popular area
 * (Dhanmondi, Gulshan, Banani, …). Tapping a tile opens a futuristic
 * bottom-sheet that lists every SUB-ZONE inside the area (Dhanmondi 1, 2,
 * 3, Lalmatia, Rayer Bazar; Gulshan 1, 2, Niketon; …). Picking a sub-zone
 * navigates to the property listing page filtered by that sub-zone —
 * NOT to a single property's details page. Matches the user's spec:
 *   "as soon as I click on Dhanmondi … all the areas of Dhanmondi …
 *    will be shown … and when he clicks there, on the property listing
 *    page, all the houses in that sub-zone will be shown."
 */
const PopularAreasBento = ({ t, onPickArea, properties = [] }) => {
  // Build (area, featuredProperty) pairs from the live properties feed so
  // each tile still has a nice cover image. When no listing matches a given
  // area yet, we skip the cover image and rely on the area name + 0-count
  // pill — no fake stock photo, no fake home count.
  const tiles = useMemo(() => {
    const lower = (s) => (s || '').toLowerCase();
    return POPULAR_AREAS.map((area) => {
      const a = lower(area);
      const matches = properties.filter((p) => lower(p.location).includes(a));
      const featured = matches[0] || properties[0] || null;
      return { area, property: featured, homeCount: matches.length };
    });
  }, [properties]);

  if (tiles.length === 0) return null;

  return (
    <section className="pt-4 pb-1">
      <div className="px-4 mb-2.5 flex items-center justify-between">
        <div>
          <h3 className="text-[16px] font-black text-gray-900 tracking-tight">
            {t.mobPopularAreas}
          </h3>
          <p className="text-[10.5px] text-gray-500 font-semibold mt-0.5">
            {t.mobPopularAreasSub}
          </p>
        </div>
      </div>

      {/* Futuristic edge-to-edge horizontal "sticker" rail. Each tile is a
          large angled card with a holographic ring + sub-zone count chip +
          area name. Tap → opens the sub-zone bottom-sheet. */}
      <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory px-4 pb-3 -mr-4 pr-7">
        {tiles.map(({ area, property, homeCount }, idx) => {
          const subzoneCount = POPULAR_AREA_SUBZONES[area]?.length || 0;
          // Pick the best available cover for this tile. When no host has
          // uploaded anything yet, `property` is null — fall back to a
          // gradient-only tile instead of crashing on `property.images[0]`.
          const cover = property
            ? (property.coverPhoto
              || property.img
              || (Array.isArray(property.images) && property.images[0])
              || (Array.isArray(property.roomPhotos) && (property.roomPhotos[0]?.url || property.roomPhotos[0]?.preview))
              || '')
            : '';
          return (
            <button
              key={area}
              onClick={() => onPickArea(area)}
              className="snap-start shrink-0 relative w-[200px] h-[260px] rounded-[28px] overflow-hidden active:scale-[0.98] transition-transform group"
              style={{
                boxShadow: '0 20px 50px -22px rgba(15, 23, 42, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.10) inset',
              }}
            >
              {cover ? (
                <img
                  src={cover}
                  alt={area}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
              ) : (
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(135deg, #1f2937 0%, #4c1d95 45%, #831843 100%)',
                  }}
                />
              )}

              {/* Holographic vignette + bottom darkening for legibility */}
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/85" />
              <div
                className="absolute inset-0 mix-blend-overlay opacity-50 pointer-events-none"
                style={{
                  background:
                    'conic-gradient(from 200deg at 70% 20%, rgba(186,0,54,0.55), rgba(168,85,247,0.45), rgba(34,211,238,0.45), rgba(186,0,54,0.55))',
                }}
              />
              <div className="absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/25 pointer-events-none" />

              {/* TOP-LEFT: rank chip with the area's number */}
              <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/40 text-white text-[9.5px] font-black uppercase tracking-[0.18em]">
                <Sparkles size={10} /> #{String(idx + 1).padStart(2, '0')}
              </div>

              {/* TOP-RIGHT: sub-zone count chip */}
              {subzoneCount > 0 && (
                <div className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 h-7 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white text-[9.5px] font-black uppercase tracking-[0.16em]">
                  {subzoneCount} {t.mobZones || 'zones'}
                </div>
              )}

              {/* BOTTOM: area name + homes count + arrow */}
              <div className="absolute bottom-0 inset-x-0 p-3.5">
                <span className="block text-[9px] font-black uppercase tracking-[0.22em] text-white/80 mb-1">
                  {t.mobPopularAreas}
                </span>
                <h4 className="text-white text-[20px] font-black tracking-tight leading-none drop-shadow-md">
                  {area}
                </h4>
                <div className="mt-2 flex items-center justify-between">
                  <div className="inline-flex items-baseline gap-1 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/30">
                    <span className="text-white text-[12px] font-black leading-none">
                      {homeCount}+
                    </span>
                    <span className="text-white/80 text-[8.5px] font-semibold leading-none">
                      {t.mobHomesShort || 'homes'}
                    </span>
                  </div>
                  <span className="w-7 h-7 rounded-full bg-white text-[#ba0036] flex items-center justify-center shadow-md">
                    <ArrowRight size={13} strokeWidth={2.5} />
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};

/**
 * AreaSubzonesSheet — futuristic bottom-sheet listing every sub-zone inside
 * a popular area. Picking a sub-zone routes to the listing page using the
 * SAME `buildSearchUrl` contract as the desktop hero (purpose=rent,
 * category=any, budget=any) so the listing page shows every home in that
 * sub-zone.
 */
const AreaSubzonesSheet = ({ area, onClose, t }) => {
  const navigate = useNavigate();
  if (!area) return null;
  const subzones = POPULAR_AREA_SUBZONES[area] || [];

  const handlePick = (sub) => {
    onClose();
    // Same handler the desktop search button uses → /properties/<slug>?...
    const url = buildSearchUrl({
      location: `${sub.name}, ${area}, Dhaka`,
      purpose: 'rent',
      categoryId: 'any',
      budgetId: 'any',
    });
    navigate(url);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-[fadeIn_0.2s_ease]" />

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-h-[85vh] rounded-t-[32px] overflow-hidden bg-gradient-to-b from-[#0b1320] via-[#161e36] to-[#0b1320] text-white shadow-[0_-30px_60px_-20px_rgba(0,0,0,0.6)] animate-[slideUp_0.32s_cubic-bezier(0.22,1,0.36,1)]"
      >
        {/* drag handle */}
        <div className="pt-2.5 flex justify-center">
          <span className="w-12 h-1.5 rounded-full bg-white/30" />
        </div>

        {/* header */}
        <div className="px-5 pt-3 pb-4 relative">
          <div
            className="absolute inset-x-0 top-0 h-32 pointer-events-none opacity-60"
            style={{
              background:
                'radial-gradient(closest-side at 50% 0%, rgba(186,0,54,0.45), transparent 70%)',
            }}
          />
          <div className="relative flex items-center justify-between">
            <div>
              <span className="text-[9.5px] font-black uppercase tracking-[0.24em] text-white/60">
                {t.mobChooseSubzone || 'Choose a sub-zone'}
              </span>
              <h3 className="mt-1 text-[22px] font-black leading-none tracking-tight">
                {area}
              </h3>
              <p className="mt-1 text-[11px] text-white/70 font-semibold">
                {subzones.length} {t.mobZones || 'zones'} · {t.mobTapToBrowse || 'tap to browse homes'}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 flex items-center justify-center text-white transition"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* sub-zone grid */}
        <div className="px-4 pb-7 overflow-y-auto max-h-[64vh]">
          <div className="grid grid-cols-2 gap-2.5">
            {subzones.map((sub, idx) => (
              <button
                key={sub.id}
                onClick={() => handlePick(sub)}
                className="relative overflow-hidden text-left px-3 py-3 rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 active:scale-[0.98] transition"
                style={{ boxShadow: '0 12px 30px -16px rgba(0,0,0,0.65)' }}
              >
                {/* corner index */}
                <span className="absolute top-2 right-2 text-[9px] font-black tracking-[0.18em] text-white/40">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                {/* glow */}
                <span
                  className="absolute -bottom-8 -right-8 w-20 h-20 rounded-full opacity-50 pointer-events-none"
                  style={{
                    background:
                      'radial-gradient(closest-side, rgba(186,0,54,0.55), transparent 70%)',
                  }}
                />
                <span className="relative inline-flex items-center gap-1.5 mb-1.5 px-2 py-0.5 rounded-full bg-[#ba0036]/20 border border-[#ba0036]/40 text-[9px] font-black uppercase tracking-[0.18em] text-[#ff7a98]">
                  <MapPin size={9} strokeWidth={3} />
                  {area}
                </span>
                <h4 className="relative text-[14px] font-black leading-tight text-white">
                  {sub.name}
                </h4>
                <p className="relative text-[10.5px] text-white/65 font-semibold mt-0.5 leading-tight">
                  {sub.tagline}
                </p>
                <span className="relative mt-2 inline-flex items-center gap-1 text-[10px] font-black tracking-wide text-white">
                  {t.mobBrowseHomes || 'Browse homes'}
                  <ArrowRight size={11} strokeWidth={3} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Brand-red landlord CTA card — encourages hosts to list a property.
 */
const LandlordCTA = ({ t }) => {
  const navigate = useNavigate();
  return (
    <div className="px-4 my-4">
      <button
        onClick={() => navigate('/list-property')}
        className="w-full relative overflow-hidden rounded-3xl p-5 text-left bg-gradient-to-br from-[#ba0036] via-[#d4143a] to-[#ff4d6d] shadow-[0_15px_40px_-15px_rgba(186,0,54,0.6)] active:scale-[0.98] transition-transform"
      >
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/10 rounded-full blur-xl" />
        <div className="absolute -bottom-12 -left-6 w-32 h-32 bg-white/10 rounded-full blur-xl" />
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0 border border-white/30">
            <Sparkles size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/80">
              {t.mobHavePropertyKicker}
            </p>
            <h4 className="text-white font-black text-base leading-tight mt-0.5">
              {t.mobHavePropertyTitle}
            </h4>
            <p className="text-white/85 text-[11px] font-semibold mt-0.5">
              {t.mobHavePropertySub}
            </p>
          </div>
          <div className="w-9 h-9 rounded-full bg-white text-[#ba0036] flex items-center justify-center shadow-lg shrink-0">
            <ArrowRight size={18} strokeWidth={2.5} />
          </div>
        </div>
      </button>
    </div>
  );
};

/**
 * Single property card — matches the screenshot the user shared:
 *
 *   ┌────────────────────────────────┬───────────────┐
 *   │  VERIFIED   ♡                   │   thumb 1     │
 *   │  APARTMENT                      ├───────────────┤
 *   │  FAMILY FLAT                    │   thumb 2     │
 *   │                                 ├───────────────┤
 *   │      big primary image          │   thumb 3     │
 *   └─────────────────────────────────┴───────────────┘
 *   Title  ★ rating
 *   Location · price/mo · beds · baths · sqft
 */
// Build a tiny per-room collage (one photo per category) so the right-hand
// thumb strip doesn't end up showing four bedrooms in a row when the host
// uploaded multiple. Falls back to the flat `images` list for older records.
const MOB_ROOM_ORDER = ['bedroom', 'bathroom', 'living', 'kitchen', 'other'];
const mobBuildCollage = (property) => {
  const seen = new Set();
  const tiles = [];
  if (Array.isArray(property.roomPhotos)) {
    for (const roomId of MOB_ROOM_ORDER) {
      const hit = property.roomPhotos.find(
        (p) => (p.room || 'other') === roomId && (p.url || p.preview),
      );
      if (hit) {
        tiles.push(hit.url || hit.preview);
        seen.add(roomId);
      }
    }
    for (const p of property.roomPhotos) {
      const r = p.room || 'other';
      if (!seen.has(r) && (p.url || p.preview)) {
        tiles.push(p.url || p.preview);
        seen.add(r);
      }
    }
  }
  const cover = property.coverPhoto || property.img || tiles[0] || (property.images || [])[0] || '';
  const remaining = tiles.filter((u) => u !== cover);
  if (remaining.length === 0 && Array.isArray(property.images)) {
    remaining.push(...property.images.filter((u) => u && u !== cover));
  }
  return { cover, thumbs: remaining.slice(0, 3) };
};

const PropertyCard = ({ property, t, landlord }) => {
  const navigate = useNavigate();
  const [liked, setLiked] = useState(false);
  const { typeLabel, catLabel } = cardLabels(property, t);

  const daysAgo = computeDaysAgo(property.date || property.createdAt);
  const ageLabel = daysAgo === 0
    ? t.mobNewToday
    : `${daysAgo} ${daysAgo === 1 ? t.mobDayAgo : t.mobDaysAgo}`;

  // Primary cover + one thumb per room category (max 3 thumbs). Pad with the
  // cover so the 3-tile right column stays visually balanced when there's
  // only one or two distinct rooms.
  const { cover: primary, thumbs: rawThumbs } = mobBuildCollage(property);
  const thumbs = [...rawThumbs, primary, primary].slice(0, 3);

  const go = () => navigate(`/property/${property.id}`);

  return (
    <article className="px-4 mb-5">
      <div
        onClick={go}
        className="bg-white rounded-[26px] overflow-hidden shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)] border border-gray-100 active:scale-[0.995] transition-transform cursor-pointer"
      >
        {/* IMAGE BLOCK — big image left, 3 thumbs right */}
        <div className="relative grid grid-cols-[1.7fr_1fr] gap-1 p-1 bg-white">
          {/* Primary image */}
          <div className="relative rounded-[20px] overflow-hidden bg-gray-100 aspect-[4/3.4]">
            <img
              src={primary}
              alt={property.title}
              loading="lazy"
              className="w-full h-full object-cover"
            />

            {/* TOP-LEFT: vertical pill stack — VERIFIED + APARTMENT + FAMILY FLAT */}
            <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5 z-10">
              {property.verified && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-[#ba0036] text-[10px] font-black uppercase tracking-wider shadow-md">
                  <ShieldCheck size={11} strokeWidth={2.6} />
                  {t.mobVerified}
                </span>
              )}
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-gray-900 text-white text-[10px] font-black uppercase tracking-wider shadow-md">
                {typeLabel}
              </span>
              {catLabel && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#ba0036] text-white text-[10px] font-black uppercase tracking-wider shadow-[0_6px_18px_-6px_rgba(186,0,54,0.55)]">
                  {catLabel}
                </span>
              )}
            </div>

            {/* TOP-RIGHT: heart button */}
            <button
              onClick={(e) => { e.stopPropagation(); setLiked((v) => !v); }}
              className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/85 backdrop-blur-md flex items-center justify-center shadow-md active:scale-90 transition-transform z-10"
              aria-label={liked ? 'Unlike' : 'Like'}
            >
              <Heart
                size={18}
                className={liked ? 'text-[#ba0036] fill-[#ba0036]' : 'text-gray-700'}
                strokeWidth={2.5}
              />
            </button>

            {/* BOTTOM-LEFT: posted age */}
            <div className="absolute bottom-3 left-3 inline-flex items-center gap-1 bg-black/55 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              <Clock size={10} />
              {ageLabel}
            </div>
          </div>

          {/* Right column — 3 stacked thumbs */}
          <div className="grid grid-rows-3 gap-1">
            {thumbs.map((src, i) => (
              <div key={i} className="relative rounded-[16px] overflow-hidden bg-gray-100">
                <img
                  src={src}
                  alt={`${property.title} ${i + 2}`}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {i === 2 && property.images.length > 4 && (
                  <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                    <span className="text-white text-[12px] font-black">
                      +{property.images.length - 4}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* INFO BLOCK */}
        <div className="px-4 pb-4 pt-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-[15px] font-black text-gray-900 leading-tight line-clamp-1">
              {property.title}
            </h4>
            <div className="shrink-0 inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full text-[11px] font-black">
              <Star size={11} className="fill-amber-500 text-amber-500" />
              {property.rating}
            </div>
          </div>

          <div className="flex items-center gap-1 mt-0.5 text-gray-500 text-[12px] font-semibold">
            <MapPin size={11} />
            {friendlyArea(property.location)}
          </div>

          <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-600 font-semibold">
            <span className="inline-flex items-center gap-1">
              <Building2 size={12} /> {property.beds} {t.mobBed} · {property.baths} {t.mobBath}
            </span>
            <span className="text-gray-300">·</span>
            <span>{property.sqft.toLocaleString('en-BD')} sqft</span>
          </div>

          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2 min-w-0">
              {landlord && (
                <img
                  src={landlord.avatar}
                  alt={landlord.name}
                  className="w-7 h-7 rounded-full object-cover border border-white shadow"
                />
              )}
              <span className="text-[11px] font-bold text-gray-700 truncate">
                {landlord?.name || ''}
              </span>
              <span className="text-[10px] text-gray-400 font-semibold shrink-0">
                · {property.reviews} {t.mobReviews}
              </span>
            </div>
            <div className="shrink-0 inline-flex items-baseline gap-1 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-2xl">
              <span className="text-[14px] font-black text-gray-900">
                ৳{property.price.toLocaleString('en-BD')}
              </span>
              <span className="text-[10px] text-gray-500 font-semibold">/{t.mobMonth}</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
const MobileHome = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const langKey = language === 'বাংলা' ? 'bn' : 'en';

  // ── Search-bar state ───────────────────────────────────────────────────
  const [searchType,  setSearchType]  = useState('rent');
  const [location,    setLocation]    = useState('');
  const [propType,    setPropType]    = useState(RESIDENTIAL_TYPES[0]);
  const [budget,      setBudget]      = useState(BUDGET_RANGES[0]);

  // Property-type list depends on the current Rent / Buy / Commercial tab.
  const activePropertyTypes = useMemo(() => getPropertyTypesFor(searchType), [searchType]);
  useEffect(() => {
    // Reset to the first option whenever the purpose changes (same UX as
    // desktop hero).
    setPropType(activePropertyTypes[0]);
  }, [searchType, activePropertyTypes]);

  // ── Feed filter state ──────────────────────────────────────────────────
  const [activeArea, setActiveArea] = useState(null);

  // ── Live property feed (no demo data) ──────────────────────────────────
  // Re-fetches on mount and whenever a property is uploaded from another tab
  // (e.g. Add Property writes to localStorage → subscribeUserProperties fires).
  const [properties, setProperties] = useState([]);
  const [landlordsById, setLandlordsById] = useState({});
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await propertyService.getProperties({}, 'Newest Listings');
        if (cancelled) return;
        const arr = Array.isArray(list) ? list : [];
        setProperties(arr);
        // Resolve a landlord per unique landlordId so each card can show an
        // avatar + name without one fetch per card render.
        const ids = [...new Set(arr.map((p) => p.landlordId).filter(Boolean))];
        const entries = await Promise.all(ids.map(async (id) => [id, await propertyService.getLandlord(id)]));
        if (!cancelled) {
          setLandlordsById(Object.fromEntries(entries.filter(([, v]) => v)));
        }
      } catch {
        if (!cancelled) { setProperties([]); setLandlordsById({}); }
      }
    };
    load();
    const unsub = subscribeUserProperties(load);
    return () => { cancelled = true; unsub && unsub(); };
  }, []);

  // ── Suggestion dropdown ────────────────────────────────────────────────
  const [isLocOpen, setIsLocOpen] = useState(false);
  const locInputRef = useRef(null);
  const locWrapperRef = useRef(null);

  const suggestions = useMemo(
    () => filterLocationSuggestions(location, {
      searchAnywhere: t.mobSearchAnywhere,
      location:       t.mobLocationLabel,
    }),
    [location, t.mobSearchAnywhere, t.mobLocationLabel],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const onClick = (e) => {
      if (locWrapperRef.current && !locWrapperRef.current.contains(e.target)) {
        setIsLocOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick);
    };
  }, []);

  const handleSuggestPick = (title) => {
    setLocation(title);
    setIsLocOpen(false);
    locInputRef.current?.blur();
  };

  // ── Bottom-sheets ──────────────────────────────────────────────────────
  const [typeOpen,   setTypeOpen]   = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [openDivision, setOpenDivision] = useState(null);
  const [openArea, setOpenArea] = useState(null); // Popular-area → sub-zone sheet

  const handleDistrictPick = (districtName) => {
    setOpenDivision(null);
    navigate(buildSearchUrl({
      location: districtName,
      purpose:  searchType,
      categoryId: propType.id,
      budgetId:   budget.id,
    }));
  };

  // Mirrors desktop HeroSection.handleSearch exactly.
  const handleSearch = () => {
    navigate(buildSearchUrl({
      location,
      purpose:  searchType,
      categoryId: propType.id,
      budgetId:   budget.id,
    }));
  };

  // ── Location-aware placeholder, matching desktop's logic ───────────────
  const locationPlaceholder = searchType === 'commercial'
    ? t.mobLocationPlaceholderCommercial
    : searchType === 'buy'
    ? t.mobLocationPlaceholderBuy
    : t.mobLocationPlaceholderRent;

  // ── Feed ───────────────────────────────────────────────────────────────
  // Show EVERY active property, sorted newest-first. The previous "last 2
  // days" window made the page look empty when only a handful of homes
  // were brand new — per the user's spec ("you can show the recently
  // released ones first and you can show all the ones that are active").
  const filteredFeed = useMemo(() => {
    const needle = (activeArea || '').trim().toLowerCase();
    return (properties || [])
      .map((p) => ({ ...p, _daysAgo: computeDaysAgo(p.date || p.createdAt) }))
      .filter((p) => {
        if (!needle) return true;
        // Match against every location-ish field — address line, area
        // dropdown, district, division, GPS address, title — so Dhanmondi
        // uploads picked from dropdowns surface when the tile is tapped.
        return propertyLocationHaystack(p).includes(needle);
      })
      .sort((a, b) => a._daysAgo - b._daysAgo);
  }, [properties, activeArea]);

  const sectionHeading = activeArea
    ? `${t.mobHomesIn} ${activeArea}`
    : t.mobRecentlyPosted;

  return (
    <div className="md:hidden bg-slate-50 min-h-screen pb-28">
      <style>{`.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}`}</style>

      {/* ───────── MARKETING BANNER ───────── */}
      <div className="px-4 pt-3">
        <div className="relative overflow-hidden rounded-3xl aspect-[16/10] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]">
          <img
            src={BANNER_IMAGE}
            alt={`${t.mobHeroLine1} ${t.mobHeroLine2}`}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-black/55" />
          <div className="absolute inset-0 px-5 py-5 flex flex-col justify-end">
            <h1 className="text-white text-[26px] leading-[1.1] font-black tracking-tight">
              {t.mobHeroLine1}<br />{t.mobHeroLine2}
            </h1>
            <p className="text-white/85 text-[12px] font-semibold mt-1.5">
              {t.mobHeroSubtitle}
            </p>
          </div>
        </div>
      </div>

      {/* ───────── SEARCH PANEL (glassmorphism) ───────── */}
      <div className="px-4 -mt-6 relative z-10">
        <div className="rounded-3xl shadow-[0_20px_50px_-20px_rgba(15,23,42,0.30)] p-3 bg-white/55 backdrop-blur-2xl backdrop-saturate-150 border border-white/70 ring-1 ring-white/40">
          {/* Rent / Buy / Commercial pill toggle */}
          <div className="flex items-center bg-gray-100 rounded-full p-1 mb-3">
            {SEARCH_TYPES.map((typ) => {
              const active = searchType === typ.id;
              return (
                <button
                  key={typ.id}
                  onClick={() => setSearchType(typ.id)}
                  className={`flex-1 py-2 text-[12px] font-black uppercase tracking-wider rounded-full transition-all ${
                    active
                      ? 'bg-[#ba0036] text-white shadow-[0_6px_16px_-6px_rgba(186,0,54,0.55)]'
                      : 'text-gray-600'
                  }`}
                >
                  {t[typ.labelKey]}
                </button>
              );
            })}
          </div>

          {/* Inline location input with live autocomplete dropdown
              (matches the desktop hero pattern — same data source, same
              behaviour). */}
          <div ref={locWrapperRef} className="relative mb-2">
            <div className="w-full flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2.5 focus-within:border-[#ba0036]/50 focus-within:ring-2 focus-within:ring-[#ba0036]/10 transition-all">
              <span className="w-9 h-9 rounded-xl bg-red-50 text-[#ba0036] flex items-center justify-center shrink-0">
                <MapPin size={16} strokeWidth={2.5} />
              </span>
              <div className="flex-1 min-w-0">
                <label className="block text-[9.5px] font-black text-gray-500 uppercase tracking-widest leading-tight">
                  {t.mobLocationLabel}
                </label>
                <input
                  ref={locInputRef}
                  value={location}
                  onChange={(e) => { setLocation(e.target.value); setIsLocOpen(true); }}
                  onFocus={() => setIsLocOpen(true)}
                  placeholder={locationPlaceholder}
                  className="w-full bg-transparent outline-none text-[13px] font-bold text-gray-900 placeholder-gray-400 leading-tight"
                  type="text"
                  inputMode="search"
                  autoComplete="off"
                />
              </div>
              {location && (
                <button
                  onClick={(e) => { e.stopPropagation(); setLocation(''); locInputRef.current?.focus(); }}
                  aria-label="Clear"
                  className="text-gray-400 active:scale-90 transition-transform shrink-0"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Autocomplete dropdown */}
            {isLocOpen && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-[0_20px_50px_-20px_rgba(15,23,42,0.35)] border border-gray-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                {location.trim() && (
                  <button
                    onClick={() => { handleSuggestPick(location.trim()); }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 text-left bg-red-50/60 hover:bg-red-50 active:bg-red-100 transition-colors border-b border-gray-100"
                  >
                    <span className="w-8 h-8 rounded-xl bg-[#ba0036] text-white flex items-center justify-center shrink-0">
                      <Search size={13} strokeWidth={2.6} />
                    </span>
                    <span className="text-[13px] font-black text-gray-900 truncate">
                      {t.mobSearchAnywhere}: “{location.trim()}”
                    </span>
                  </button>
                )}
                <p className="px-3.5 pt-2 pb-1 text-[9.5px] font-black uppercase tracking-[0.18em] text-gray-400">
                  {t.mobMatchingSuggestions}
                </p>
                <div className="max-h-[55vh] overflow-y-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleSuggestPick(s.title)}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    >
                      <span className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                        <SuggestionIcon category={s.category} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-black text-gray-900 truncate leading-tight">
                          {s.title}
                        </p>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate">
                          {s.type}
                        </p>
                      </div>
                      <ChevronRight size={13} className="text-gray-300 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Type + Budget row */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => setTypeOpen(true)}
              className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2.5 active:scale-[0.99] transition-transform text-left"
            >
              <HomeIcon size={14} className="text-[#ba0036] shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[9px] font-black text-gray-500 uppercase tracking-widest leading-tight">
                  {t.mobTypeLabel}
                </span>
                <span className="block text-[12px] font-black text-gray-900 leading-tight truncate">
                  {localizedLabel(propType, langKey)}
                </span>
              </span>
              <ChevronDown size={12} className="text-gray-400 shrink-0" />
            </button>

            <button
              onClick={() => setBudgetOpen(true)}
              className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2.5 active:scale-[0.99] transition-transform text-left"
            >
              <Wallet size={14} className="text-[#ba0036] shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[9px] font-black text-gray-500 uppercase tracking-widest leading-tight">
                  {t.mobBudgetLabel}
                </span>
                <span className="block text-[12px] font-black text-gray-900 leading-tight truncate">
                  {localizedLabel(budget, langKey)}
                </span>
              </span>
              <ChevronDown size={12} className="text-gray-400 shrink-0" />
            </button>
          </div>

          {/* Search button */}
          <button
            onClick={handleSearch}
            className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#ba0036] to-[#d4143a] text-white font-black uppercase tracking-widest text-[13px] py-3.5 rounded-2xl shadow-[0_10px_28px_-10px_rgba(186,0,54,0.6)] active:scale-[0.98] transition-transform"
          >
            <Search size={16} strokeWidth={2.5} />
            {t.mobSearchProperties}
          </button>
        </div>
      </div>

      {/* ───────── TRUST RAIL ───────── */}
      <TrustRail t={t} />

      {/* ───────── DIVISIONS STRIP ───────── */}
      <DivisionsStrip onPick={setOpenDivision} t={t} />

      {/* ───────── POPULAR AREAS — FUTURISTIC BENTO ─────────
          Tapping a tile opens the sub-zone bottom-sheet (Dhanmondi 1, 2,
          3, Lalmatia, …) — the user then picks a sub-zone, which routes
          to the property listing page filtered by that sub-zone. */}
      <PopularAreasBento t={t} onPickArea={setOpenArea} properties={properties} />

      {/* ───────── FEED HEADER ───────── */}
      <div className="flex items-center justify-between px-4 mt-3 mb-1">
        <div className="min-w-0">
          <h3 className="text-[16px] font-black text-gray-900 tracking-tight truncate">
            {sectionHeading}
          </h3>
          <p className="text-[11px] text-gray-500 font-semibold inline-flex items-center gap-1">
            <Clock size={11} className="text-[#ba0036]" strokeWidth={2.5} />
            {filteredFeed.length}{' '}
            {filteredFeed.length === 1
              ? (t.mobActiveHomeShown || 'active home — newest first')
              : (t.mobActiveHomesShown || 'active homes — newest first')}
          </p>
        </div>
        {activeArea && (
          <button
            onClick={() => setActiveArea(null)}
            className="shrink-0 text-[11px] font-bold text-[#ba0036] inline-flex items-center gap-0.5 active:scale-95 transition-transform"
          >
            {t.mobClearFilters} <X size={11} />
          </button>
        )}
      </div>

      {/* ───────── FEED ───────── */}
      {filteredFeed.length === 0 ? (
        <div className="mx-4 my-6 p-6 bg-white rounded-3xl border border-gray-100 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-[#ba0036] mx-auto flex items-center justify-center mb-3">
            <Search size={20} />
          </div>
          <h4 className="text-[14px] font-black text-gray-900">
            {t.mobNoHomesYet}
          </h4>
          <p className="text-[11px] text-gray-500 font-semibold mt-1 max-w-[260px] mx-auto">
            {t.mobNoHomesDesc}
          </p>
          <button
            onClick={() => setActiveArea(null)}
            className="mt-4 inline-flex items-center gap-1.5 bg-[#ba0036] text-white text-[12px] font-black px-4 py-2 rounded-full active:scale-95 transition-transform"
          >
            {t.mobClearFilters} <ArrowRight size={13} />
          </button>
        </div>
      ) : (
        <>
          {filteredFeed.slice(0, 2).map((p) => (
            <PropertyCard key={p.id} property={p} t={t} landlord={landlordsById[p.landlordId]} />
          ))}
          <LandlordCTA t={t} />
          {filteredFeed.slice(2).map((p) => (
            <PropertyCard key={p.id} property={p} t={t} landlord={landlordsById[p.landlordId]} />
          ))}
        </>
      )}

      {/* ───────── FOOTER TAGLINE ───────── */}
      <div className="text-center pt-2 pb-6 px-6 mt-3">
        <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
          <ShieldCheck size={12} className="text-[#ba0036]" />
          {t.mobEndToEndSecured}
        </div>
      </div>

      {/* ───────── BOTTOM SHEETS ───────── */}
      <PickerSheet
        open={typeOpen}
        title={t.mobTypeLabel}
        options={activePropertyTypes}
        value={propType}
        onPick={setPropType}
        onClose={() => setTypeOpen(false)}
        langKey={langKey}
      />
      <PickerSheet
        open={budgetOpen}
        title={t.mobBudgetLabel}
        options={BUDGET_RANGES}
        value={budget}
        onPick={setBudget}
        onClose={() => setBudgetOpen(false)}
        langKey={langKey}
      />
      <DivisionDistrictsSheet
        division={openDivision}
        onClose={() => setOpenDivision(null)}
        onPickDistrict={handleDistrictPick}
        t={t}
      />
      <AreaSubzonesSheet
        area={openArea}
        onClose={() => setOpenArea(null)}
        t={t}
      />
    </div>
  );
};

export default MobileHome;
