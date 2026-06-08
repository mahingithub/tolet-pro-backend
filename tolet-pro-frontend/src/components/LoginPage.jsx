import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { User, Phone, Lock, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { auth } from '../services/firebase';
import {
  signupStart,
  signupVerify,
  loginWithPassword,
  forgotStart,
  forgotVerify,
  resetPassword,
} from '../services/authService.js';

const RESEND_COOLDOWN_S = 30;

/**
 * Strip the leading 0 a BD user often types, so `01742...` becomes `1742...`
 * and the resulting E.164 is `+8801742...`. Also drop anything non-numeric.
 */
function normalizePhoneInput(raw) {
  return raw.replace(/\D/g, '').replace(/^0+/, '');
}

function toE164(localPart) {
  return `+880${localPart}`;
}

/**
 * Maps Firebase auth errors to actionable Bangla messages instead of a
 * generic "OTP পাঠাতে সমস্যা" so future failures are debuggable.
 */
function firebaseErrToMsg(err) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'ফোন নম্বর সঠিক নয়। +880 ছাড়া ১০ ডিজিট লিখুন।';
    case 'auth/missing-phone-number':
      return 'ফোন নম্বর দিন।';
    case 'auth/quota-exceeded':
      return 'আজকের SMS লিমিট শেষ। Firebase প্ল্যান বা টেস্ট নম্বর ব্যবহার করুন।';
    case 'auth/captcha-check-failed':
      return 'reCAPTCHA চেক ব্যর্থ। পেইজ রিলোড করে আবার চেষ্টা করুন।';
    case 'auth/too-many-requests':
      return 'অনেক বেশি চেষ্টা। কিছুক্ষণ পরে আবার চেষ্টা করুন।';
    case 'auth/invalid-verification-code':
      return 'OTP কোড ভুল হয়েছে।';
    case 'auth/code-expired':
      return 'OTP কোড মেয়াদ শেষ। নতুন OTP নিন।';
    case 'auth/missing-app-credential':
      return 'reCAPTCHA সেটআপে সমস্যা। পেইজ রিলোড করুন।';
    default:
      return err?.message || 'OTP প্রক্রিয়ায় সমস্যা হয়েছে।';
  }
}

const MODES = {
  LOGIN: 'login',
  SIGNUP: 'signup',
  FORGOT: 'forgot',
};
const STEPS = {
  FORM: 'form',
  OTP: 'otp',
  NEW_PASSWORD: 'new-password', // forgot-password flow only
};

const LoginPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, refresh } = useAuth();

  const nextUrl = searchParams.get('next');

  const [mode, setMode] = useState(MODES.LOGIN);
  const [step, setStep] = useState(STEPS.FORM);
  const [role, setRole] = useState('tenant');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const [formData, setFormData] = useState({ name: '', phone: '', password: '' });
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resendIn, setResendIn] = useState(0);

  // Firebase refs (kept across renders, recreated per new OTP request)
  const confirmationResultRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);

  // ─── Recaptcha lifecycle ──────────────────────────────────────────────────
  // RecaptchaVerifier is single-use; clear + recreate on every OTP send so
  // resend works and re-entering the flow after success doesn't fail silently.
  const buildRecaptcha = useCallback(() => {
    if (recaptchaVerifierRef.current) {
      try { recaptchaVerifierRef.current.clear(); } catch { /* noop */ }
      recaptchaVerifierRef.current = null;
    }
    recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
    });
    return recaptchaVerifierRef.current;
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    return () => {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
    };
  }, []);

  // Tick the resend countdown
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const goToNextOrDashboard = (resolvedRole) => {
    if (nextUrl) {
      try {
        navigate(decodeURIComponent(nextUrl), { replace: true });
        return;
      } catch { /* fall through */ }
    }
    if (resolvedRole === 'admin') {
      navigate('/admin', { replace: true });
    } else {
      navigate(resolvedRole === 'landlord' ? '/host-dashboard' : '/tenant-dashboard', { replace: true });
    }
  };

  const handlePhoneChange = (e) =>
    setFormData((d) => ({ ...d, phone: normalizePhoneInput(e.target.value).slice(0, 10) }));

  const switchMode = (m) => {
    setMode(m);
    setStep(STEPS.FORM);
    setErrorMsg('');
    setInfoMsg('');
    setOtp(['', '', '', '', '', '']);
    setFormData({ name: '', phone: '', password: '' });
    setNewPassword('');
    setResetToken('');
  };

  // ─── Send (or resend) the Firebase OTP ────────────────────────────────────
  const sendFirebaseOtp = async () => {
    const phoneE164 = toE164(formData.phone);
    const verifier = buildRecaptcha();
    const result = await signInWithPhoneNumber(auth, phoneE164, verifier);
    confirmationResultRef.current = result;
    setResendIn(RESEND_COOLDOWN_S);
  };

  // ─── LOGIN flow (no OTP) ──────────────────────────────────────────────────
  const submitLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true); setErrorMsg(''); setInfoMsg('');
    try {
      const loggedInUser = await login({ phone: toE164(formData.phone), password: formData.password });
      if (['super_admin', 'moderator', 'support_agent'].includes(loggedInUser?.role)) {
        goToNextOrDashboard('admin');
      } else {
        goToNextOrDashboard(role);
      }
    } catch (err) {
      setErrorMsg(err.message || 'লগইন ব্যর্থ হয়েছে।');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── SIGNUP flow (with OTP) ───────────────────────────────────────────────
  const submitSignupStart = async (e) => {
    e.preventDefault();
    setIsLoading(true); setErrorMsg(''); setInfoMsg('');
    try {
      // 1. Tell backend to draft the signup (validates input, ensures no
      //    existing verified account, stores name + hashed pwd in SignupIntent).
      await signupStart({
        name: formData.name,
        phone: toE164(formData.phone),
        password: formData.password,
        role,
      });
      // 2. Trigger Firebase OTP.
      await sendFirebaseOtp();
      setStep(STEPS.OTP);
    } catch (err) {
      // err here can be a backend ApiError or a Firebase error
      setErrorMsg(err.code?.startsWith?.('auth/') ? firebaseErrToMsg(err) : (err.message || 'সাইনআপ শুরু করা যায়নি।'));
    } finally {
      setIsLoading(false);
    }
  };

  const submitSignupOtp = async (e) => {
    e.preventDefault();
    setIsLoading(true); setErrorMsg(''); setInfoMsg('');
    const code = otp.join('');
    try {
      const credential = await confirmationResultRef.current.confirm(code);
      const idToken = await credential.user.getIdToken();
      await signupVerify({ idToken });
      if (refresh) await refresh();
      goToNextOrDashboard(role);
    } catch (err) {
      setErrorMsg(err.code?.startsWith?.('auth/') ? firebaseErrToMsg(err) : (err.message || 'অ্যাকাউন্ট তৈরি করা যায়নি।'));
    } finally {
      setIsLoading(false);
    }
  };

  // ─── FORGOT-PASSWORD flow (with OTP) ──────────────────────────────────────
  const submitForgotStart = async (e) => {
    e.preventDefault();
    setIsLoading(true); setErrorMsg(''); setInfoMsg('');
    try {
      await forgotStart({ phone: toE164(formData.phone) });
      await sendFirebaseOtp();
      setStep(STEPS.OTP);
    } catch (err) {
      setErrorMsg(err.code?.startsWith?.('auth/') ? firebaseErrToMsg(err) : (err.message || 'OTP পাঠানো যায়নি।'));
    } finally {
      setIsLoading(false);
    }
  };

  const submitForgotOtp = async (e) => {
    e.preventDefault();
    setIsLoading(true); setErrorMsg(''); setInfoMsg('');
    try {
      const credential = await confirmationResultRef.current.confirm(otp.join(''));
      const idToken = await credential.user.getIdToken();
      const { resetToken: t } = await forgotVerify({ idToken });
      setResetToken(t);
      setStep(STEPS.NEW_PASSWORD);
      setInfoMsg('OTP যাচাই হয়েছে। এখন নতুন পাসওয়ার্ড দিন।');
    } catch (err) {
      setErrorMsg(err.code?.startsWith?.('auth/') ? firebaseErrToMsg(err) : (err.message || 'OTP যাচাই ব্যর্থ।'));
    } finally {
      setIsLoading(false);
    }
  };

  const submitResetPassword = async (e) => {
    e.preventDefault();
    setIsLoading(true); setErrorMsg(''); setInfoMsg('');
    try {
      await resetPassword({ resetToken, password: newPassword });
      setInfoMsg('পাসওয়ার্ড পরিবর্তন সফল। এবার লগইন করুন।');
      switchMode(MODES.LOGIN);
    } catch (err) {
      setErrorMsg(err.message || 'পাসওয়ার্ড পরিবর্তন ব্যর্থ।');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setIsLoading(true); setErrorMsg(''); setInfoMsg('');
    try {
      await sendFirebaseOtp();
      setOtp(['', '', '', '', '', '']);
      setInfoMsg('নতুন OTP পাঠানো হয়েছে।');
    } catch (err) {
      setErrorMsg(firebaseErrToMsg(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (isNaN(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value !== '' && index < 5) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  const formTitle = (() => {
    if (mode === MODES.SIGNUP) return 'Create Account';
    if (mode === MODES.FORGOT) return 'Reset Password';
    return 'Welcome Back 👋';
  })();
  const formSub = (() => {
    if (mode === MODES.SIGNUP) return 'Join To-Let Pro today';
    if (mode === MODES.FORGOT) return 'Enter your phone — we will send an OTP';
    return 'Sign in to continue';
  })();

  return (
    <div className="h-screen w-full flex bg-[#f8f9fa] font-sans overflow-hidden">
      {/* Invisible reCAPTCHA container — required by Firebase Phone Auth */}
      <div id="recaptcha-container"></div>

      {/* ── LEFT SIDE: DESKTOP IMAGE ── */}
      <div className="hidden lg:flex lg:w-[45%] relative bg-gray-900 overflow-hidden h-full">
        <img
          src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
          alt="To-Let Pro"
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
            Discover premium apartments, duplexes, and commercial spaces across Bangladesh.
          </p>
        </div>
      </div>

      {/* ── RIGHT SIDE: FORM ── */}
      <div className="w-full lg:w-[55%] h-full flex flex-col justify-center items-center px-6 sm:px-12 bg-white relative overflow-y-auto custom-scrollbar">
        <button
          onClick={() => (step !== STEPS.FORM ? setStep(STEPS.FORM) : navigate(-1))}
          className="absolute top-6 left-6 text-gray-400 hover:text-brandRed transition-colors p-2 rounded-full hover:bg-gray-100"
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>

        <div className="w-full max-w-sm">
          {errorMsg && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm font-semibold text-red-600 text-center">
              {errorMsg}
            </div>
          )}
          {infoMsg && !errorMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-semibold text-emerald-700 text-center">
              {infoMsg}
            </div>
          )}

          {/* ── FORM STEP ── */}
          {step === STEPS.FORM && (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">{formTitle}</h2>
                <p className="text-sm text-gray-500 mt-1">{formSub}</p>
              </div>

              {mode !== MODES.FORGOT && (
                <div className="flex bg-gray-100 p-1 rounded-xl mb-5">
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
              )}

              <form
                className="space-y-3.5"
                onSubmit={
                  mode === MODES.LOGIN ? submitLogin :
                  mode === MODES.SIGNUP ? submitSignupStart :
                  submitForgotStart
                }
              >
                {mode === MODES.SIGNUP && (
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1 ml-1 uppercase tracking-wider">Full Name</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                        <User size={16} />
                      </div>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="আপনার নাম"
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:bg-white focus:border-brandRed focus:ring-2 focus:ring-brandRed/20 transition-all outline-none"
                        required
                        minLength={2}
                        maxLength={80}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1 ml-1 uppercase tracking-wider">Phone Number</label>
                  <div className="relative flex items-center bg-gray-50 border border-gray-200 rounded-xl focus-within:bg-white focus-within:border-brandRed focus-within:ring-2 focus-within:ring-brandRed/20 transition-all overflow-hidden">
                    <div className="pl-3.5 pr-2.5 text-gray-400"><Phone size={16} /></div>
                    <div className="px-1.5 py-3 border-l border-gray-300 text-gray-600 font-bold text-sm">+880</div>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={handlePhoneChange}
                      maxLength={10}
                      placeholder="1XXXXXXXXX"
                      inputMode="numeric"
                      className="w-full bg-transparent py-3 pl-2 pr-4 text-sm font-bold outline-none tracking-wide"
                      required
                    />
                  </div>
                </div>

                {mode !== MODES.FORGOT && (
                  <div>
                    <div className="flex justify-between items-center mb-1 ml-1">
                      <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider">Password</label>
                      {mode === MODES.LOGIN && (
                        <button
                          type="button"
                          onClick={() => switchMode(MODES.FORGOT)}
                          className="text-[11px] font-bold text-brandRed hover:underline"
                        >
                          Forgot?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                        <Lock size={16} />
                      </div>
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:bg-white focus:border-brandRed focus:ring-2 focus:ring-brandRed/20 transition-all outline-none tracking-widest"
                        required
                        minLength={mode === MODES.SIGNUP ? 8 : 1}
                      />
                    </div>
                    {mode === MODES.SIGNUP && (
                      <p className="text-[10px] text-gray-500 mt-1 ml-1">কমপক্ষে ৮ অক্ষর — অক্ষর + সংখ্যা থাকতে হবে।</p>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || formData.phone.length < 10}
                  className="w-full mt-4 flex items-center justify-center gap-2 bg-brandRed text-white py-3.5 rounded-xl font-bold text-sm shadow-[0_6px_15px_rgba(186,0,54,0.2)] hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(186,0,54,0.3)] active:translate-y-0 transition-all disabled:opacity-70"
                >
                  {isLoading ? <Loader2 className="animate-spin" size={18} />
                    : mode === MODES.LOGIN ? 'Log In'
                    : mode === MODES.SIGNUP ? 'Send OTP & Sign Up'
                    : 'Send OTP'}
                </button>
              </form>

              <div className="mt-8 text-center">
                {mode === MODES.LOGIN && (
                  <p className="text-xs sm:text-sm font-semibold text-gray-500">
                    Don&apos;t have an account?
                    <button onClick={() => switchMode(MODES.SIGNUP)} className="text-brandRed font-black ml-1.5 hover:underline">Sign Up</button>
                  </p>
                )}
                {mode === MODES.SIGNUP && (
                  <p className="text-xs sm:text-sm font-semibold text-gray-500">
                    Already have an account?
                    <button onClick={() => switchMode(MODES.LOGIN)} className="text-brandRed font-black ml-1.5 hover:underline">Log In</button>
                  </p>
                )}
                {mode === MODES.FORGOT && (
                  <p className="text-xs sm:text-sm font-semibold text-gray-500">
                    Remembered it?
                    <button onClick={() => switchMode(MODES.LOGIN)} className="text-brandRed font-black ml-1.5 hover:underline">Log In</button>
                  </p>
                )}
              </div>
            </>
          )}

          {/* ── OTP STEP ── */}
          {step === STEPS.OTP && (
            <div className="animate-[fadeIn_0.3s_ease-out] text-center">
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Phone size={28} className="text-brandRed" />
              </div>
              <h2 className="text-xl font-black text-gray-900 mb-1">Verification</h2>
              <p className="text-sm text-gray-500 mb-6">
                Enter the 6-digit code sent to <br />
                <span className="font-bold text-gray-800">+880 {formData.phone}</span>
              </p>

              <form onSubmit={mode === MODES.FORGOT ? submitForgotOtp : submitSignupOtp} className="flex flex-col items-center">
                <div className="flex justify-center gap-3 sm:gap-4 mb-4">
                  {otp.map((digit, index) => (
                    <input
                      key={index}
                      id={`otp-${index}`}
                      type="text"
                      inputMode="numeric"
                      maxLength="1"
                      value={digit}
                      onChange={(e) => handleOtpChange(index, e.target.value)}
                      className="w-12 h-12 sm:w-14 sm:h-14 text-center text-xl font-black text-brandRed bg-gray-50 border-2 border-gray-200 rounded-xl outline-none focus:border-brandRed focus:bg-white transition-all shadow-sm"
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendIn > 0 || isLoading}
                  className="mb-4 text-xs font-bold text-gray-500 hover:text-brandRed transition-colors disabled:opacity-50"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend OTP'}
                </button>

                <button
                  type="submit"
                  disabled={isLoading || otp.join('').length < 6}
                  className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white py-3.5 rounded-xl font-bold text-sm shadow-[0_6px_15px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-70"
                >
                  {isLoading ? <Loader2 className="animate-spin" size={18} /> : <><CheckCircle2 size={18} /> Verify Code</>}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep(STEPS.FORM); setOtp(['', '', '', '', '', '']); setErrorMsg(''); }}
                  className="mt-4 text-sm font-bold text-gray-400 hover:text-brandRed transition-colors"
                >
                  ← Change number
                </button>
              </form>
            </div>
          )}

          {/* ── NEW PASSWORD STEP (forgot flow) ── */}
          {step === STEPS.NEW_PASSWORD && (
            <div className="animate-[fadeIn_0.3s_ease-out]">
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Set New Password</h2>
                <p className="text-sm text-gray-500 mt-1">Choose a strong password.</p>
              </div>
              <form className="space-y-3.5" onSubmit={submitResetPassword}>
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1 ml-1 uppercase tracking-wider">New Password</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                      <Lock size={16} />
                    </div>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:bg-white focus:border-brandRed focus:ring-2 focus:ring-brandRed/20 transition-all outline-none tracking-widest"
                      required
                      minLength={8}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 ml-1">কমপক্ষে ৮ অক্ষর — অক্ষর + সংখ্যা থাকতে হবে।</p>
                </div>
                <button
                  type="submit"
                  disabled={isLoading || newPassword.length < 8}
                  className="w-full mt-2 flex items-center justify-center gap-2 bg-brandRed text-white py-3.5 rounded-xl font-bold text-sm shadow-[0_6px_15px_rgba(186,0,54,0.2)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-70"
                >
                  {isLoading ? <Loader2 className="animate-spin" size={18} /> : 'Update Password'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default LoginPage;
