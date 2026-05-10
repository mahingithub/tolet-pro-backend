import React, { useState } from 'react';
import { 
  CheckCircle2, XCircle, Play, MapPin, DollarSign, 
  BedDouble, Bath, Square, User, ShieldAlert 
} from 'lucide-react';

// ─── Mock Data: Pending Properties ───
const initialPendingProperties = [
  {
    id: 101,
    title: 'Modern Duplex with Garden',
    location: 'Road 11, Banani, Dhaka',
    rent: '1,20,000',
    beds: 4,
    baths: 4,
    sqft: 3200,
    hostName: 'Sarah Islam',
    hostTrustScore: 98,
    // ভিডিও এবং ছবির ডেটা
    videoThumbnail: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=2000',
    images: [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=800',
      'https://images.unsplash.com/photo-1600607687931-ceeb269c5e31?q=80&w=800',
      'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?q=80&w=800'
    ]
  },
  {
    id: 102,
    title: 'Executive Studio Apartment',
    location: 'Block C, Bashundhara R/A',
    rent: '35,000',
    beds: 1,
    baths: 1,
    sqft: 850,
    hostName: 'Rahim Uddin',
    hostTrustScore: 75,
    videoThumbnail: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=2000',
    images: [
      'https://images.unsplash.com/photo-1502672260266-1c1e6ae0580c?q=80&w=800',
      'https://images.unsplash.com/photo-1493809842364-78817add7ff6?q=80&w=800'
    ]
  }
];

const PropertyModeration = () => {
  const [pendingList, setPendingList] = useState(initialPendingProperties);

  const handleAction = (id, actionType) => {
    // অ্যানিমেশন ফিল দেওয়ার জন্য একটু ডিলে করে লিস্ট থেকে রিমুভ করা
    setPendingList(prev => prev.filter(prop => prop.id !== id));
    console.log(`Property ${id} marked as ${actionType}`);
  };

  return (
    <div className="max-w-5xl mx-auto pt-4 pb-12">
      {/* ── পেজ হেডার ── */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Property Moderation</h1>
          <p className="text-sm font-bold text-gray-500 mt-2">
            Review and approve new listings. <span className="text-[#ba0036] bg-[#ba0036]/10 px-2 py-0.5 rounded-lg ml-1">{pendingList.length} Pending</span>
          </p>
        </div>
      </div>

      {/* ── মডারেশন লিস্ট ── */}
      <div className="space-y-8">
        {pendingList.length === 0 ? (
          <div className="bg-white rounded-[2rem] p-12 text-center shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="w-20 h-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={40} />
            </div>
            <h3 className="text-xl font-black text-gray-900">All Caught Up!</h3>
            <p className="text-gray-500 font-bold mt-2">No pending properties to review at the moment.</p>
          </div>
        ) : (
          pendingList.map((property) => (
            <div 
              key={property.id} 
              className="bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.06)] transition-all duration-300"
            >
              {/* ── ১. ভিডিও ফার্স্ট ভিউ (Top Priority) ── */}
              <div className="relative w-full h-[340px] bg-gray-900 rounded-2xl mb-4 overflow-hidden group cursor-pointer shadow-[0_8px_20px_rgba(0,0,0,0.1)]">
                <img 
                  src={property.videoThumbnail} 
                  alt="Video Thumbnail" 
                  className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700"
                />
                {/* Play Button Overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center shadow-[0_8px_30px_rgba(0,0,0,0.2)] group-hover:bg-[#ba0036] transition-colors duration-300">
                    <Play size={28} className="text-white ml-1" />
                  </div>
                </div>
                <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg flex items-center gap-2">
                  <Play size={12} className="text-[#ba0036]" /> Primary Video
                </div>
              </div>

              {/* ── ২. সাইড-বাই-সাইড গ্যালারি (Secondary) ── */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                {property.images.slice(0, 3).map((img, idx) => (
                  <div key={idx} className="h-32 rounded-xl overflow-hidden shadow-[0_4px_15px_rgba(0,0,0,0.04)]">
                    <img src={img} alt={`Gallery ${idx + 1}`} className="w-full h-full object-cover hover:scale-110 transition-transform duration-500" />
                  </div>
                ))}
              </div>

              {/* ── ৩. প্রপার্টি ডিটেইলস এবং অ্যাকশন বাটন ── */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 bg-[#eaeff5]/50 p-6 rounded-2xl">
                
                {/* Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)] px-3 py-1 rounded-lg text-xs font-black text-[#ba0036] flex items-center gap-1.5">
                      <DollarSign size={14} /> {property.rent}/mo
                    </span>
                    <span className="bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)] px-3 py-1 rounded-lg text-xs font-bold text-gray-600 flex items-center gap-1.5">
                      <User size={14} className="text-gray-400" /> Host: {property.hostName}
                    </span>
                    {property.hostTrustScore < 80 && (
                      <span className="bg-orange-50 px-3 py-1 rounded-lg text-xs font-bold text-orange-600 flex items-center gap-1.5">
                        <ShieldAlert size={14} /> Low Trust Score ({property.hostTrustScore})
                      </span>
                    )}
                  </div>

                  <h3 className="text-xl font-black text-gray-900 mb-2">{property.title}</h3>
                  <p className="flex items-center gap-1.5 text-sm font-bold text-gray-500 mb-4">
                    <MapPin size={16} className="text-gray-400" /> {property.location}
                  </p>

                  <div className="flex items-center gap-6 text-sm font-bold text-gray-600">
                    <span className="flex items-center gap-2"><BedDouble size={18} className="text-[#ba0036]/70" /> {property.beds} Beds</span>
                    <span className="flex items-center gap-2"><Bath size={18} className="text-[#ba0036]/70" /> {property.baths} Baths</span>
                    <span className="flex items-center gap-2"><Square size={18} className="text-[#ba0036]/70" /> {property.sqft} sqft</span>
                  </div>
                </div>

                {/* Actions (No borders, just vibrant colors and shadow) */}
                <div className="flex items-center gap-3 w-full md:w-auto">
                  <button 
                    onClick={() => handleAction(property.id, 'rejected')}
                    className="flex-1 md:flex-none px-6 py-4 bg-white text-gray-600 rounded-xl font-black text-sm shadow-[0_4px_15px_rgba(0,0,0,0.03)] hover:text-[#ba0036] hover:shadow-[0_8px_25px_rgba(186,0,54,0.1)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                  >
                    <XCircle size={18} /> Reject
                  </button>
                  <button 
                    onClick={() => handleAction(property.id, 'approved')}
                    className="flex-1 md:flex-none px-8 py-4 bg-gradient-to-r from-[#ba0036] to-[#d11147] text-white rounded-xl font-black text-sm shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.35)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={18} /> Approve Listing
                  </button>
                </div>

              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PropertyModeration;