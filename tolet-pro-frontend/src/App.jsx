import React, { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { LanguageProvider } from "./context/LanguageContext";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import callProvider from "./services/callProvider";
import { getCurrentToken } from "./services/authService";
import fcmService from "./services/fcmService";

// Existing Imports
import Navbar from "./components/Navbar";
import PropertyListing from "./components/PropertyListing";
import PropertyDetails from "./components/PropertyDetails";
import InquiryPage from "./components/InquiryModal";
import LoginPage from "./components/LoginPage";
import HostDashboard from "./components/HostDashboard";
import AddProperty from "./components/AddProperty";
import HomePage from "./components/HomePage";
import ChatSystem from "./components/ChatSystem";
import TenantDashboard from "./components/TenantDashboard";
import GlobalAIAssistant from "./components/GlobalAIAssistant";
import SmartAlertsPage from "./components/Smartalertspage";
import AIInsightsPage from "./components/Aiinsightspage";
import LandlordProfile from "./components/LandlordProfile";
import TenantProfile from "./components/TenantProfile";
import PrivacyCenter from "./components/PrivacyCenter.jsx";
import SubscriptionPage from "./components/SubscriptionPage";

// --- Mobile Shell ---
import MobileBottomNav from "./components/mobile/MobileBottomNav";

// --- PWA install banner (Phase Call-5) ---
import InstallPrompt from "./components/InstallPrompt";

// --- Legal pages (Phase 7) ---
import PrivacyPolicy from "./components/legal/PrivacyPolicy";
import TermsOfService from "./components/legal/TermsOfService";
import RefundPolicy from "./components/legal/RefundPolicy";

// --- Beta feedback button (Phase 7) ---
import FeedbackButton from "./components/FeedbackButton";
import GlobalCallUI from "./components/GlobalCallUI";

// --- Admin Imports ---
import AdminLayout from "./components/AdminLayout";
import AdminOverview from "./components/AdminOverview";
import PropertyModeration from "./components/PropertyModeration";
import UserManagement from "./components/UserManagement";
import SupportAndAI from "./components/SupportAndAI";

// --- Auth-gate Imports ---
import RequireAdmin from "./components/RequireAdmin.jsx";
import RequireAuth from "./components/RequireAuth.jsx";

// ─── Global call socket bootstrap ───────────────────────────────────────────
// Keeps a single Socket.IO connection alive for the whole authenticated
// session, regardless of which route the user is on. Without this, the
// socket only connects when /messages is mounted, and incoming-call
// notifications miss anyone browsing Home / Explore / Dashboard.
const GlobalCallSocket = () => {
	const { isAuthenticated, user } = useAuth();

	useEffect(() => {
		if (!isAuthenticated) {
			callProvider.disconnect();
			return;
		}
		const token = getCurrentToken();
		if (!token) return;
		callProvider.connect(token);
		// Phase Call-6: register this device for incoming-call push so the user
		// is alerted even when the PWA is closed. If permission is already
		// granted, refresh the token quietly; if permission is undecided, wait
		// for the user's next tap/key so mobile browsers allow the permission
		// prompt and the token registration actually succeeds.
		const fcmTimer = setTimeout(() => {
			fcmService.enableCallNotifications({ prompt: false }).catch(() => {});
		}, 1500);
		const cleanupPushGesture = fcmService.enableCallNotificationsOnNextUserGesture();
		// No socket cleanup — we want it to persist across navigations.
		// It only tears down on logout (handled by the !isAuthenticated branch).
		return () => {
			clearTimeout(fcmTimer);
			cleanupPushGesture?.();
		};
	}, [isAuthenticated, user?.id, user?._id]);

	return null;
};

const AppLayout = () => {
	const location = useLocation();

	// Hide the marketing Navbar on dashboards, auth, admin, and the privacy center
	// (the privacy center has its own header with a back button).
	const hideNavbarRoutes = [
		"/tenant-dashboard",
		"/host-dashboard",
		"/login",
		"/admin",
		"/account",
	];
	const shouldHideNavbar = hideNavbarRoutes.some((route) =>
		location.pathname.startsWith(route),
	);

	// Hide the AI Assistant on auth, admin, and the messages page
	// (the chat page has its own interface — the floating widget is redundant there).
	const shouldHideAIAssistant =
		location.pathname === "/login" ||
		location.pathname.startsWith("/admin") ||
		location.pathname === "/messages";

	// On the property listing page, the Navbar is replaced on mobile by the
	// immersive Daraz-style header built into PropertyListing itself.
	// We still render it on desktop (lg+) so the brand bar stays visible there.
	const isPropertyListingRoute = location.pathname.startsWith("/properties/");

	return (
		<div className="min-h-screen bg-white">
			<GlobalCallSocket />
			{!shouldHideNavbar && (
				<div className={isPropertyListingRoute ? "hidden lg:block" : ""}>
					<Navbar />
				</div>
			)}

			<Routes>
				{/* Public Routes */}
				<Route path="/" element={<HomePage />} />
				<Route path="/properties/:divisionName" element={<PropertyListing />} />
				<Route path="/property/:id" element={<PropertyDetails />} />
				<Route path="/inquire/:id" element={<InquiryPage />} />
				<Route path="/login" element={<LoginPage />} />

				{/* Legal pages — public, no auth required (Phase 7) */}
				<Route path="/privacy-policy" element={<PrivacyPolicy />} />
				<Route path="/terms" element={<TermsOfService />} />
				<Route path="/refund" element={<RefundPolicy />} />

				<Route
					path="/host-dashboard"
					element={
						<RequireAuth requireRole="landlord">
							<HostDashboard />
						</RequireAuth>
					}
				/>
				<Route
					path="/list-property"
					element={
						<RequireAuth requireRole="landlord">
							<AddProperty />
						</RequireAuth>
					}
				/>
				<Route path="/messages" element={<ChatSystem />} />
				<Route path="/tenant-dashboard" element={<TenantDashboard />} />
				<Route
					path="/smart-alerts"
					element={
						<RequireAuth>
							<SmartAlertsPage />
						</RequireAuth>
					}
				/>
				<Route path="/ai-insights" element={<AIInsightsPage />} />
				<Route path="/landlord/:id" element={<LandlordProfile />} />
				<Route path="/tenant/:id" element={<TenantProfile />} />

				<Route
					path="/subscription"
					element={
						<RequireAuth requireRole="landlord">
							<SubscriptionPage />
						</RequireAuth>
					}
				/>
				<Route
					path="/account/privacy"
					element={
						<RequireAuth>
							<PrivacyCenter />
						</RequireAuth>
					}
				/>

				<Route
					path="/admin"
					element={
						<RequireAdmin>
							<AdminLayout />
						</RequireAdmin>
					}
				>
					<Route index element={<AdminOverview />} />
					<Route path="properties" element={<PropertyModeration />} />
					<Route path="users" element={<UserManagement />} />
					<Route path="support" element={<SupportAndAI />} />
				</Route>

				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>

			<GlobalCallUI />
			{!shouldHideAIAssistant && <GlobalAIAssistant />}
			<MobileBottomNav hideOnRoutes={['/login', '/admin', '/list-property', '/properties/']} />
			<InstallPrompt />
			<FeedbackButton />
		</div>
	);
};

function App() {
	return (
		<AuthProvider>
			<LanguageProvider>
				<Router>
					<AppLayout />
				</Router>
			</LanguageProvider>
		</AuthProvider>
	);
}

export default App;
