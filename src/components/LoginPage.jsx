import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Building, Phone, Lock, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const LoginPage = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  
  // States
  const [isLogin, setIsLogin] = useState(true);
  const [role, setRole] = useState('tenant'); 
  const [step, setStep] = useState('form'); 
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    password: ''
  });
  const [otp, setOtp] = useState(['', '', '', '']);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleOtpChange = (index, value) => {
    if (isNaN(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value !== '' && index < 3) {
      document.getElementById(`otp-${index + 1}`).focus();
    }
  };

  // Normal Form Submit
  const handleAuthSubmit = (e) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setStep('otp'); 
    }, 1200);
  };

  // OTP Verification
  const handleVerifyOtp = (e) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      navigate('/dashboard'); 
    }, 1200);
  };

  // Google Social Login (Email Auth)
  const handleGoogleLogin = () => {
    setIsLoading(true);
    // TODO: Add Firebase Google Auth Provider logic here
    // Example: signInWithPopup(auth, provider).then((result) => { const user = result.user; ... })
    console.log("Triggering Google Auth (Verified Email & Name fetching...)");
    setTimeout(() => {
      setIsLoading(false);
      navigate('/dashboard'); 
    }, 1500);
  };

  return (
    // 'h-screen' and 'overflow-hidden' ensures no scrolling on desktop
    <div className="h-screen w-full flex bg-[#f8f9fa] font-sans overflow-hidden">
      
      {/* ================= LEFT SIDE: DESKTOP IMAGE ================= */}
      <div className="hidden lg:flex lg:w-[45%] relative bg-gray-900 overflow-hidden h-full">
        <img 
          src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80" 
          alt="To-Let Pro Luxury Home" 
          className="absolute inset-0 w-full h-full object-cover opacity-80 transition-transform duration-[10s] hover:scale-105" 
        />
        
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-end p-10 xl:p-14">
          <div className="bg-brandRed text-white text-[11px] font-bold uppercase tracking-widest py-1.5 px-3 rounded-full w-max mb-5">
            100% Verified Hosts
          </div>
          <h1 className="text-4xl xl:text-5xl font-black text-white leading-[1.1] tracking-tight mb-3">
            Find Your Next <br /> <span className="text-brandRed">Perfect Home.</span>
          </h1>
          <p className="text-gray-300 text-base max-w-md">
            Discover premium apartments, duplexes, and commercial spaces across Bangladesh with To-Let Pro Ecosystem.
          </p>
          
          <div className="flex items-center gap-5 mt-8">
            <div className="flex -space-x-3">
              <img src="https://i.pravatar.cc/100?img=1" className="w-9 h-9 rounded-full border-2 border-black" alt="user" />
              <img src="https://i.pravatar.cc/100?img=2" className="w-9 h-9 rounded-full border-2 border-black" alt="user" />
              <img src="https://i.pravatar.cc/100?img=3" className="w-9 h-9 rounded-full border-2 border-black" alt="user" />
            </div>
            <p className="text-xs font-medium text-gray-300">Happy Users <br/>Joined Recently</p>
          </div>
        </div>
      </div>

      {/* ================= RIGHT SIDE: FORM ================= */}
      <div className="w-full lg:w-[55%] h-full flex flex-col justify-center items-center px-6 sm:px-12 bg-white relative overflow-y-auto custom-scrollbar">
        
        <button 
          onClick={() => step === 'otp' ? setStep('form') : navigate(-1)} 
          className="absolute top-6 left-6 text-gray-400 hover:text-brandRed transition-colors p-2 rounded-full hover:bg-gray-100"
        >
          <ArrowLeft size={22} />
        </button>

        <div className="w-full max-w-[380px] mx-auto py-6 animate-[fadeIn_0.3s_ease-out]">
          
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-brandRed/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Building size={28} className="text-brandRed" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              {step === 'otp' ? 'Verification' : (isLogin ? 'Welcome Back' : 'Create Account')}
            </h2>
            <p className="text-gray-500 font-medium text-xs sm:text-sm mt-1.5">
              {step === 'otp' 
                ? `Enter the 4-digit code sent to +880 ${formData.phone}` 
                : (isLogin ? 'Log in to access your dashboard' : 'Quickly sign up with your phone number')}
            </p>
          </div>

          {step === 'form' && (
            <>
              {/* Compact Role Toggle */}
              <div className="flex p-1 bg-gray-100 rounded-xl mb-6">
                <button 
                  type="button"
                  onClick={() => setRole('tenant')}
                  className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${role === 'tenant' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Tenant
                </button>
                <button 
                  type="button"
                  onClick={() => setRole('landlord')}
                  className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${role === 'landlord' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Landlord
                </button>
              </div>

              {/* Reduced gap space between form elements */}
              <form className="space-y-3.5" onSubmit={handleAuthSubmit}>
                
                {/* Full Name (Sign up only) */}
                {!isLogin && (
                  <div className="animate-[fadeIn_0.2s_ease-out]">
                    <label className="block text-[11px] font-bold text-gray-700 mb-1 ml-1 uppercase tracking-wider">Full Name</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                        <User size={16} />
                      </div>
                      <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Asraf Alom Mahin" className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:bg-white focus:border-brandRed focus:ring-2 focus:ring-brandRed/20 transition-all outline-none" required />
                    </div>
                  </div>
                )}

                {/* Phone Number */}
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1 ml-1 uppercase tracking-wider">Phone Number</label>
                  <div className="relative flex items-center bg-gray-50 border border-gray-200 rounded-xl focus-within:bg-white focus-within:border-brandRed focus-within:ring-2 focus-within:ring-brandRed/20 transition-all overflow-hidden">
                    <div className="pl-3.5 pr-2.5 text-gray-400">
                      <Phone size={16} />
                    </div>
                    <div className="px-1.5 py-3 border-l border-gray-300 text-gray-600 font-bold text-sm">
                      +880
                    </div>
                    <input type="tel" name="phone" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value.replace(/\D/g, '')})} maxLength={10} placeholder="1XXXXXXXXX" className="w-full bg-transparent py-3 pl-2 pr-4 text-sm font-bold outline-none tracking-wide" required />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="flex justify-between items-center mb-1 ml-1">
                    <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider">Password</label>
                    {isLogin && <button type="button" className="text-[11px] font-bold text-brandRed hover:underline">Forgot?</button>}
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                      <Lock size={16} />
                    </div>
                    <input type="password" name="password" value={formData.password} onChange={handleChange} placeholder="••••••••" className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:bg-white focus:border-brandRed focus:ring-2 focus:ring-brandRed/20 transition-all outline-none tracking-widest" required />
                  </div>
                </div>

                {/* Submit Button */}
                <button type="submit" disabled={isLoading || formData.phone.length < 10} className="w-full mt-4 flex items-center justify-center gap-2 bg-brandRed text-white py-3.5 rounded-xl font-bold text-sm shadow-[0_6px_15px_rgba(186,0,54,0.2)] hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(186,0,54,0.3)] active:translate-y-0 transition-all disabled:opacity-70 disabled:hover:translate-y-0">
                  {isLoading ? <Loader2 className="animate-spin" size={18} /> : (isLogin ? 'Log In' : 'Sign Up')}
                </button>
              </form>

              {/* Social Login Separator */}
              <div className="mt-6 mb-5 relative flex items-center justify-center">
                <div className="absolute w-full h-px bg-gray-200"></div>
                <span className="relative bg-white px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Or continue with</span>
              </div>

              {/* Google Integration Button */}
              <div className="flex gap-3">
                <button onClick={handleGoogleLogin} type="button" className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors font-bold text-xs sm:text-sm text-gray-700">
                  {isLoading ? <Loader2 className="animate-spin text-gray-400" size={16} /> : <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-4 h-4" />} 
                  Google
                </button>
                <button type="button" className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors font-bold text-xs sm:text-sm text-gray-700">
                  <img src="https://www.svgrepo.com/show/475647/facebook-color.svg" alt="Facebook" className="w-4 h-4" /> Facebook
                </button>
              </div>
            </>
          )}

          {/* OTP VERIFICATION STEP */}
          {step === 'otp' && (
            <div className="animate-[fadeIn_0.3s_ease-out]">
              <form onSubmit={handleVerifyOtp} className="flex flex-col items-center">
                <div className="flex justify-center gap-3 sm:gap-4 mb-6 mt-4">
                  {otp.map((digit, index) => (
                    <input 
                      key={index}
                      id={`otp-${index}`}
                      type="text" 
                      maxLength="1"
                      value={digit}
                      onChange={(e) => handleOtpChange(index, e.target.value)}
                      className="w-12 h-12 sm:w-14 sm:h-14 text-center text-xl font-black text-brandRed bg-gray-50 border-2 border-gray-200 rounded-xl outline-none focus:border-brandRed focus:bg-white transition-all shadow-sm"
                    />
                  ))}
                </div>

                <button type="submit" disabled={isLoading || otp.join('').length < 4} className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white py-3.5 rounded-xl font-bold text-sm shadow-[0_6px_15px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-70">
                  {isLoading ? <Loader2 className="animate-spin" size={18} /> : <><CheckCircle2 size={18} /> Verify Code</>}
                </button>
              </form>
            </div>
          )}

          {/* Toggle Footer */}
          {step === 'form' && (
            <div className="mt-8 text-center">
              <p className="text-xs sm:text-sm font-semibold text-gray-500">
                {isLogin ? "Don't have an account?" : "Already have an account?"} 
                <button 
                  onClick={() => { setIsLogin(!isLogin); setFormData({name: '', phone: '', password: ''}); }} 
                  className="text-brandRed font-black ml-1.5 hover:underline"
                >
                  {isLogin ? "Sign Up" : "Log In"}
                </button>
              </p>
            </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Custom scrollbar for small height screens */
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #e5e7eb;
          border-radius: 20px;
        }
      `}</style>
    </div>
  );
};

export default LoginPage;