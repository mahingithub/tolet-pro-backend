import React from "react";
import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { LanguageProvider } from "./context/LanguageContext";

// Existing Imports
import Navbar from "./components/Navbar";
import HeroSection from "./components/HeroSection";
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
import SmartAlertsPage from "./components/SmartAlertsPage";
import AIInsightsPage from "./components/AIInsightsPage";
import LandlordProfile from "./components/LandlordProfile";

// --- New Admin Imports ---
import AdminLayout from "./components/AdminLayout";
import AdminOverview from "./components/AdminOverview";
import PropertyModeration from "./components/PropertyModeration";
import UserManagement from "./components/UserManagement";
import SupportAndAI from "./components/SupportAndAI";

const AppLayout = () => {
	const location = useLocation();

	// Added "/admin" to the hide list so the main Navbar doesn't overlap the Admin Panel
	const hideNavbarRoutes = ["/tenant-dashboard", "/host-dashboard", "/login", "/admin"];

	// Logic to hide Navbar if the path starts with any of the hidden routes
	const shouldHideNavbar = hideNavbarRoutes.some(route => location.pathname.startsWith(route));

	// Logic to hide AI Assistant on Login or Admin pages
	const isAuthOrAdminPage = location.pathname === "/login" || location.pathname.startsWith("/admin");

	return (
		<div className="min-h-screen bg-white">
			{!shouldHideNavbar && <Navbar />}

			<Routes>
				{/* Public Routes */}
				<Route path="/" element={<HomePage />} />
				<Route path="/properties/:divisionName" element={<PropertyListing />} />
				<Route path="/property/:id" element={<PropertyDetails />} />
				<Route path="/inquire/:id" element={<InquiryPage />} />
				<Route path="/login" element={<LoginPage />} />
				
				{/* User/Host Routes */}
				<Route path="/host-dashboard" element={<HostDashboard />} />
				<Route path="/list-property" element={<AddProperty />} />
				<Route path="/messages" element={<ChatSystem />} />
				<Route path="/tenant-dashboard" element={<TenantDashboard />} />
				<Route path="/smart-alerts" element={<SmartAlertsPage />} />
				<Route path="/ai-insights" element={<AIInsightsPage />} />
				<Route path="/landlord/:id" element={<LandlordProfile />} />

				{/* 🔴 Admin Routes (Nested) */}
				<Route path="/admin" element={<AdminLayout />}>
					<Route index element={<AdminOverview />} />
					<Route path="properties" element={<PropertyModeration />} />
					<Route path="users" element={<UserManagement />} />
					<Route path="support" element={<SupportAndAI />} />
				</Route>
			</Routes>

			{/* Render AI Assistant only if it's not an auth or admin page */}
			{!isAuthOrAdminPage && <GlobalAIAssistant />}
		</div>
	);
};

function App() {
	return (
		<LanguageProvider>
			<Router>
				<AppLayout />
			</Router>
		</LanguageProvider>
	);
}

export default App;