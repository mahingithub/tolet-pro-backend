// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ InquiryModal — single shared modal used by BOTH PropertyListing.jsx     ║
// ║ and PropertyDetails.jsx. Previously the details page shipped its own    ║
// ║ inline duplicate, which is why two different forms appeared depending   ║
// ║ on where the user clicked "Inquire". This file is now the only source   ║
// ║ of truth for the inquiry UX.                                            ║
// ║                                                                          ║
// ║ Spec from product:                                                       ║
// ║   • Tenant only types two things: PHONE + MESSAGE.                       ║
// ║   • Above the message field, surface AI-recommended starter questions    ║
// ║     (rent negotiation, facilities, location, visit slot, lease terms).   ║
// ║     Each one is one-tap → appends to the message. We nudge the user to   ║
// ║     pick at least three so the landlord receives a useful enquiry.       ║
// ║                                                                          ║
// ║ The "AI" suggestions are deterministic, derived live from the property   ║
// ║ data (price / location / amenities). When the backend AI endpoint is     ║
// ║ ready, swap `useAiSuggestions(property)` for a `useQuery` hook hitting   ║
// ║ /api/ai/inquiry-suggestions?propertyId=… — the chip render code stays    ║
// ║ identical because it just maps over `{ id, icon, label, message }`.      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
	X, MessageCircle, MapPin, Clock, Send, CheckCircle2, Sparkles,
	Phone, Wand2, BadgePercent, Wrench, CalendarClock, KeyRound,
} from 'lucide-react';
import { createInquiry as createInquiryApi } from '../services/inquiryService.js';
import { getCurrentUser, getCurrentToken } from '../services/authService.js';

// ─── helpers ────────────────────────────────────────────────────────────────
// Loose, friendly Bangladesh phone validation. We accept any 10+ digit run,
// optionally with leading +880 / 880 / 0 — that's enough to keep junk out
// without rejecting power users who type weird formats. Stricter validation
// belongs on the server.
const isValidPhone = (raw) => {
	if (!raw) return false;
	const digits = raw.replace(/[^\d]/g, '');
	return digits.length >= 10 && digits.length <= 15;
};

// Mask the phone to "•••• ••• 1234" for the success screen so we don't echo
// the full number back at the user (defensive UX — avoids screen-share leaks).
const maskPhone = (raw) => {
	const digits = (raw || '').replace(/[^\d]/g, '');
	if (digits.length < 4) return raw || '';
	return `•••• ••• ${digits.slice(-4)}`;
};

// ─── AI suggestion engine ───────────────────────────────────────────────────
// Today this is rule-based but exposes the *exact* shape an LLM-backed API
// would return ({ id, icon, label, message }). Each suggestion is composed
// from the property the user is inquiring about, so two listings produce
// different chip text — i.e. the "AI" feels live, not boilerplate.
const useAiSuggestions = (property) => {
	return useMemo(() => {
		if (!property) return [];

		const priceFmt = property.price ? `৳${Number(property.price).toLocaleString('en-IN')}` : 'the listed rent';
		const location = property.location || 'this area';
		const beds = property.beds ?? null;
		const baths = property.baths ?? null;
		const sqft = property.sqft ?? null;

		// Five chips covering the topics product asked for. The user only needs
		// three — anything beyond is bonus.
		const chips = [
			{
				id: 'rent',
				icon: BadgePercent,
				label: 'Negotiate rent',
				message:
					`Hi! I'm interested in your property. Is there any flexibility on the monthly rent of ${priceFmt}, ` +
					`especially if I sign for a longer-term lease?`,
			},
			{
				id: 'facilities',
				icon: Wrench,
				label: 'Confirm facilities',
				message:
					`Could you confirm what's included with the property — gas, water, parking, lift, generator and ` +
					`internet? Are utility bills part of the rent or paid separately?`,
			},
			{
				id: 'location',
				icon: MapPin,
				label: 'Location & access',
				message:
					`How accessible is ${location}? I'd like to know roughly how far the property is from the nearest ` +
					`bus stop, school and grocery market, and how the area feels at night.`,
			},
			{
				id: 'visit',
				icon: CalendarClock,
				label: 'Schedule a visit',
				message:
					`When could I come by for a tour this week? I'm flexible on weekday evenings and weekend mornings — ` +
					`please share a slot that works for you.`,
			},
			{
				id: 'move-in',
				icon: KeyRound,
				label: 'Move-in & lease',
				message:
					`What's the earliest move-in date, and what's the minimum lease length? Also — security deposit and ` +
					`advance rent expectations, please.`,
			},
		];

		// If we have spec info, append a 6th chip that asks about it. This is the
		// pattern an LLM would use — pivot questions on whatever data we have.
		if (beds || baths || sqft) {
			const parts = [];
			if (beds) parts.push(`${beds} bed`);
			if (baths) parts.push(`${baths} bath`);
			if (sqft) parts.push(`${sqft} sqft`);
			chips.push({
				id: 'spec',
				icon: Sparkles,
				label: 'Confirm spec',
				message:
					`Just to confirm — the listing says ${parts.join(', ')}. Could you also share photos or a quick ` +
					`video walkthrough of the rooms before I visit?`,
			});
		}

		return chips;
	}, [property]);
};

// Compose the message text from the user's manual input + selected chips.
// The chips are appended in insertion order, separated by a blank line, so
// the landlord sees a clean, readable enquiry.
const composeMessage = (manual, selectedChips) => {
	const parts = [];
	if (manual && manual.trim()) parts.push(manual.trim());
	selectedChips.forEach((c) => parts.push(c.message));
	return parts.join('\n\n');
};

// ─── component ──────────────────────────────────────────────────────────────
const InquiryModal = ({ isOpen, onClose, property, landlord }) => {
	const [step, setStep] = useState('form');           // 'form' | 'success'
	const [phone, setPhone] = useState('');
	const [manualMessage, setManualMessage] = useState('');
	const [selectedIds, setSelectedIds] = useState([]); // ordered chip ids
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState('');

	// Cache property/landlord during exit animation so the modal doesn't blank
	// out when the parent unsets them.
	const [persistedData, setPersistedData] = useState({ property: null, landlord: null });
	useEffect(() => {
		if (isOpen && property && landlord) setPersistedData({ property, landlord });
	}, [isOpen, property, landlord]);

	const displayProperty = property || persistedData.property;
	const displayLandlord = landlord || persistedData.landlord;

	const aiSuggestions = useAiSuggestions(displayProperty);
	const selectedChips = useMemo(
		() => selectedIds.map((id) => aiSuggestions.find((c) => c.id === id)).filter(Boolean),
		[selectedIds, aiSuggestions],
	);

	// Final message = whatever the user typed + every chip they tapped.
	const finalMessage = useMemo(
		() => composeMessage(manualMessage, selectedChips),
		[manualMessage, selectedChips],
	);

	// Reset everything ~after~ the close animation finishes.
	useEffect(() => {
		if (!isOpen) {
			const timer = setTimeout(() => {
				setStep('form');
				setPhone('');
				setManualMessage('');
				setSelectedIds([]);
				setIsSubmitting(false);
				setSubmitError('');
			}, 400);
			return () => clearTimeout(timer);
		}
	}, [isOpen]);

	// Pre-fill the phone field from the logged-in tenant if we have it.
	// The user can still override it on the form; the backend always uses
	// the authenticated user's own phone for the inquiry record (the field
	// here is informational only — see createInquiry in inquiry.service.js).
	useEffect(() => {
		if (!isOpen) return;
		const me = getCurrentUser();
		if (me?.phone && !phone) setPhone(me.phone);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isOpen]);

	const toggleChip = useCallback((id) => {
		setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
	}, []);

	const phoneOk = isValidPhone(phone);
	const messageOk = finalMessage.trim().length > 0;
	const canSubmit = phoneOk && messageOk && !isSubmitting;

	const handleSubmit = async () => {
		if (!canSubmit) return;

		const propertyId = displayProperty?.id || displayProperty?._id;
		if (!propertyId) {
			setSubmitError('Property reference missing.');
			return;
		}
		if (!getCurrentToken()) {
			setSubmitError('Inquiry পাঠাতে আগে লগইন করুন।');
			return;
		}

		setSubmitError('');
		setIsSubmitting(true);
		try {
			await createInquiryApi({
				propertyId: String(propertyId),
				message: finalMessage,
			});
			setStep('success');
		} catch (err) {
			setSubmitError(
				err?.message || 'Inquiry পাঠাতে সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।',
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	if (!displayProperty || !displayLandlord) return null;

	const suggestionCount = selectedIds.length;
	const meetsMinimum = suggestionCount >= 3;

	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-gray-900/60 backdrop-blur-sm"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					onClick={onClose}
				>
					<motion.div
						className="bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full sm:max-w-md shadow-2xl border-t sm:border border-gray-100 overflow-hidden relative max-h-[92vh] flex flex-col"
						initial={{ y: 100, opacity: 0 }}
						animate={{ y: 0, opacity: 1 }}
						exit={{ y: 100, opacity: 0 }}
						transition={{ type: 'spring', damping: 28, stiffness: 320 }}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="absolute top-0 left-0 w-full h-1 bg-[#ba0036] z-10" />
						<div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-200 rounded-full sm:hidden z-10" />

						<button
							onClick={onClose}
							className="absolute top-5 right-5 p-2 bg-gray-50 hover:bg-red-50 hover:text-[#ba0036] rounded-full transition-colors z-20"
							aria-label="Close inquiry"
						>
							<X size={18} />
						</button>

						<AnimatePresence mode="wait">
							{step === 'form' && (
								<motion.div
									key="form"
									initial={{ opacity: 0, x: -20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -20 }}
									transition={{ duration: 0.2 }}
									className="p-7 pt-10 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
								>
									{/* ── Header ── */}
									<div className="flex items-center gap-4 mb-6">
										<div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center shrink-0">
											<MessageCircle size={26} className="text-[#ba0036]" />
										</div>
										<div>
											<h3 className="text-xl font-black text-gray-900 leading-tight">Send Inquiry</h3>
											<p className="text-gray-400 font-bold text-sm mt-0.5">
												to <span className="text-[#ba0036]">{displayLandlord.name}</span>
											</p>
										</div>
									</div>

									{/* ── Property summary ── */}
									<div className="flex items-center gap-3 bg-gray-50 rounded-2xl p-3 mb-5 border border-gray-100">
										<img
											src={displayProperty.images?.[0]}
											alt={displayProperty.title}
											className="w-14 h-14 rounded-xl object-cover shrink-0"
										/>
										<div className="min-w-0">
											<p className="font-black text-gray-900 text-sm truncate">{displayProperty.title}</p>
											<p className="text-[#ba0036] font-black text-sm mt-0.5">
												৳{Number(displayProperty.price).toLocaleString('en-IN')}
												<span className="text-gray-400 font-bold text-xs">/mo</span>
											</p>
											<p className="text-gray-400 text-xs font-bold flex items-center gap-1 mt-0.5 truncate">
												<MapPin size={10} className="shrink-0" /> {displayProperty.location}
											</p>
										</div>
									</div>

									<div className="flex flex-col gap-3">
										{/* ── Phone ── */}
										<div
											className={`bg-gray-50 rounded-2xl px-4 py-3.5 border transition-all ${
												phone && !phoneOk
													? 'border-red-300 focus-within:border-red-400 bg-red-50/50'
													: 'border-gray-100 focus-within:border-[#ba0036] focus-within:bg-white'
											}`}
										>
											<p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1.5">
												<Phone size={10} /> Your Phone Number
											</p>
											<input
												type="tel"
												inputMode="tel"
												autoComplete="tel"
												placeholder="+880 1XXX-XXXXXX"
												value={phone}
												onChange={(e) => setPhone(e.target.value)}
												className="w-full bg-transparent text-sm font-bold text-gray-900 placeholder-gray-300 outline-none"
											/>
											{phone && !phoneOk && (
												<p className="text-[10px] font-black text-red-500 mt-1">
													Looks short — please enter a full mobile number.
												</p>
											)}
										</div>

										{/* ── AI suggestions ── */}
										<div className="rounded-2xl border border-gray-100 bg-gradient-to-br from-red-50/40 via-white to-white p-3.5">
											<div className="flex items-center justify-between mb-2.5">
												<div className="flex items-center gap-1.5">
													<div className="w-6 h-6 rounded-lg bg-[#ba0036]/10 flex items-center justify-center">
														<Wand2 size={12} className="text-[#ba0036]" />
													</div>
													<p className="text-[10px] font-black text-gray-700 uppercase tracking-widest">
														AI Suggestions
													</p>
												</div>
												<span
													className={`text-[10px] font-black uppercase tracking-widest transition-colors ${
														meetsMinimum ? 'text-green-600' : 'text-gray-400'
													}`}
												>
													{suggestionCount}/3 added
												</span>
											</div>

											<p className="text-[11px] font-bold text-gray-500 leading-relaxed mb-3">
												Tap to add ready-made questions to your message. We recommend at least
												<span className="text-gray-800"> three</span> so the landlord can answer in one go.
											</p>

											<div className="flex flex-wrap gap-1.5">
												{aiSuggestions.map((chip) => {
													const Icon = chip.icon;
													const active = selectedIds.includes(chip.id);
													return (
														<button
															key={chip.id}
															type="button"
															onClick={() => toggleChip(chip.id)}
															className={`group flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-[11px] font-black transition-all border ${
																active
																	? 'bg-[#ba0036] text-white border-[#ba0036] shadow-[0_4px_12px_rgba(186,0,54,0.25)]'
																	: 'bg-white text-gray-700 border-gray-200 hover:border-[#ba0036]/40 hover:text-[#ba0036]'
															}`}
															aria-pressed={active}
														>
															<Icon size={11} className={active ? 'text-white' : 'text-[#ba0036]'} />
															<span>{chip.label}</span>
															{active && <CheckCircle2 size={11} className="text-white/90" />}
														</button>
													);
												})}
											</div>
										</div>

										{/* ── Message preview / manual edit ── */}
										<div className="bg-gray-50 rounded-2xl px-4 py-3.5 border border-gray-100 focus-within:border-[#ba0036] focus-within:bg-white transition-all">
											<div className="flex items-center justify-between mb-1">
												<p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
													Your Message
												</p>
												<p className="text-[9px] font-bold text-gray-400">
													{finalMessage.length} chars
												</p>
											</div>

											{/* Selected chip chips also appear inline above the textarea so the
											    user can see + remove what the AI added without scrolling up. */}
											{selectedChips.length > 0 && (
												<div className="flex flex-wrap gap-1 mb-2">
													{selectedChips.map((chip) => (
														<button
															key={chip.id}
															type="button"
															onClick={() => toggleChip(chip.id)}
															className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#ba0036]/10 text-[#ba0036] text-[10px] font-black"
															aria-label={`Remove ${chip.label}`}
														>
															<Sparkles size={9} /> {chip.label}
															<X size={10} className="ml-0.5 opacity-70" />
														</button>
													))}
												</div>
											)}

											<textarea
												placeholder="Optional — add your own note. AI questions you tap above will be appended automatically."
												value={manualMessage}
												onChange={(e) => setManualMessage(e.target.value)}
												className="w-full bg-transparent text-sm font-bold text-gray-900 placeholder-gray-300 outline-none resize-none h-20 leading-relaxed"
											/>
										</div>

										<div className="flex items-center gap-2 px-1">
											<Clock size={12} className="text-green-500 shrink-0" />
											<p className="text-xs font-bold text-gray-400">
												{displayLandlord.name} typically responds in{' '}
												<span className="text-green-600">{displayLandlord.responseTime}</span>
											</p>
										</div>

										{submitError ? (
											<div
												className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2"
												role="alert"
											>
												{submitError}
											</div>
										) : null}

										<button
											onClick={handleSubmit}
											disabled={!canSubmit}
											className="w-full bg-[#ba0036] disabled:bg-gray-200 disabled:text-gray-400 text-white py-4 rounded-2xl font-black mt-1 shadow-[0_10px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_15px_30px_rgba(186,0,54,0.4)] hover:bg-[#90002a] active:scale-95 disabled:shadow-none disabled:active:scale-100 transition-all flex items-center justify-center gap-2"
										>
											{isSubmitting ? (
												<>
													<motion.div
														animate={{ rotate: 360 }}
														transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
														className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
													/>
													Sending...
												</>
											) : (
												<>
													<Send size={16} /> Send Inquiry
												</>
											)}
										</button>
									</div>
								</motion.div>
							)}

							{step === 'success' && (
								<motion.div
									key="success"
									initial={{ opacity: 0, scale: 0.95 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.3 }}
									className="p-8 pt-12 pb-10 text-center overflow-y-auto"
								>
									<div className="relative w-24 h-24 mx-auto mb-6">
										<motion.div
											className="absolute inset-0 bg-green-100 rounded-full"
											initial={{ scale: 0 }}
											animate={{ scale: 1 }}
											transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.1 }}
										/>
										<motion.div
											className="absolute inset-0 bg-green-200 rounded-full opacity-50"
											animate={{ scale: [1, 1.2, 1] }}
											transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
										/>
										<motion.div
											className="relative w-full h-full flex items-center justify-center"
											initial={{ scale: 0, rotate: -30 }}
											animate={{ scale: 1, rotate: 0 }}
											transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.2 }}
										>
											<CheckCircle2 size={44} className="text-green-500" />
										</motion.div>
									</div>

									<motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
										<h3 className="text-2xl font-black text-gray-900 tracking-tight">
											Inquiry sent!
										</h3>
										<p className="text-gray-500 font-bold text-sm mt-2 leading-relaxed">
											We've shared your message with{' '}
											<span className="text-gray-800">{displayLandlord.name}</span>.<br />
											They'll call or text <span className="text-gray-800">{maskPhone(phone)}</span> shortly.
										</p>
									</motion.div>

									<motion.div
										className="mt-6 bg-gray-50 rounded-2xl p-4 text-left border border-gray-100"
										initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
									>
										<p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">What happens next</p>
										{[
											{ icon: '📩', text: `${displayLandlord.name} reviews your message` },
											{ icon: '📞', text: `They reach out on ${maskPhone(phone)}` },
											{ icon: '🏠', text: 'Schedule a property visit' },
										].map((s, i) => (
											<motion.div key={i} className="flex items-center gap-3 py-2" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.1 }}>
												<span className="text-lg shrink-0">{s.icon}</span>
												<p className="text-sm font-bold text-gray-700">{s.text}</p>
											</motion.div>
										))}
									</motion.div>

									<motion.div className="flex flex-col gap-2 mt-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }}>
										<button onClick={onClose} className="w-full bg-[#ba0036] text-white py-3.5 rounded-2xl font-black shadow-lg hover:bg-[#90002a] active:scale-95 transition-all flex items-center justify-center gap-2">
											<Sparkles size={15} /> Done
										</button>
										<button onClick={onClose} className="w-full py-3 rounded-2xl font-black text-sm text-gray-500 hover:text-gray-700 transition-colors">
											Back to property
										</button>
									</motion.div>
								</motion.div>
							)}
						</AnimatePresence>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
};

export default InquiryModal;
