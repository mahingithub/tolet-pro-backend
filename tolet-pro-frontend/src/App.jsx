import React, { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { LanguageProvider } from "./context/LanguageContext";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import callProvider from "./services/callProvider";
import { getCurrentToken } from "./services/authService";

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
		// No cleanup — we want the socket to persist across navigations.
		// It only tears down on logout (handled by the !isAuthenticated branch).
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

	// The AI Assistant lives globally but is hidden on auth + admin pages
	// (admins have their own ticket workspace, not the floating widget).
	const isAuthOrAdminPage =
		location.pathname === "/login" || location.pathname.startsWith("/admin");

	return (
		<div className="min-h-screen bg-white">
			<GlobalCallSocket />
			{!shouldHideNavbar && <Navbar />}

			<Routes>
				{/* Public Routes */}
				<Route path="/" element={<HomePage />} />
				<Route path="/properties/:divisionName" element={<PropertyListing />} />
				<Route path="/property/:id" element={<PropertyDetails />} />
				<Route path="/inquire/:id" element={<InquiryPage />} />
				<Route path="/login" element={<LoginPage />} />

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

			{!isAuthOrAdminPage && <GlobalAIAssistant />}
			<MobileBottomNav />
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