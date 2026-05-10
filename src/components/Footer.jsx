import React from 'react';
import { Facebook, Instagram, Send } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext'; 

const Footer = () => {
  const { t } = useLanguage(); 
  const location = useLocation();
  
  // 🔴 ম্যাজিক কন্ডিশন (এখানে '/list-property' যোগ করা হয়েছে)
  if (
    location.pathname.includes('/inquire') || 
    location.pathname.includes('/success') || 
    location.pathname.includes('/login') ||
    location.pathname.includes('/host-dashboard') ||
    location.pathname.includes('/list-property') // 👈 নতুন
  ) {
    return null; 
  }
  
  return (
    <footer className="w-full bg-[#0a0f1a] text-white pt-20 pb-10 font-sans mt-10">
      <div className="max-w-7xl mx-auto px-4">
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 lg:gap-8 mb-16 border-b border-gray-800 pb-16">
          
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-6">
              <span className="text-brandRed font-black text-2xl tracking-tighter">{t.brand || "TO-LET PRO"}</span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed mb-8 pr-4">
              {t.footerDesc}
            </p>
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-brandRed hover:text-white transition-colors cursor-pointer">
                <Facebook size={18} />
              </div>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-brandRed hover:text-white transition-colors cursor-pointer">
                <Instagram size={18} />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-brandRed text-xs font-bold uppercase tracking-widest mb-6">{t.discoveryTitle}</h4>
            <ul className="space-y-4 text-gray-400 text-sm font-medium">
              <li className="hover:text-white transition-colors cursor-pointer">{t.navNewListings}</li>
              <li className="hover:text-white transition-colors cursor-pointer">{t.navPopularAreas}</li>
              <li className="hover:text-white transition-colors cursor-pointer">{t.navAffordableStudios}</li>
              <li className="hover:text-white transition-colors cursor-pointer">{t.navLuxuryFlats}</li>
            </ul>
          </div>

          <div>
            <h4 className="text-brandRed text-xs font-bold uppercase tracking-widest mb-6">{t.landlordsTitle}</h4>
            <ul className="space-y-4 text-gray-400 text-sm font-medium">
              <li className="hover:text-white transition-colors cursor-pointer">{t.navHowItWorks}</li>
              <li className="hover:text-white transition-colors cursor-pointer">{t.navListProperty}</li>
              <li className="hover:text-white transition-colors cursor-pointer">{t.navTrustSafety}</li>
              <li className="hover:text-white transition-colors cursor-pointer">{t.navHostGuidelines}</li>
            </ul>
          </div>

          <div>
            <h4 className="text-brandRed text-xs font-bold uppercase tracking-widest mb-6">{t.stayInspired}</h4>
            <p className="text-gray-400 text-sm mb-4">
              {t.newsletterDesc}
            </p>
            <div className="relative">
              <input 
                type="email" 
                placeholder={t.emailPlaceholder} 
                className="w-full bg-white/5 border border-gray-800 rounded-full py-3 px-5 text-sm text-white focus:outline-none focus:border-brandRed transition-colors placeholder-gray-600"
              />
              <button className="absolute right-1.5 top-1.5 w-9 h-9 bg-brandRed rounded-full flex items-center justify-center hover:bg-[#a0002e] transition-colors">
                <Send size={14} className="ml-[-2px]" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center text-xs text-gray-500 font-medium">
          <p>{t.footerCopyright}</p>
          <div className="flex gap-6 mt-4 md:mt-0">
            <span className="hover:text-white transition-colors cursor-pointer">{t.privacyPolicyUpper}</span>
            <span className="hover:text-white transition-colors cursor-pointer">{t.termsServiceUpper}</span>
            <span className="hover:text-white transition-colors cursor-pointer">{t.cookiesUpper}</span>
          </div>
        </div>
        
      </div>
    </footer>
  );
};

export default Footer;