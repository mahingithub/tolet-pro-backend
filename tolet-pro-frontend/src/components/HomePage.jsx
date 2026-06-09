import React, { useEffect } from 'react';

// 🔴 HeroSection drives the full desktop homepage (Hero, Popular, Network, CTA, Footer).
import HeroSection from './HeroSection';

// 📱 Premium mobile-only home experience — gated below at md:hidden so it never
// affects desktop, and the desktop hero never renders inside the mobile viewport.
import MobileHome from './mobile/MobileHome';

const HomePage = () => {
  // Always start at the top when this page mounts.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    // ✨ Premium wrapper with global selection colours + fade-in.
    <div className="flex flex-col min-h-screen bg-slate-50 font-sans relative overflow-hidden text-gray-900 selection:bg-[#ba0036] selection:text-white animate-in fade-in duration-1000">

      {/* ───── MOBILE HOMEPAGE (max-width: 768px) ───── */}
      {/* Self-contained native-app-style feed: sticky glass search, trust */}
      {/* badge rail, swipeable divisions strip, landlord CTA card, and a    */}
      {/* full-bleed image-carousel property feed. Hidden from md and up.    */}
      <div className="md:hidden">
        <MobileHome />
      </div>

      {/* ───── DESKTOP / TABLET HOMEPAGE (≥ md) ───── */}
      {/* The existing HeroSection-driven layout. Hidden below md. */}
      <div className="hidden md:flex md:flex-col md:flex-1 md:relative">
        {/* ✨ AMBIENT GLOWING ORBS FOR PREMIUM FEEL ✨ */}
        <div className="absolute top-[20%] left-[-10%] w-[50vw] h-[50vw] bg-gradient-to-br from-[#ba0036]/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>
        <div className="absolute top-[60%] right-[-10%] w-[50vw] h-[50vw] bg-gradient-to-tl from-blue-600/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>

        {/* Main content (z-10 keeps it above the ambient background) */}
        <div className="relative z-10 w-full flex flex-col">
          <section className="w-full">
            <HeroSection />
          </section>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
