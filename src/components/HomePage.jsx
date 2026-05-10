import React, { useEffect } from 'react';

// 🔴 শুধু HeroSection ইম্পোর্ট করা হলো কারণ এর ভেতরেই পুরো হোমপেজ (Hero, Popular, Network, CTA, Footer) আছে
import HeroSection from './HeroSection';

const HomePage = () => {
  
  // পেজ লোড হলে যেন একদম ওপরে থাকে
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    // ✨ Premium Wrapper with Global Selection Colors and Fade-in Animation ✨
    <div className="flex flex-col min-h-screen bg-slate-50 font-sans relative overflow-hidden text-gray-900 selection:bg-[#ba0036] selection:text-white animate-in fade-in duration-1000">
      
      {/* ✨ AMBIENT GLOWING ORBS FOR PREMIUM FEEL ✨ */}
      <div className="absolute top-[20%] left-[-10%] w-[50vw] h-[50vw] bg-gradient-to-br from-[#ba0036]/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>
      <div className="absolute top-[60%] right-[-10%] w-[50vw] h-[50vw] bg-gradient-to-tl from-blue-600/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>

      {/* Main Content Wrapper - z-10 ensures it stays above the ambient background */}
      <div className="relative z-10 w-full flex flex-col">
        
        {/* পুরো মডার্ন হোমপেজ এখন এই একটি কম্পোনেন্ট থেকেই লোড হবে */}
        <section className="w-full">
          <HeroSection />
        </section>

      </div>
    </div>
  );
};

export default HomePage;