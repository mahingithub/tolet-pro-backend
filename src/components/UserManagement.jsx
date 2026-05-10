import React, { useState } from 'react';
import { 
  Users, ShieldAlert, CheckCircle2, XCircle, Search, 
  Filter, MoreVertical, ShieldCheck, ScanFace, FileText,
  UserCheck, AlertTriangle
} from 'lucide-react';

// ─── Mock Data ───
const pendingKYC = [
  {
    id: 1,
    name: 'Rahim Uddin',
    role: 'Landlord',
    phone: '+880 1711 234567',
    submittedAt: '2 hours ago',
    documents: { nid: true, faceScan: true, deed: false },
    riskLevel: 'Low',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&q=80'
  },
  {
    id: 2,
    name: 'Sarah Islam',
    role: 'Tenant',
    phone: '+880 1822 987654',
    submittedAt: '5 hours ago',
    documents: { nid: true, faceScan: false, deed: false },
    riskLevel: 'Medium',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&q=80'
  }
];

const UserManagement = () => {
  const [activeTab, setActiveTab] = useState('kyc'); // 'kyc', 'landlords', 'tenants'
  const [kycList, setKycList] = useState(pendingKYC);

  const handleVerify = (id, status) => {
    setKycList(prev => prev.filter(user => user.id !== id));
    console.log(`User ${id} KYC marked as ${status}`);
  };

  return (
    <div className="max-w-6xl mx-auto pt-4 pb-12 space-y-8">
      
      {/* ── হেডার ও ট্যাব ── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">User Management</h1>
          <p className="text-sm font-bold text-gray-500 mt-2">
            Control platform access, verify identities, and monitor trust scores.
          </p>
        </div>

        {/* No-Line Tabs */}
        <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          {[
            { id: 'kyc', label: 'Pending KYC', count: kycList.length, icon: ShieldAlert },
            { id: 'landlords', label: 'Landlords', count: null, icon: ShieldCheck },
            { id: 'tenants', label: 'Tenants', count: null, icon: Users }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-black transition-all ${
                activeTab === tab.id 
                  ? 'bg-[#ba0036] text-white shadow-[0_4px_15px_rgba(186,0,54,0.3)]' 
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
              {tab.count !== null && (
                <span className={`ml-1.5 px-2 py-0.5 rounded-lg text-[10px] ${
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-[#ba0036]/10 text-[#ba0036]'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── সার্চ ও ফিল্টার বার ── */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-[1.5rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search users by name, phone, or ID..." 
            className="w-full bg-[#eaeff5]/50 py-3 pl-12 pr-4 rounded-xl outline-none font-bold text-sm text-gray-800 focus:bg-[#eaeff5] transition-all"
          />
        </div>
        <button className="p-3 bg-[#eaeff5]/50 text-gray-500 rounded-xl hover:bg-[#eaeff5] transition-all">
          <Filter size={20} />
        </button>
      </div>

      {/* ── KYC ভেরিফিকেশন লিস্ট (Active Tab View) ── */}
      {activeTab === 'kyc' && (
        <div className="space-y-4">
          {kycList.length === 0 ? (
             <div className="bg-white rounded-[2rem] p-12 text-center shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
               <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                 <UserCheck size={30} />
               </div>
               <h3 className="text-xl font-black text-gray-900">All Users Verified</h3>
               <p className="text-gray-500 font-bold mt-2">No pending identity checks at the moment.</p>
             </div>
          ) : (
            kycList.map((user) => (
              <div key={user.id} className="bg-white p-5 rounded-[1.5rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_25px_rgba(186,0,54,0.05)] transition-all flex flex-col md:flex-row items-center gap-6">
                
                {/* User Info */}
                <div className="flex items-center gap-4 w-full md:w-1/3">
                  <img src={user.avatar} alt={user.name} className="w-14 h-14 rounded-2xl object-cover shadow-sm" />
                  <div>
                    <h4 className="text-base font-black text-gray-900 flex items-center gap-2">
                      {user.name} 
                      <span className={`text-[9px] px-2 py-0.5 rounded-lg uppercase tracking-widest ${user.role === 'Landlord' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        {user.role}
                      </span>
                    </h4>
                    <p className="text-xs font-bold text-gray-400 mt-0.5">{user.phone}</p>
                  </div>
                </div>

                {/* Document Status */}
                <div className="flex items-center gap-3 w-full md:w-1/3 bg-[#eaeff5]/50 py-2.5 px-4 rounded-xl">
                  <div className={`flex flex-col items-center justify-center w-10 h-10 rounded-lg ${user.documents.nid ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                    <FileText size={18} />
                    <span className="text-[8px] font-black mt-0.5">NID</span>
                  </div>
                  <div className={`flex flex-col items-center justify-center w-10 h-10 rounded-lg ${user.documents.faceScan ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-400'}`}>
                    <ScanFace size={18} />
                    <span className="text-[8px] font-black mt-0.5">FACE</span>
                  </div>
                  <div className="flex-1 pl-3 border-l-2 border-white">
                     <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Risk Level</p>
                     <p className={`text-xs font-black ${user.riskLevel === 'Low' ? 'text-green-500' : 'text-orange-500 flex items-center gap-1'}`}>
                       {user.riskLevel === 'Low' ? 'Clear' : <><AlertTriangle size={12}/> Review</>}
                     </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 w-full md:w-1/3">
                  <button className="px-4 py-2 text-xs font-black text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-xl transition-all">
                    View Docs
                  </button>
                  <button onClick={() => handleVerify(user.id, 'rejected')} className="w-10 h-10 flex items-center justify-center text-gray-400 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:text-[#ba0036] hover:shadow-[0_4px_15px_rgba(186,0,54,0.1)] rounded-xl transition-all">
                    <XCircle size={18} />
                  </button>
                  <button onClick={() => handleVerify(user.id, 'approved')} className="px-5 py-2.5 bg-[#ba0036] text-white text-xs font-black rounded-xl shadow-[0_4px_15px_rgba(186,0,54,0.2)] hover:shadow-[0_8px_20px_rgba(186,0,54,0.3)] hover:-translate-y-0.5 transition-all flex items-center gap-1.5">
                    <CheckCircle2 size={16} /> Approve
                  </button>
                </div>

              </div>
            ))
          )}
        </div>
      )}

      {/* ── Placeholder for other tabs ── */}
      {activeTab !== 'kyc' && (
        <div className="bg-white rounded-[2rem] p-12 text-center shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <Users size={40} className="text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-black text-gray-900 capitalize">{activeTab} Directory</h3>
          <p className="text-gray-500 font-bold mt-2">List of all active {activeTab} will appear here.</p>
        </div>
      )}

    </div>
  );
};

export default UserManagement;