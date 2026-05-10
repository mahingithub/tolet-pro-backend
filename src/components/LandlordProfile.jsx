import React, { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  ArrowLeft, Star, BadgeCheck, MessageCircle, Phone, 
  MapPin, Calendar, Clock, Award, ShieldCheck, Share2, 
  BedDouble, Bath, Square
} from 'lucide-react';

// ─── MOCK DATA (আপনার আসল ডাটাবেস বা API থেকে এগুলো আসবে) ───
const landlordsData = {
  1: {
    id: 1, name: 'Rahman Syndicate', tagline: 'Premium Property Management in Dhaka',
    avatar: 'https://ui-avatars.com/api/?name=Rahman+Syndicate&background=fce4ec&color=ba0036&size=256',
    coverImage: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2000',
    rating: 4.9, totalReviews: 248, memberSince: '2018',
    responseRate: 98, responseTime: '< 1 hour', verified: true, totalProperties: 12,
    bio: 'A trusted premium property management firm in Dhaka since 2018. We specialize in family and executive apartments across Gulshan, Banani & Baridhara. Our priority is providing hassle-free renting and top-notch maintenance services to all our tenants.',
    badges: ['Top Landlord 2026', 'Verified Business', 'Fast Responder'],
  }
};

const landlordProperties = [
  {
    id: 1, title: 'Luxurious 4BHK Family Flat in Gulshan', location: 'Road 12, Gulshan 2, Dhaka',
    price: 120000, beds: 4, baths: 4, sqft: 2500, type: 'Apartment',
    image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=800',
  },
  {
    id: 2, title: 'Premium 3BHK Family Apartment in Banani', location: 'Block C, Banani, Dhaka',
    price: 85000, beds: 3, baths: 3, sqft: 1800, type: 'Apartment',
    image: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?q=80&w=800',
  }
];

const LandlordProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  
  // URL ID অনুযায়ী ডাটা ফেচ করা (এখানে মক ডাটা ব্যবহার করা হয়েছে)
  const landlord = landlordsData[id] || landlordsData[1];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  if (!landlord) return <div className="text-center py-20 text-xl font-bold">Landlord not found!</div>;

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
          {/* Cover Image */}
          <div className="w-full h-48 md:h-64 bg-gray-200 relative">
            <img src={landlord.coverImage} alt="Cover" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>

          <div className="px-5 md:px-10 pb-8 relative">
            {/* Avatar (Negative Margin to float over cover) */}
            <div className="flex justify-between items-end -mt-16 md:-mt-20 mb-4 relative z-10">
              <div className="relative">
                <img 
                  src={landlord.avatar} 
                  alt={landlord.name} 
                  className="w-32 h-32 md:w-40 md:h-40 rounded-[2rem] border-4 border-white shadow-xl bg-white object-cover"
                />
                {landlord.verified && (
                  <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white p-2 rounded-full border-4 border-white shadow-md">
                    <ShieldCheck size={20} />
                  </div>
                )}
              </div>
              
              {/* Action Buttons (Desktop) */}
              <div className="hidden md:flex gap-3">
                <button className="bg-gray-100 text-gray-800 py-3 px-6 rounded-2xl font-black text-sm hover:bg-green-50 hover:text-green-600 transition-all flex items-center gap-2">
                  <Phone size={16} /> Call
                </button>
                <button className="bg-[#ba0036] text-white py-3 px-6 rounded-2xl font-black text-sm shadow-lg hover:bg-[#90002a] active:scale-95 transition-all flex items-center gap-2">
                  <MessageCircle size={16} /> Send Message
                </button>
              </div>
            </div>

            {/* Profile Info */}
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-3xl font-black text-gray-900">{landlord.name}</h1>
                  {landlord.verified && <BadgeCheck size={24} className="text-blue-500" />}
                </div>
                <p className="text-gray-500 font-bold text-sm md:text-base mt-1">{landlord.tagline}</p>
                
                {/* Badges */}
                <div className="flex flex-wrap gap-2 mt-4">
                  {landlord.badges.map((badge, i) => (
                    <span key={i} className="text-[11px] font-black px-3 py-1.5 rounded-full bg-red-50 text-[#ba0036] border border-red-100 flex items-center gap-1.5 uppercase tracking-widest">
                      <Award size={12} /> {badge}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Buttons (Mobile) */}
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
                  <span className="text-xl font-black text-gray-900">{landlord.rating}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">({landlord.totalReviews} Reviews)</p>
              </div>
              
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-green-600">
                  <span className="text-xl font-black">{landlord.responseRate}%</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Response Rate</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-gray-900">
                  <Clock size={18} />
                  <span className="text-xl font-black">{landlord.responseTime}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Avg. Reply</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-gray-900">
                  <Calendar size={18} />
                  <span className="text-xl font-black">{landlord.memberSince}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Member Since</p>
              </div>
            </div>

            {/* Bio Section */}
            <div className="mt-8">
              <h3 className="text-lg font-black text-gray-900 mb-3">About the Landlord</h3>
              <p className="text-gray-600 font-medium leading-relaxed text-sm md:text-base">
                {landlord.bio}
              </p>
            </div>
          </div>
        </div>

        {/* ── ACTIVE LISTINGS (PROPERTIES) ── */}
        <div className="mb-10">
          <h2 className="text-2xl font-black text-gray-900 mb-6">
            Active Properties <span className="text-gray-400 text-lg">({landlord.totalProperties})</span>
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {landlordProperties.map((property) => (
              <motion.div 
                key={property.id}
                whileHover={{ y: -5 }}
                className="bg-white rounded-[2rem] overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl transition-all cursor-pointer group"
                onClick={() => navigate(`/property/${property.id}`)}
              >
                {/* Property Image */}
                <div className="h-48 relative overflow-hidden">
                  <img src={property.image} alt={property.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black text-gray-900 uppercase tracking-widest">
                    {property.type}
                  </div>
                </div>
                
                {/* Property Info */}
                <div className="p-5">
                  <h3 className="text-lg font-black text-gray-900 mb-2 line-clamp-1">{property.title}</h3>
                  <p className="flex items-center gap-1.5 text-xs font-bold text-gray-500 mb-4 truncate">
                    <MapPin size={14} className="text-[#ba0036]" /> {property.location}
                  </p>
                  
                  {/* Features */}
                  <div className="flex items-center gap-4 text-xs font-bold text-gray-600 mb-5">
                    <span className="flex items-center gap-1"><BedDouble size={14} /> {property.beds}</span>
                    <span className="flex items-center gap-1"><Bath size={14} /> {property.baths}</span>
                    <span className="flex items-center gap-1"><Square size={14} /> {property.sqft} sqft</span>
                  </div>
                  
                  {/* Price & Action */}
                  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    <p className="text-xl font-black text-[#ba0036]">
                      ৳{property.price.toLocaleString('en-IN')}<span className="text-xs text-gray-400 font-bold">/mo</span>
                    </p>
                    <button className="bg-red-50 text-[#ba0036] px-4 py-2 rounded-xl font-black text-xs hover:bg-[#ba0036] hover:text-white transition-colors">
                      View Details
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default LandlordProfile;