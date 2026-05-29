import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Star, BadgeCheck, MessageCircle, Phone,
  MapPin, Calendar, Clock, Award, ShieldCheck, Share2,
  BedDouble, Bath, Square,
} from 'lucide-react';

// Live data only — landlord + their properties come from propertyService.
// There is no demo landlord and no demo property list. Until a real host has
// signed up and listed something under this id, we render a friendly
// "not found" card rather than fake data.
import { propertyService } from '../services/Propertyservice';
import TrustGauge from './shared/TrustGauge';
import VerifStep  from './shared/VerifStep';

const LandlordProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [landlord, setLandlord] = useState(null);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.scrollTo(0, 0);
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ll, allProps] = await Promise.all([
          propertyService.getLandlord(id),
          propertyService.getProperties({}, 'Newest Listings'),
        ]);
        if (cancelled) return;
        setLandlord(ll || null);
        setProperties(
          (Array.isArray(allProps) ? allProps : []).filter(
            (p) => String(p.landlordId) === String(id),
          ),
        );
      } catch {
        if (!cancelled) { setLandlord(null); setProperties([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="w-full min-h-[50vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full border-4 border-[#ba0036]/30 border-t-[#ba0036] animate-spin" />
          <p className="text-slate-600 text-sm font-semibold">Loading landlord…</p>
        </div>
      </div>
    );
  }

  if (!landlord) {
    return (
      <div className="w-full min-h-[50vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 text-center shadow-xl border border-gray-100">
          <h2 className="text-xl font-black text-slate-900 mb-2">Landlord not found</h2>
          <p className="text-sm text-slate-600 mb-5">
            This landlord hasn't listed anything yet or their profile is unavailable.
          </p>
          <button
            onClick={() => navigate('/properties')}
            className="px-5 py-2.5 rounded-full bg-[#ba0036] text-white text-sm font-black hover:bg-[#7c0026] transition-colors"
          >
            Browse properties
          </button>
        </div>
      </div>
    );
  }

  // Landlord records may not include every optional field yet
  // (badges, coverImage, tagline). Fall back to sensible defaults instead of
  // crashing the page.
  const coverImage  = landlord.coverImage  || 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2000';
  const avatar      = landlord.avatar      || `https://ui-avatars.com/api/?name=${encodeURIComponent(landlord.name || 'Landlord')}&background=fce4ec&color=ba0036&size=256`;
  const tagline     = landlord.tagline     || '';
  const bio         = landlord.bio         || '';
  const badges      = landlord.badges      || [];
  const rating      = landlord.rating      || 0;
  const totalReviews = landlord.totalReviews || 0;
  const responseRate = landlord.responseRate ?? 0;
  const responseTime = landlord.responseTime || '—';
  const memberSince  = landlord.memberSince  || new Date().getFullYear().toString();
  const totalProperties = landlord.totalProperties ?? properties.length;
  // Roadmap-v2 §6 / Q4 approved answer — "Show 'New host' badge for the
  // first 30 days." Backend ships an `isNew` flag based on createdAt so
  // we never reason about dates client-side. Only render the badge while
  // the host has no rating signal yet, so it disappears the moment their
  // first review lands.
  const isNewHost = !!landlord.isNew && rating === 0 && totalReviews === 0;

  // Roadmap-v2 §6 surfaces the trust score + verification badges on the
  // public landlord card. The backend (controllers/landlord.controller.js)
  // ships the trust block and a normalised verification map so the page
  // can render them without recomputing anything.
  const trustScore   = landlord.trustScore   ?? 0;
  const trustTier    = landlord.trustTier    || '';
  const verification = landlord.verification || {};
  // Granular per-side blocks added by the dual-path refactor. Backwards-
  // compatible because the flat fields (status, addressVerified, …)
  // still live on the same `verification` object.
  const vTenant      = verification.tenant   || {};
  const vLandlord    = verification.landlord || {};

  // ── Verification status resolvers ──────────────────────────────────────
  // We accept multiple back-end shapes so the page doesn't show "NOT
  // VERIFIED" just because a particular field name didn't make it through
  // the landlord controller's serializer.
  //   • Phone: every signup goes through Firebase OTP, so a registered
  //     landlord is phone-verified by definition. We honour the explicit
  //     server flag first, then fall back to top-level `phoneVerified`,
  //     then to the presence of a phone, and finally to the landlord id
  //     itself (an account that exists is an account that completed OTP).
  //   • Email: only show "verified" if the server says so. If the user
  //     hasn't given an email yet, render a neutral "no email" state
  //     instead of a red "not verified" lock.
  //   • Government ID: backed by the verification sub-doc on the user
  //     record (status: 'unverified' | 'pending' | 'verified' | 'rejected').
  //   • Property Address: backed by the LANDLORD-side verification
  //     queue. This is what the utility bill submission proves — distinct
  //     from the tenant-side identity queue.
  const phoneStatus =
    verification.phoneVerified === true ||
    landlord.phoneVerified    === true ||
    !!landlord.phone ||
    !!(landlord.id || landlord._id)
      ? 'verified'
      : 'unverified';

  const hasEmail   = !!(landlord.email || verification.email);
  const emailStatus = verification.emailVerified === true
    ? 'verified'
    : (hasEmail ? 'unverified' : 'none');

  // Identity = tenant-side queue.
  const idStatus =
    vTenant.status
    || verification.idStatus
    || verification.status
    || (verification.idVerified ? 'verified' : 'unverified');

  // Property = landlord-side queue (utility bill + address).
  const addressStatus =
    vLandlord.status
    || verification.addressStatus
    || (verification.addressVerified ? 'verified' : 'unverified');

  // Strict "fully verified landlord" check — both queues green-lit. This
  // is what the headline blue tick keys off, and what unlocks the
  // "verified landlord" badge in property listings.
  const isFullyVerified = idStatus === 'verified' && addressStatus === 'verified';

  return (
    <div className="w-full bg-[#f4f7fb] min-h-screen font-sans relative pb-20">

      {/* ── TOP NAV ── */}
      <div className="bg-white/85 backdrop-blur-xl border-b border-gray-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1200px] mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm font-black text-[#ba0036] bg-red-50 px-4 py-2 rounded-full hover:bg-[#ba0036] hover:text-white transition-all active:scale-95"
          >
            <ArrowLeft size={15} /> Back
          </button>
          <p className="font-black text-gray-900 truncate">Landlord Profile</p>
          <button className="p-2.5 rounded-full border-2 border-gray-200 text-gray-500 hover:border-[#ba0036] hover:text-[#ba0036] transition-all active:scale-90">
            <Share2 size={16} />
          </button>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 mt-6">

        {/* ── PROFILE HEADER CARD ── */}
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
                  alt={landlord.name}
                  className="w-32 h-32 md:w-40 md:h-40 rounded-[2rem] border-4 border-white shadow-xl bg-white object-cover"
                />
                {landlord.verified && (
                  <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white p-2 rounded-full border-4 border-white shadow-md">
                    <ShieldCheck size={20} />
                  </div>
                )}
              </div>

              <div className="hidden md:flex gap-3">
                <button className="bg-gray-100 text-gray-800 py-3 px-6 rounded-2xl font-black text-sm hover:bg-green-50 hover:text-green-600 transition-all flex items-center gap-2">
                  <Phone size={16} /> Call
                </button>
                <button className="bg-[#ba0036] text-white py-3 px-6 rounded-2xl font-black text-sm shadow-lg hover:bg-[#90002a] active:scale-95 transition-all flex items-center gap-2">
                  <MessageCircle size={16} /> Send Message
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-3xl font-black text-gray-900">{landlord.name}</h1>
                  {landlord.verified && <BadgeCheck size={24} className="text-blue-500" />}
                </div>
                {tagline && <p className="text-gray-500 font-bold text-sm md:text-base mt-1">{tagline}</p>}

                {/* Roadmap-v2 §6 / Q4 approved — "New host" badge appears
                    for the first 30 days while the rating pipeline is
                    still empty. Backend `landlord.isNew` is the source
                    of truth; the badge disappears the moment a review
                    lands or the 30-day window closes. */}
                {/* Badges row. Verified Landlord is the headline trust
                    signal once both queues green-lit; New Landlord is
                    suppressed in that case because "new + verified"
                    sends a confusing mixed message — verified wins. */}
                {(landlord.verified || (isNewHost && !landlord.verified) || badges.length > 0) && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {landlord.verified && (
                      <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 flex items-center gap-1.5 uppercase tracking-widest">
                        <BadgeCheck size={12} /> Verified Landlord
                      </span>
                    )}
                    {isNewHost && !landlord.verified && (
                      <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-1.5 uppercase tracking-widest">
                        <Award size={12} /> New landlord
                      </span>
                    )}
                    {badges.map((badge, i) => (
                      <span key={i} className="text-[11px] font-black px-3 py-1.5 rounded-full bg-red-50 text-[#ba0036] border border-red-100 flex items-center gap-1.5 uppercase tracking-widest">
                        <Award size={12} /> {badge}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex md:hidden gap-3 w-full">
                <button className="flex-1 bg-gray-50 border border-gray-200 text-gray-800 py-3.5 rounded-2xl font-black text-sm active:scale-95 transition-all flex items-center justify-center gap-2">
                  <Phone size={16} /> Call
                </button>
                <button className="flex-1 bg-[#ba0036] text-white py-3.5 rounded-2xl font-black text-sm shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">
                  <MessageCircle size={16} /> Message
                </button>
              </div>
            </div>

            {/* Trust Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-gray-100">
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Star size={18} className="fill-yellow-400 text-yellow-400" />
                  <span className="text-xl font-black text-gray-900">{rating}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">({totalReviews} Reviews)</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-green-600">
                  <span className="text-xl font-black">{responseRate}%</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Response Rate</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-gray-900">
                  <Clock size={18} />
                  <span className="text-xl font-black">{responseTime}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Avg. Reply</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-gray-900">
                  <Calendar size={18} />
                  <span className="text-xl font-black">{memberSince}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Member Since</p>
              </div>
            </div>

            {bio && (
              <div className="mt-8">
                <h3 className="text-lg font-black text-gray-900 mb-3">About the Landlord</h3>
                <p className="text-gray-600 font-medium leading-relaxed text-sm md:text-base">
                  {bio}
                </p>
              </div>
            )}

            {/* ── Trust + Verification (roadmap-v2 §6) ───────────────────
                Read-only on the public card: anyone visiting /landlord/:id
                sees the gauge and the verification badges, but the upload
                CTA only appears on the host's own dashboard. */}
            <div className="mt-8 grid grid-cols-1 md:grid-cols-[auto,1fr] gap-6 md:gap-8 items-start">
              <div className="flex md:block justify-center">
                <TrustGauge score={trustScore} tier={trustTier} label="Landlord Trust" />
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
                  title="Property Verified"
                  description={
                    vLandlord.propertyAddress
                      ? `Utility bill matched to ${vLandlord.propertyAddress}.`
                      : 'Utility bill matched to the registered address.'
                  }
                  status={addressStatus}
                  readOnly
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── ACTIVE LISTINGS ── */}
        <div className="mb-10">
          <h2 className="text-2xl font-black text-gray-900 mb-6">
            Active Properties <span className="text-gray-400 text-lg">({totalProperties})</span>
          </h2>

          {properties.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
              <p className="text-sm text-slate-600 font-semibold">
                This landlord hasn't published any active listings yet.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {properties.map((property) => {
                const cover = property.coverPhoto || property.img || (property.images || [])[0];
                return (
                  <motion.div
                    key={property.id}
                    whileHover={{ y: -5 }}
                    className="bg-white rounded-[2rem] overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl transition-all cursor-pointer group"
                    onClick={() => navigate(`/property/${property.id}`)}
                  >
                    <div className="h-48 relative overflow-hidden bg-gray-100">
                      {cover && (
                        <img src={cover} alt={property.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      )}
                      {property.type && (
                        <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black text-gray-900 uppercase tracking-widest">
                          {property.type}
                        </div>
                      )}
                    </div>

                    <div className="p-5">
                      <h3 className="text-lg font-black text-gray-900 mb-2 line-clamp-1">{property.title}</h3>
                      <p className="flex items-center gap-1.5 text-xs font-bold text-gray-500 mb-4 truncate">
                        <MapPin size={14} className="text-[#ba0036]" /> {property.location}
                      </p>

                      <div className="flex items-center gap-4 text-xs font-bold text-gray-600 mb-5">
                        {property.beds != null && <span className="flex items-center gap-1"><BedDouble size={14} /> {property.beds}</span>}
                        {property.baths != null && <span className="flex items-center gap-1"><Bath size={14} /> {property.baths}</span>}
                        {property.sqft != null && <span className="flex items-center gap-1"><Square size={14} /> {property.sqft} sqft</span>}
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                        <p className="text-xl font-black text-[#ba0036]">
                          ৳{Number(property.price || 0).toLocaleString('en-IN')}<span className="text-xs text-gray-400 font-bold">/mo</span>
                        </p>
                        <button className="bg-red-50 text-[#ba0036] px-4 py-2 rounded-xl font-black text-xs hover:bg-[#ba0036] hover:text-white transition-colors">
                          View Details
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default LandlordProfile;