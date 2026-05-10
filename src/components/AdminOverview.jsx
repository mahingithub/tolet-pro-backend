import React from 'react';
import { 
  Users, Building, DollarSign, Activity, TrendingUp, 
  ShieldAlert, CheckCircle2, ArrowUpRight, AlertCircle, Clock 
} from 'lucide-react';

const AdminOverview = () => {
  // Mock Data for Stats
  const stats = [
    { id: 1, label: 'Total Users', value: '2,845', increase: '+12%', icon: Users, color: 'text-blue-500', bg: 'bg-blue-50' },
    { id: 2, label: 'Active Properties', value: '842', increase: '+5%', icon: Building, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    { id: 3, label: 'Monthly Revenue', value: '৳ 1.2M', increase: '+18%', icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { id: 4, label: 'Pending Moderation', value: '14', increase: 'Action Needed', icon: ShieldAlert, color: 'text-[#ba0036]', bg: 'bg-[#ba0036]/10' },
  ];

  return (
    <div className="max-w-6xl mx-auto pt-4 pb-12 space-y-8">
      
      {/* ── হেডার ── */}
      <div>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">System Overview</h1>
        <p className="text-sm font-bold text-gray-500 mt-2">
          Welcome back, Admin. Here is what's happening across TO-LET PRO today.
        </p>
      </div>

      {/* ── ১. স্ট্যাটস গ্রিড (Top Row) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.id} className="bg-white p-6 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.06)] transition-all duration-300 group">
            <div className="flex items-start justify-between mb-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${stat.bg}`}>
                <stat.icon size={22} className={stat.color} />
              </div>
              <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest ${stat.id === 4 ? 'bg-[#ba0036]/10 text-[#ba0036]' : 'bg-gray-50 text-gray-500'}`}>
                {stat.increase}
              </span>
            </div>
            <h3 className="text-3xl font-black text-gray-900 mb-1">{stat.value}</h3>
            <p className="text-sm font-bold text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── ২. বেন্টো গ্রিড লেআউট (Bottom Section) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Revenue & Growth Chart Placeholder (Spans 2 columns) */}
        <div className="lg:col-span-2 bg-white rounded-[2rem] p-8 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-black text-gray-900">Revenue Growth</h3>
              <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-widest">Premium Subscriptions & Fees</p>
            </div>
            <button className="flex items-center gap-2 text-[#ba0036] bg-[#ba0036]/5 hover:bg-[#ba0036]/10 px-4 py-2 rounded-xl text-xs font-black transition-all">
              Detailed Report <ArrowUpRight size={14} />
            </button>
          </div>
          
          {/* Abstract Graph Representation (No-Line UI) */}
          <div className="flex-1 w-full bg-[#eaeff5]/50 rounded-2xl flex items-end justify-between p-6 gap-2 min-h-[250px]">
            {[40, 70, 45, 90, 65, 100, 80].map((height, i) => (
              <div key={i} className="w-full flex justify-center group">
                <div 
                  className={`w-full max-w-[40px] rounded-t-xl transition-all duration-500 hover:opacity-100 ${i === 5 ? 'bg-gradient-to-t from-[#ba0036] to-[#ff4d79] shadow-[0_0_20px_rgba(186,0,54,0.3)]' : 'bg-white shadow-[0_4px_10px_rgba(0,0,0,0.02)] opacity-60'}`} 
                  style={{ height: `${height}%` }}
                ></div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Center & Alerts (1 column) */}
        <div className="bg-[#ba0036] rounded-[2rem] p-8 shadow-[0_10px_30px_rgba(186,0,54,0.2)] text-white relative overflow-hidden flex flex-col">
          {/* Decorative Glow */}
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/20 blur-3xl rounded-full"></div>
          
          <h3 className="text-xl font-black mb-6 relative z-10 flex items-center gap-2">
            <Activity size={22} className="text-white/80" /> Action Center
          </h3>

          <div className="space-y-4 relative z-10 flex-1">
            {/* Action Item 1 */}
            <div className="bg-white/10 hover:bg-white/20 backdrop-blur-md p-4 rounded-2xl cursor-pointer transition-all border border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <AlertCircle size={16} />
                </div>
                <h4 className="font-bold text-sm">3 Spammed Listings</h4>
              </div>
              <p className="text-xs text-white/70 font-medium">Auto-flagged by AI. Review required.</p>
            </div>

            {/* Action Item 2 */}
            <div className="bg-white/10 hover:bg-white/20 backdrop-blur-md p-4 rounded-2xl cursor-pointer transition-all border border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <ShieldAlert size={16} />
                </div>
                <h4 className="font-bold text-sm">5 Pending KYCs</h4>
              </div>
              <p className="text-xs text-white/70 font-medium">Verify Host NID & Face scans.</p>
            </div>
          </div>

          <button className="w-full mt-6 bg-white text-[#ba0036] py-3.5 rounded-xl font-black text-sm shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all">
            Open Security Desk
          </button>
        </div>

      </div>
    </div>
  );
};

export default AdminOverview;