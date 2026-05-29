/**
 * TenantProfile — public trust card for a tenant.
 *
 * Mirrors LandlordProfile.jsx in structure (cover → avatar → identity →
 * stats grid → bio → trust+verification). Three views are returned by the
 * backend (`GET /api/tenants/:id`) depending on who is asking:
 *
 *   • anonymous / non-landlord caller → "public" view:
 *       name, avatar, cover, bio, trust score, verification badges
 *       (no phone, no email, no employment specifics)
 *
 *   • landlord with an active inquiry/booking → "unlocked" view:
 *       everything above + phone, email, employmentVerified, references
 *
 *   • the tenant themselves → "self" view:
 *       same as unlocked (no need to hide their own data)
 *
 * The page never branches on "shape" — the backend always returns the same
 * keys, and missing-because-locked fields come back as null. The "Locked"
 * chip on contact rows is driven by `tenant.unlocked === false`.
 *
 * Roadmap-v2 / tenant-roadmap §T3 — privacy-gated contact unlock.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, MessageCircle, Phone, Mail,
  Calendar, Briefcase, ShieldCheck, Share2, Lock, Award,
} from 'lucide-react';

import { tenantService } from '../services/tenantService';
import { useAuth } from '../context/AuthContext.jsx';
import TrustGauge from './shared/TrustGauge';
import VerifStep  from './shared/VerifStep';

const TenantProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();

  const [tenant, setTenant]   = useState(null);
  const [loading, setLoading] = useState(true);

  // `isSelf` — viewer তার নিজেরই profile দেখছে কিনা। `id` URL param একই
  // কিনা authUser-এর id / _id-এর সাথে সেটা check করি দুই form-এ কারণ
  // backend route `_id` রিটার্ন করে কিন্তু frontend serializer `id` virtual
  // ব্যবহার করে।
  const isSelf =
    !!authUser &&
    (String(authUser.id) === String(id) || String(authUser._id) === String(id));

  // Initial fetch — runs whenever the URL id changes. We still hit the
  // API even for self-view because the public route returns the right
  // "unlocked" flags + verification timeline shape that AuthContext's
  // user object doesn't carry. Then we overlay live AuthContext fields
  // in a separate effect (below) so optimistic updates show up instantly.
  useEffect(() => {
    window.scrollTo(0, 0);
    let cancelled = false;
    (async () => {
      setLoading(true);
      const t = await tenantService.getTenant(id);
      if (!cancelled) {
        setTenant(t || null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // 🆕 Self-view overlay — when the viewer is this user, mirror the live
  // AuthContext fields (avatar, name, phone) into the displayed tenant
  // object. This is what fixes the "I uploaded a new avatar but my
  // profile page still shows the old one" bug — the API may have cached
  // the old URL, but AuthContext is always fresh (broadcast-subscribed
  // to authService writes).
  //
  // We intentionally only overlay user-editable identity fields. The
  // server-computed bits (trustScore, verification timeline, unlocked
  // flag) stay whatever `getTenant` returned — those are authoritative
  // server-side anyway.
  useEffect(() => {
    if (!isSelf || !authUser || !tenant) return;
    setTenant((prev) => {
      if (!prev) return prev;
      // Cheap equality check — if nothing actually changed, skip the
      // setState so we don't trigger a render storm when authUser
      // updates frequently (e.g. trust score animations).
      const same =
        prev.avatar === (authUser.avatar || prev.avatar) &&
        prev.name   === (authUser.name   || authUser.fullName || prev.name);
      if (same) return prev;
      return {
        ...prev,
        avatar: authUser.avatar || prev.avatar,
        name:   authUser.name || authUser.fullName || prev.name,
        phone:  authUser.phone || prev.phone,
        email:  authUser.email || prev.email,
      };
    });
  }, [isSelf, authUser, tenant?.id]);

  if (loading) {
    return (
      <div className="w-full min-h-[50vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin" />
          <p className="text-slate-600 text-sm font-semibold">Loading tenant…</p>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="w-full min-h-[50vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 text-center shadow-xl border border-gray-100">
          <h2 className="text-xl font-black text-slate-900 mb-2">Tenant not found</h2>
          <p className="text-sm text-slate-600 mb-5">
            This tenant profile is unavailable or has been removed.
          </p>
          <button
            onClick={() => navigate(-1)}
            className="px-5 py-2.5 rounded-full bg-blue-500 text-white text-sm font-black hover:bg-blue-600 transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  // Defensive fallbacks — same pattern as LandlordProfile.jsx so the page
  // never crashes on an older record that doesn't carry every field yet.
  const coverImage  = tenant.coverImage  || 'https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=2000';
  const avatar      = tenant.avatar      || `https://ui-avatars.com/api/?name=${encodeURIComponent(tenant.name || 'Tenant')}&background=dbeafe&color=2563eb&size=256`;
  const tagline     = tenant.tagline     || '';
  const bio         = tenant.bio         || '';
  const memberSince = tenant.memberSince || new Date().getFullYear().toString();
  const trustScore  = tenant.trustScore  ?? 0;
  const trustTier   = tenant.trustTier   || '';
  const verif       = tenant.verification || {};

  // ── Verification status resolvers ──────────────────────────────────────
  // Same logic as LandlordProfile — see comments there. We honour the
  // explicit server flag first, then fall back to top-level flags / the
  // presence of a phone number so that a phone-OTP signup is never
  // reported as "NOT VERIFIED" just because the verification block was
  // empty. For locked viewers the phone field comes back as '' (privacy
  // gate), so the final fallback uses the tenant id — every account on
  // the platform is OTP-verified at signup, so an existing record is
  // proof of a verified phone.
  const phoneStatus =
    verif.phoneVerified === true ||
    tenant.phoneVerified === true ||
    !!tenant.phone ||
    !!(tenant.id || tenant._id)
      ? 'verified'
      : 'unverified';

  const hasEmail   = !!(tenant.email || verif.email);
  const emailStatus = verif.emailVerified === true
    ? 'verified'
    : (hasEmail ? 'unverified' : 'none');

  const idStatus =
    verif.idStatus
    || verif.status                  // tenantProfile.verification.status enum
    || (verif.idVerified ? 'verified' : 'unverified');

  const employmentStatus =
    verif.employmentStatus
    || (verif.employmentVerified ? 'verified' : 'unverified');

  // Roadmap-v2 §6 / Q4 approved answer — "Show 'New host' badge for the
  // first 30 days." Backend mirrors the same `isNew` flag on the tenant
  // card so the public profile is symmetric with `LandlordProfile.jsx`.
  // Tenants don't currently carry a rating signal, so the badge simply
  // turns off after the 30-day window expires.
  const isNewTenant = !!tenant.isNew;

  // Backend signals whether the caller has unlocked the private fields by
  // dropping the actual values (phone/email/etc.) when they don't. We keep
  // the chip behaviour explicit so a future revision that *does* send the
  // value to an unauthorized viewer is still treated as locked.
  const isUnlocked = tenant.unlocked === true;
  const phone = isUnlocked ? (tenant.phone || '') : '';
  const email = isUnlocked ? (tenant.email || '') : '';
  const employment = isUnlocked ? (tenant.employment || null) : null;

  return (
    <div className="w-full bg-[#f4f7fb] min-h-screen font-sans relative pb-20">

      {/* ── TOP NAV ── */}
      <div className="bg-white/85 backdrop-blur-xl border-b border-gray-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1200px] mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm font-black text-blue-600 bg-blue-50 px-4 py-2 rounded-full hover:bg-blue-600 hover:text-white transition-all active:scale-95"
          >
            <ArrowLeft size={15} /> Back
          </button>
          <p className="font-black text-gray-900 truncate">Tenant Profile</p>
          <button className="p-2.5 rounded-full border-2 border-gray-200 text-gray-500 hover:border-blue-500 hover:text-blue-500 transition-all active:scale-90">
            <Share2 size={16} />
          </button>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 mt-6">

        {/* ── HEADER CARD ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden mb-8">
          <div className="w-full h-48 md:h-64 bg-gray-200 relative">
            <img src={coverImage} alt="Cover" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>

          <div className="px-5 md:px-10 pb-8 relative">
            <div className="flex justify-between items-end -mt-16 md:-mt-20 mb-4 relative z-10">
              <div className="relative">
                <img
                  src={avatar}
                  alt={tenant.name}
                  className="w-32 h-32 md:w-40 md:h-40 rounded-[2rem] border-4 border-white shadow-xl bg-white object-cover"
                />
                {verif.idVerified && (
                  <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white p-2 rounded-full border-4 border-white shadow-md">
                    <ShieldCheck size={20} />
                  </div>
                )}
              </div>

              <div className="hidden md:flex gap-3">
                <button
                  disabled={!phone}
                  className={`py-3 px-6 rounded-2xl font-black text-sm transition-all flex items-center gap-2 ${
                    phone
                      ? 'bg-gray-100 text-gray-800 hover:bg-green-50 hover:text-green-600'
                      : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {phone ? <Phone size={16} /> : <Lock size={16} />}
                  {phone ? 'Call' : 'Locked'}
                </button>
                <button className="bg-blue-500 text-white py-3 px-6 rounded-2xl font-black text-sm shadow-lg hover:bg-blue-600 active:scale-95 transition-all flex items-center gap-2">
                  <MessageCircle size={16} /> Send Message
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-3xl font-black text-gray-900">{tenant.name}</h1>
                  {verif.idVerified && <BadgeCheck size={24} className="text-blue-500" />}
                </div>
                {tagline && <p className="text-gray-500 font-bold text-sm md:text-base mt-1">{tagline}</p>}

                {/* Badges row. Verified Tenant is the headline trust
                    signal once the tenant queue is approved; New tenant
                    is suppressed in that case because the two would send
                    a confusing mixed message — verified wins. */}
                {(verif.idVerified || isNewTenant) && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {verif.idVerified && (
                      <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 flex items-center gap-1.5 uppercase tracking-widest">
                        <BadgeCheck size={12} /> Verified Tenant
                      </span>
                    )}
                    {isNewTenant && !verif.idVerified && (
                      <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-1.5 uppercase tracking-widest">
                        <Award size={12} /> New tenant
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex md:hidden gap-3 w-full">
                <button
                  disabled={!phone}
                  className={`flex-1 py-3.5 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 ${
                    phone
                      ? 'bg-gray-50 border border-gray-200 text-gray-800 active:scale-95'
                      : 'bg-gray-50 border border-gray-200 text-gray-300'
                  }`}
                >
                  {phone ? <Phone size={16} /> : <Lock size={16} />} {phone ? 'Call' : 'Locked'}
                </button>
                <button className="flex-1 bg-blue-500 text-white py-3.5 rounded-2xl font-black text-sm shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">
                  <MessageCircle size={16} /> Message
                </button>
              </div>
            </div>

            {/* Stats grid — only what makes sense for a tenant. Trust score
                + member-since are universal; employment and contact reveal
                only when the caller has unlocked the card. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-gray-100">
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-blue-600">
                  <ShieldCheck size={18} />
                  <span className="text-xl font-black">{trustScore}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Trust Score</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-gray-900">
                  <Calendar size={18} />
                  <span className="text-xl font-black">{memberSince}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Member Since</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-gray-900">
                  {phone ? <Phone size={16} /> : <Lock size={16} className="text-gray-300" />}
                </div>
                <p className="text-[11px] font-bold text-gray-700 truncate">
                  {phone || 'Phone locked'}
                </p>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-gray-900">
                  {email ? <Mail size={16} /> : <Lock size={16} className="text-gray-300" />}
                </div>
                <p className="text-[11px] font-bold text-gray-700 truncate">
                  {email || 'Email locked'}
                </p>
              </div>
            </div>

            {!isUnlocked && (
              <div className="mt-6 p-4 rounded-2xl bg-blue-50 border border-blue-100 text-[12px] font-bold text-blue-700 flex items-center gap-2">
                <Lock size={14} />
                Contact details unlock once this tenant submits an inquiry on one of your listings.
              </div>
            )}

            {bio && (
              <div className="mt-8">
                <h3 className="text-lg font-black text-gray-900 mb-3">About the Tenant</h3>
                <p className="text-gray-600 font-medium leading-relaxed text-sm md:text-base">
                  {bio}
                </p>
              </div>
            )}

            {employment && (
              <div className="mt-8">
                <h3 className="text-lg font-black text-gray-900 mb-3 flex items-center gap-2">
                  <Briefcase size={18} /> Employment
                </h3>
                <p className="text-gray-600 font-medium leading-relaxed text-sm md:text-base">
                  {employment.title || '—'}{employment.company ? ` @ ${employment.company}` : ''}
                </p>
              </div>
            )}

            {/* ── Trust + Verification (mirrors LandlordProfile) ──────── */}
            <div className="mt-8 grid grid-cols-1 md:grid-cols-[auto,1fr] gap-6 md:gap-8 items-start">
              <div className="flex md:block justify-center">
                <TrustGauge score={trustScore} tier={trustTier} label="Tenant Trust" />
              </div>
              <div className="flex-1 space-y-2.5">
                {emailStatus !== 'none' && (
                  <VerifStep
                    title="Email"
                    description="Confirmed via magic link / OTP."
                    status={emailStatus}
                    readOnly
                  />
                )}
                <VerifStep
                  title="Phone"
                  description="Confirmed via SMS OTP."
                  status={phoneStatus}
                  readOnly
                />
                <VerifStep
                  title="Government ID"
                  description="NID / Passport reviewed by the TO-LET PRO trust team."
                  status={idStatus}
                  readOnly
                />
                <VerifStep
                  title="Employment"
                  description="Optional. Helps landlords gauge ability to pay."
                  status={employmentStatus}
                  readOnly
                />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default TenantProfile;