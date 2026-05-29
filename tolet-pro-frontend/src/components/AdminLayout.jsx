import React from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Building, Users, MessageSquare, 
  BellRing, LogOut, Search, ChevronDown 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const AdminLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // "Exit Admin" actually clears the session now (was navigate-only before).
  const handleExit = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  // অ্যাডমিন প্যানেলের নেভিগেশন মেনু
  const menuItems = [
    { path: '/admin', icon: LayoutDashboard, label: 'Overview' },
    { path: '/admin/properties', icon: Building, label: 'Property Moderation' },
    { path: '/admin/users', icon: Users, label: 'User Management' },
    { path: '/admin/support', icon: MessageSquare, label: 'Support & AI' },
  ];

  return (
    // নো-লাইন গ্লোবাল ক্যানভাস
    <div className="min-h-screen bg-[#eaeff5] flex relative overflow-hidden font-sans text-gray-900 selection:bg-[#ba0036] selection:text-white">
      
      {/* গ্লোয়িং অর্বস (Premium Feel) */}
      <div className="absolute top-0 left-[-10%] w-[50vw] h-[50vw] bg-gradient-to-br from-[#ba0036]/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>
      
      {/* ── লেফট সাইডবার (No borders, Tonal Layering) ── */}
      <aside className="w-72 bg-white m-4 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col z-10">
        <div className="p-8">
          <h1 className="text-2xl font-black text-[#ba0036] tracking-tighter">TO-LET PRO</h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Super Admin Center</p>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path || (location.pathname.startsWith(item.path) && item.path !== '/admin');
            return (
              <Link 
                key={item.path} 
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all ${
                  isActive 
                    ? 'bg-[#ba0036]/10 text-[#ba0036] font-black shadow-[0_4px_15px_rgba(186,0,54,0.05)]' 
                    : 'text-gray-500 font-bold hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                <item.icon size={20} className={isActive ? 'text-[#ba0036]' : 'text-gray-400'} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* এক্সিট বাটন */}
        <div className="p-4">
          <button
            onClick={handleExit}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-gray-500 font-bold hover:bg-red-50 hover:text-[#ba0036] rounded-2xl transition-all"
          >
            <LogOut size={20} />
            Exit Admin
          </button>
        </div>
      </aside>

      {/* ── মেইন কন্টেন্ট এরিয়া ── */}
      <main className="flex-1 flex flex-col z-10 h-screen overflow-hidden">
        
        {/* টপবার */}
        <header className="h-24 px-8 flex items-center justify-between">
          <div className="relative w-96">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search properties, users, or reports..." 
              className="w-full bg-white py-3.5 pl-12 pr-4 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] outline-none font-bold text-sm text-gray-800 focus:shadow-[0_8px_25px_rgba(186,0,54,0.08)] transition-all"
            />
          </div>

          <div className="flex items-center gap-5">
            {/* নোটিফিকেশন */}
            <div className="w-12 h-12 bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex items-center justify-center relative cursor-pointer hover:shadow-[0_8px_25px_rgba(186,0,54,0.08)] hover:-translate-y-0.5 transition-all">
              <BellRing size={20} className="text-gray-600" />
              <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-[#ba0036] border-2 border-white rounded-full"></span>
            </div>
            
            {/* অ্যাডমিন প্রোফাইল */}
            <div className="flex items-center gap-3 bg-white p-2 pr-4 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] cursor-pointer hover:shadow-[0_8px_25px_rgba(186,0,54,0.08)] hover:-translate-y-0.5 transition-all">
              <div className="w-10 h-10 bg-gradient-to-br from-[#ba0036] to-[#E12127] rounded-xl flex items-center justify-center text-white font-black shadow-[0_4px_10px_rgba(186,0,54,0.3)]">
                <Users size={18} />
              </div>
              <div>
                <p className="text-sm font-black text-gray-800 truncate max-w-[140px]">{user?.name ?? 'Admin Control'}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  {user?.role === 'super_admin' ? 'Super Admin' : user?.role === 'moderator' ? 'Moderator' : user?.role === 'support_agent' ? 'Support Agent' : 'Head of Ops'}
                </p>
              </div>
              <ChevronDown size={16} className="text-gray-400 ml-2" />
            </div>
          </div>
        </header>

        {/* ── ডাইনামিক পেজ এরিয়া (Scrollable) ── */}
        <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
          {/* এখানে Outlet এর মাধ্যমে রাউটার থেকে অন্যান্য পেজ (Overview, Moderation) লোড হবে। 
          */}
          <Outlet />
        </div>
      </main>

      {/* কাস্টম স্ক্রলবার স্টাইলিং */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(186,0,54,0.15); border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(186,0,54,0.3); }
      `}</style>
    </div>
  );
};

export default AdminLayout;