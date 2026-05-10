import React, { useState } from 'react';
import { 
  MessageSquare, Bot, Search, AlertCircle, 
  CheckCircle2, ShieldAlert, Clock, User 
} from 'lucide-react';

// ─── Mock Data ───
const activeChats = [
  { id: 1, type: 'support', user: 'Rahim Uddin', role: 'Landlord', lastMsg: 'I need help verifying my NID.', time: '2m ago', status: 'pending' },
  { id: 2, type: 'ai', user: 'Sarah Islam', role: 'Tenant', lastMsg: 'User asked AI: "Properties in Gulshan under 50k"', time: '5m ago', status: 'resolved' },
  { id: 3, type: 'report', user: 'Anonymous', role: 'Guest', lastMsg: 'Reported fake property ID #1042', time: '1h ago', status: 'urgent' }
];

const SupportAndAI = () => {
  const [activeTab, setActiveTab] = useState('all');

  return (
    <div className="max-w-6xl mx-auto pt-4 pb-12 h-[calc(100vh-100px)] flex flex-col">
      
      {/* ── হেডার ── */}
      <div className="mb-6 shrink-0">
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Support & AI Oversight</h1>
        <p className="text-sm font-bold text-gray-500 mt-2">
          Monitor global AI interactions, manage user reports, and handle live support tickets.
        </p>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        
        {/* ── Left Sidebar (Chat List) ── */}
        <div className="w-1/3 bg-white rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col overflow-hidden">
          
          <div className="p-5 pb-0 shrink-0">
            <div className="relative mb-4">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search tickets..." 
                className="w-full bg-[#eaeff5]/50 py-3 pl-12 pr-4 rounded-xl outline-none font-bold text-sm text-gray-800 focus:bg-[#eaeff5] transition-all"
              />
            </div>

            {/* No-Line Tabs */}
            <div className="flex gap-2 mb-4">
              {['all', 'support', 'ai'].map(tab => (
                <button 
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-xl text-xs font-black capitalize transition-all ${
                    activeTab === tab 
                      ? 'bg-[#ba0036] text-white shadow-[0_4px_15px_rgba(186,0,54,0.3)]' 
                      : 'bg-[#eaeff5]/50 text-gray-500 hover:bg-[#eaeff5]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3 custom-scrollbar space-y-2">
            {activeChats.filter(c => activeTab === 'all' || c.type === activeTab).map(chat => (
              <div key={chat.id} className="p-4 rounded-2xl cursor-pointer hover:bg-[#eaeff5]/50 transition-all border border-transparent hover:border-white">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {chat.type === 'ai' ? (
                      <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center"><Bot size={16} /></div>
                    ) : chat.type === 'report' ? (
                      <div className="w-8 h-8 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center"><ShieldAlert size={16} /></div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center"><User size={16} /></div>
                    )}
                    <div>
                      <h4 className="text-sm font-black text-gray-900">{chat.user}</h4>
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{chat.role}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1"><Clock size={10}/> {chat.time}</span>
                </div>
                <p className="text-xs font-bold text-gray-600 line-clamp-1 pl-10">{chat.lastMsg}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right Side (Chat View / Log Details) ── */}
        <div className="flex-1 bg-white rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col items-center justify-center text-center p-8">
           <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
             <MessageSquare size={32} className="text-gray-300" />
           </div>
           <h3 className="text-xl font-black text-gray-900">Select a Conversation</h3>
           <p className="text-sm font-bold text-gray-500 mt-2 max-w-sm">
             Choose a ticket from the left to view user messages, AI chat logs, or moderation reports.
           </p>
        </div>

      </div>
    </div>
  );
};

export default SupportAndAI;