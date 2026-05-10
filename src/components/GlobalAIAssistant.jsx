import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Draggable from 'react-draggable';
import { 
  Bot, X, Send, Sparkles, Minimize2, ExternalLink, TrendingUp, MessageSquareText
} from 'lucide-react';

const GlobalAIAssistant = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  const messagesEndRef = useRef(null);
  const chatWindowRef = useRef(null); // Draggable-এর জন্য নতুন ref
  const floatingBtnRef = useRef(null); // Draggable-এর জন্য নতুন ref

  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Load chat history from LocalStorage so it persists across refreshes
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('ai_chat_history');
    return saved ? JSON.parse(saved) : [
      { id: 1, sender: 'ai', text: 'Hello! 🤖 I am your AI Assistant. I can help you find properties, check your saved items, or answer any questions.' }
    ];
  });

  // Save chat history whenever it updates
  useEffect(() => {
    localStorage.setItem('ai_chat_history', JSON.stringify(messages));
  }, [messages]);

  // Auto-scroll to bottom when a new message arrives
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, isOpen]);

  const handleSendMessage = (e) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    const userMsg = { id: Date.now(), sender: 'user', text: inputText };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);

    // MOCK AI PROCESSING (Replace with actual backend API call later)
    setTimeout(() => {
      let aiResponse = { id: Date.now() + 1, sender: 'ai', text: '' };
      const query = userMsg.text.toLowerCase();

      // Smart Contextual Responses & Routing Logic
      if (query.includes('saved')) {
        aiResponse.text = "I've pulled up your saved properties. Would you like to review them now?";
        aiResponse.action = { label: 'View Saved Properties', route: '/saved' };
      } 
      else if (query.includes('cheap') || query.includes('budget')) {
        aiResponse.text = "I can definitely help with that! I've filtered some great budget-friendly options for you.";
        aiResponse.action = { label: 'View Budget Homes', route: '/properties?budget=low' };
      }
      else if (query.includes('dashboard')) {
        aiResponse.text = "Sure, I can take you to your dashboard.";
        aiResponse.action = { label: 'Go to Dashboard', route: '/dashboard' };
      }
      else {
        aiResponse.text = "That's interesting! I am currently a Beta AI, but I am learning every day. Try asking me to 'show saved properties' or 'find budget homes'.";
      }

      setMessages(prev => [...prev, aiResponse]);
      setIsTyping(false);
    }, 1500);
  };

  return (
    <div className="font-sans">
      
      {/* ========================================================= */}
      {/* 💬 EXPANDABLE CHAT UI */}
      {/* ========================================================= */}
      {isOpen && (
        <Draggable nodeRef={chatWindowRef} bounds="body" handle=".drag-header" cancel=".no-drag">
          <div ref={chatWindowRef} className="fixed bottom-24 right-4 md:right-8 z-[100] w-[calc(100vw-2rem)] md:w-[380px] h-[550px] max-h-[75vh] flex flex-col bg-white/95 backdrop-blur-2xl rounded-[2rem] shadow-[0_30px_80px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.4)] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-10 duration-300">
            
            {/* Header (Draggable Handle) */}
            <div className="drag-header cursor-grab active:cursor-grabbing bg-gradient-to-r from-[#ba0036] to-[#d91a4d] p-4 flex items-center justify-between shrink-0 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
              
              <div className="flex items-center gap-3 relative z-10">
                <div className="bg-white/20 p-2 rounded-xl backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                  <Bot size={20} className="text-white" />
                </div>
                <div className="flex flex-col">
                  <h3 className="font-black text-white text-sm tracking-wide">TO-LET AI Assistant</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.6)]"></div>
                    <span className="text-[10px] text-white/80 font-medium">Online & Ready</span>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={() => setIsOpen(false)} 
                className="no-drag p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors relative z-10"
              >
                <Minimize2 size={16} />
              </button>
            </div>

            {/* 🎯 MONETIZATION / AD SECTION */}
            <div className="bg-gradient-to-r from-orange-50 to-red-50 shadow-[0_2px_6px_rgba(0,0,0,0.03)] p-2.5 flex items-center justify-between shrink-0 relative z-10">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-orange-600" />
                <span className="text-[10px] font-bold text-gray-700 uppercase tracking-widest">Sponsored</span>
              </div>
              <a href="#" className="text-[10px] font-black text-[#ba0036] hover:underline flex items-center gap-1">
                Get 20% off Premium <ExternalLink size={10} />
              </a>
            </div>

            {/* Chat History Area */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar bg-[#f8f9fa]/50">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'self-end items-end' : 'self-start items-start'}`}>
                  
                  {/* Message Bubble */}
                  <div className={`px-4 py-3 shadow-md ${
                    msg.sender === 'user' 
                    ? 'bg-gray-900 text-white rounded-[1.5rem] rounded-tr-sm' 
                    : 'bg-white text-gray-800 rounded-[1.5rem] rounded-tl-sm'
                  }`}>
                    <p className="text-sm font-medium leading-relaxed">{msg.text}</p>
                  </div>

                  {/* Smart Action Button (If AI suggests a route) */}
                  {msg.action && (
                    <button 
                      onClick={() => {
                        navigate(msg.action.route);
                        setIsOpen(false); 
                      }}
                      className="mt-2 flex items-center gap-2 bg-[#ba0036]/10 text-[#ba0036] hover:bg-[#ba0036]/20 px-4 py-2 rounded-xl text-xs font-bold transition-colors shadow-[0_2px_8px_rgba(186,0,54,0.15)]"
                    >
                      <Sparkles size={12} /> {msg.action.label} <ExternalLink size={12} />
                    </button>
                  )}
                </div>
              ))}

              {/* Typing Indicator */}
              {isTyping && (
                <div className="self-start bg-white shadow-md px-4 py-3.5 rounded-[1.5rem] rounded-tl-sm flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.03)] shrink-0 z-10 relative">
              <form onSubmit={handleSendMessage} className="flex items-center bg-[#f4f7fb] rounded-2xl p-1.5 shadow-inner focus-within:ring-2 focus-within:ring-[#ba0036]/10 transition-all">
                <input 
                  type="text" 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Ask me anything..." 
                  className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-gray-900 placeholder-gray-400 px-3 py-2"
                />
                <button 
                  type="submit"
                  disabled={!inputText.trim() || isTyping}
                  className={`p-2.5 rounded-xl transition-all shrink-0 flex items-center justify-center ${
                    inputText.trim() && !isTyping ? 'bg-[#ba0036] text-white shadow-[0_4px_12px_rgba(186,0,54,0.3)]' : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  <Send size={16} className={inputText.trim() ? 'translate-x-0.5 -translate-y-0.5' : ''} />
                </button>
              </form>
              <div className="text-center mt-2">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">AI responses may not always be 100% accurate</span>
              </div>
            </div>

          </div>
        </Draggable>
      )}

      {/* ========================================================= */}
      {/* 🔮 FLOATING AI BUTTON (Draggable) */}
      {/* ========================================================= */}
      {!isOpen && (
        <Draggable 
          nodeRef={floatingBtnRef}
          bounds="body"
          onDrag={() => setIsDragging(true)}
          onStop={() => setTimeout(() => setIsDragging(false), 150)}
        >
          <button 
            ref={floatingBtnRef}
            onClick={(e) => {
              if (isDragging) {
                e.preventDefault();
                return;
              }
              setIsOpen(true);
            }}
            className="fixed bottom-6 right-4 md:right-8 z-[100] group flex items-center justify-center animate-in zoom-in duration-500 cursor-grab active:cursor-grabbing"
          >
            {/* Glowing Pulse Background */}
            <div className="absolute inset-0 bg-[#ba0036] rounded-full blur-xl opacity-40 group-hover:opacity-70 group-hover:scale-110 transition-all duration-300 animate-pulse"></div>
            
            {/* Main Button */}
            <div className="relative w-14 h-14 bg-gradient-to-br from-[#ba0036] to-[#8a0028] rounded-full flex items-center justify-center shadow-[0_10px_30px_rgba(186,0,54,0.4),inset_0_1px_0_rgba(255,255,255,0.2)] group-hover:-translate-y-1 transition-transform duration-300">
              <Sparkles size={24} className="text-white" />
              
              {/* Notification Dot */}
              <div className="absolute top-0 right-0 w-3.5 h-3.5 bg-green-400 shadow-[0_0_0_2px_white] rounded-full"></div>
            </div>
          </button>
        </Draggable>
      )}

    </div>
  );
};

export default GlobalAIAssistant;