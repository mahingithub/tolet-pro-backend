import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, XCircle, MapPin, DollarSign,
  BedDouble, Bath, Square, User, ShieldAlert, RefreshCw, AlertCircle,
} from 'lucide-react';
import { listAdminProperties, moderateProperty } from '../services/adminService';

// Filter buttons surface every status the model supports today. Default
// to "active" so the moderation page shows what's currently live on the
// public site — that's what an admin reviewing for abusive listings
// actually needs.
const STATUS_TABS = [
  { value: 'active',   label: 'Active' },
  { value: 'paused',   label: 'Paused' },
  { value: 'rented',   label: 'Rented' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'draft',    label: 'Draft' },
];

const fmtMoney = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `৳${v.toLocaleString('en-IN')}`;
};

const PropertyModeration = () => {
  const [statusTab, setStatusTab] = useState('active');
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [actingId, setActingId]   = useState(null);

  const hydrate = async () => {
    setLoading(true);
    try {
      const data = await listAdminProperties({ status: statusTab, limit: 50 });
      setItems(Array.isArray(data.properties) ? data.properties : []);
      setError('');
    } catch (err) {
      setError(err?.message || 'Failed to load properties.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusTab]);

  const handleAction = async (id, action) => {
    setActingId(id);
    try {
      await moderateProperty(id, action);
      // Optimistically drop the row from the current list — when the
      // admin flips an active listing to rejected/removed it should
      // disappear from the "Active" tab immediately.
      setItems((prev) => prev.filter((p) => String(p._id || p.id) !== String(id)));
    } catch (err) {
      setError(err?.message || `Moderation failed (${action}).`);
    } finally {
      setActingId(null);
    }
  };

  const countLabel = useMemo(() => {
    if (loading) return 'Loading…';
    if (items.length === 0) return '0 in this tab';
    return `${items.length} in this tab`;
  }, [items.length, loading]);

  return (
    <div className="max-w-5xl mx-auto pt-4 pb-12">
      {/* ── পেজ হেডার ── */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Property Moderation</h1>
          <p className="text-sm font-bold text-gray-500 mt-2">
            Review listings on the platform.{' '}
            <span className="text-[#ba0036] bg-[#ba0036]/10 px-2 py-0.5 rounded-lg ml-1">
              {countLabel}
            </span>
          </p>
        </div>
        <button
          onClick={hydrate}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-gray-700 text-xs font-black shadow-sm hover:shadow-md transition-all self-start"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex flex-wrap gap-2 mb-6">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusTab(tab.value)}
            className={`px-4 py-2 rounded-xl text-xs font-black tracking-wide transition-all ${
              statusTab === tab.value
                ? 'bg-[#ba0036] text-white shadow-md'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="bg-red-50 text-red-700 text-sm font-bold p-4 rounded-2xl mb-6 flex items-center gap-2" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}

      {/* ── List ── */}
      <div className="space-y-6">
        {!loading && items.length === 0 ? (
          <div className="bg-white rounded-[2rem] p-12 text-center shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="w-20 h-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={40} />
            </div>
            <h3 className="text-xl font-black text-gray-900">All Caught Up!</h3>
            <p className="text-gray-500 font-bold mt-2">No properties in this tab.</p>
          </div>
        ) : (
          items.map((property) => {
            const id    = String(property._id || property.id);
            const cover = property.coverPhoto
              || (Array.isArray(property.roomPhotos) && property.roomPhotos[0]?.url)
              || (Array.isArray(property.images)     && property.images[0]?.url)
              || '';
            return (
              <div
                key={id}
                className="bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.06)] transition-all duration-300"
              >
                {/* Cover */}
                <div className="relative w-full h-[240px] bg-gray-900 rounded-2xl mb-4 overflow-hidden">
                  {cover ? (
                    <img src={cover} alt={property.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500 font-bold">
                      No cover photo
                    </div>
                  )}
                  <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg">
                    {property.status || 'unknown'}
                  </div>
                </div>

                {/* Info + actions */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 bg-[#eaeff5]/50 p-6 rounded-2xl">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <span className="bg-white shadow-sm px-3 py-1 rounded-lg text-xs font-black text-[#ba0036] flex items-center gap-1.5">
                        <DollarSign size={14} /> {fmtMoney(property.price)}/mo
                      </span>
                      <span className="bg-white shadow-sm px-3 py-1 rounded-lg text-xs font-bold text-gray-600 flex items-center gap-1.5">
                        <User size={14} className="text-gray-400" /> Host: {property.ownerName || '—'}
                      </span>
                      {Number(property.inquiries) > 0 ? (
                        <span className="bg-white shadow-sm px-3 py-1 rounded-lg text-xs font-bold text-gray-600">
                          {property.inquiries} inquiries
                        </span>
                      ) : null}
                    </div>

                    <h3 className="text-xl font-black text-gray-900 mb-2">{property.title}</h3>
                    <p className="flex items-center gap-1.5 text-sm font-bold text-gray-500 mb-4">
                      <MapPin size={16} className="text-gray-400" /> {property.location || property.address || '—'}
                    </p>

                    <div className="flex items-center gap-6 text-sm font-bold text-gray-600">
                      <span className="flex items-center gap-2"><BedDouble size={18} className="text-[#ba0036]/70" /> {property.beds ?? '—'} Beds</span>
                      <span className="flex items-center gap-2"><Bath size={18} className="text-[#ba0036]/70" /> {property.baths ?? '—'} Baths</span>
                      <span className="flex items-center gap-2"><Square size={18} className="text-[#ba0036]/70" /> {property.sqft ?? '—'} sqft</span>
                    </div>

                    {property.moderationReason ? (
                      <p className="text-xs font-bold text-orange-600 mt-3 flex items-center gap-1.5">
                        <ShieldAlert size={12} /> Reason: {property.moderationReason}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3 w-full md:w-auto">
                    {property.status === 'active' ? (
                      <button
                        onClick={() => handleAction(id, 'remove')}
                        disabled={actingId === id}
                        className="flex-1 md:flex-none px-6 py-3 bg-white text-gray-700 rounded-xl font-black text-sm shadow-sm hover:text-[#ba0036] hover:shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <XCircle size={18} /> Remove from public
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAction(id, 'approve')}
                        disabled={actingId === id}
                        className="flex-1 md:flex-none px-6 py-3 bg-gradient-to-r from-[#ba0036] to-[#d11147] text-white rounded-xl font-black text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <CheckCircle2 size={18} /> Restore to active
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default PropertyModeration;
