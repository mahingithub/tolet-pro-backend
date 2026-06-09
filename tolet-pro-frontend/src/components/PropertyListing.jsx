import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from "framer-motion";
import { Search, MapPin, BedDouble, Bath, Square, Heart, Star, X, ChevronRight, ShieldCheck, ChevronDown, ChevronUp, Filter, Ruler, Navigation, CheckCircle2, Flame, Building, Wifi, Map, List, LayoutGrid, Home, Users, User, BookOpen, Share2, MessageCircle, ArrowLeft, SlidersHorizontal, ArrowUpDown, Camera, Layers } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
// ─── SHARED INQUIRY MODAL (single source of truth for the inquiry flow) ───────
import InquiryModal from "./InquiryModal";
// ─── DATA SOURCE: live properties (API + user uploads). NO demo data. ─────────
import { propertyService, subscribeUserProperties, propertyLocationHaystack } from "../services/Propertyservice.js";

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  GOOGLE MAPS                                                            ║
// ║                                                                         ║
// ║  Install once at the project root:                                      ║
// ║      npm i @react-google-maps/api                                       ║
// ║                                                                         ║
// ║  Add a Maps JavaScript API key to .env (depending on your bundler):     ║
// ║      Vite : VITE_GOOGLE_MAPS_API_KEY=AIza...                            ║
// ║      CRA  : REACT_APP_GOOGLE_MAPS_API_KEY=AIza...                       ║
// ║                                                                         ║
// ║  Behaviour:                                                             ║
// ║    • If the key is present → interactive Google Map with custom price   ║
// ║      chip markers and click → MapMiniCard popup (matches the design     ║
// ║      reference videos for desktop & mobile).                            ║
// ║    • If the key is missing → graceful iframe fallback so dev work isn't ║
// ║      blocked. This uses the public /maps embed (no key required).       ║
// ╚══════════════════════════════════════════════════════════════════════════╝
import { GoogleMap, OverlayView, OverlayViewF, useJsApiLoader } from "@react-google-maps/api";

// Pull the API key from whichever bundler the host project uses. Comment the
// line that does NOT match your build tool — the other line stays.
const GOOGLE_MAPS_API_KEY =
	(typeof import.meta !== "undefined" && import.meta?.env?.VITE_GOOGLE_MAPS_API_KEY) ||
	(typeof process !== "undefined" && process?.env?.REACT_APP_GOOGLE_MAPS_API_KEY) ||
	"AIzaSyC9xWNjjSPhxy2aUWLubPqHR7N6KZWmKlg";

// Default centre — middle of Dhaka. Override via the prop on <MapView />.
const DEFAULT_MAP_CENTER = { lat: 23.7652, lng: 90.3893 };
const DEFAULT_MAP_ZOOM = 12;

// Light, Voyager-like map styling that mirrors the reference screenshots.
const MAP_STYLES = [
	{ featureType: "poi.business", stylers: [{ visibility: "off" }] },
	{ featureType: "poi.attraction", elementType: "labels", stylers: [{ visibility: "off" }] },
	{ featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];

// ─── DATA SOURCE ──────────────────────────────────────────────────────────────
// Listings now come from propertyService. No demo / hard-coded properties live
// in this file anymore — the only properties that ever render are:
//   • whatever the API returns  ← preferred when backend is reachable
//   • whatever real hosts have uploaded through the Add Property wizard
//     (persisted to localStorage[`properties:user`])
// Empty array = no host has uploaded yet, which is exactly the "fresh install"
// state we want to show new users.

// ─── RENTAL CATEGORY CONFIG ──────────────────────────────────────────────────
// ⚠️  IDs must match `rentalCategory` values in demo data + propertyService.js
//     AND the category IDs used by HeroSection / Navbar dropdowns.
// Each category exposes a translation key (`tKey`) that the UI resolves at
// render time via `t[cat.tKey]`. The English fallback (`label`) is also used
// directly inside the OYO map mini-card where translation isn't available.
const RENTAL_CATEGORIES = [
	{ id: "family",          label: "Family Flat",       tKey: "catFamilyFlat",     icon: Home },
	{ id: "bachelor_male",   label: "Bachelor (Male)",   tKey: "catBachelorMale",   icon: User },
	{ id: "bachelor_female", label: "Bachelor (Female)", tKey: "catBachelorFemale", icon: Users },
	{ id: "sublet",          label: "Sublet / Room",     tKey: "catSubletRoom",     icon: Share2 },
	{ id: "student",         label: "Student",           tKey: "catStudent",        icon: BookOpen },
];

// ─── VALID DIVISIONS (To catch custom area searches) ──────────────────────────
const validDivisions = ["dhaka", "chittagong", "sylhet", "rajshahi", "khulna", "barishal", "rangpur", "mymensingh"];

// ─── ROOM COLLAGE HELPER ──────────────────────────────────────────────────────
// Builds the listing-card collage: one photo per room category so a card with
// 4 bedroom photos doesn't fill all four tiles with bedrooms. Order is fixed:
// cover photo first, then bedroom, bathroom, living room, kitchen, and other.
const ROOM_COLLAGE_ORDER = ["bedroom", "bathroom", "living", "kitchen", "other"];
const ROOM_MATCHERS = {
	bedroom:  (room) => room.includes("bed"),
	bathroom: (room) => room.includes("bath") || room.includes("toilet") || room.includes("wash"),
	living:   (room) => room.includes("living") || room.includes("drawing") || room.includes("hall"),
	kitchen:  (room) => room.includes("kitchen") || room.includes("cook"),
	other:    (room) => room.includes("other"),
};
const ROOM_LABEL_FALLBACK = {
	bedroom:  "Bedroom",
	bathroom: "Bathroom",
	living:   "Living",
	kitchen:  "Kitchen",
	other:    "Other",
};
function buildRoomCollage(property) {
	const uniqueRoomShots = [];
	const usedPhotos = new Set();
	const hasRoomPhotos = Array.isArray(property.roomPhotos) && property.roomPhotos.some(p => p?.url || p?.preview);
	if (hasRoomPhotos) {
		for (const roomId of ROOM_COLLAGE_ORDER) {
			const matches = ROOM_MATCHERS[roomId];
			const hit = property.roomPhotos.find(p => !usedPhotos.has(p) && matches(String(p.room || "").toLowerCase()) && (p.url || p.preview));
			if (hit) {
				uniqueRoomShots.push({ url: hit.url || hit.preview, room: roomId });
				usedPhotos.add(hit);
			}
		}
	}

	const cover = property.coverPhoto || property.img || (uniqueRoomShots[0]?.url) || (property.images || [])[0] || "";
	const thumbs = uniqueRoomShots.filter(s => s.url !== cover).slice(0, 3);

	// If we have no real per-room photos at all, fall back to the flat `images`
	// array so older API records still render something.
	if (!thumbs.length && !hasRoomPhotos && Array.isArray(property.images)) {
		const extras = property.images
			.filter(u => u && u !== cover)
			.slice(0, 3)
			.map(u => ({ url: u, room: null }));
		return { cover, thumbs: extras, totalRoomCategories: 0 };
	}

	return { cover, thumbs, totalRoomCategories: uniqueRoomShots.length };
}

// ─── PROPERTY CARD ────────────────────────────────────────────────────────────
const PropertyCard = ({ property, navigate, t, showToast, isHighlighted, onHover, onHoverEnd, onInquire }) => {
	const [isSaved, setIsSaved] = useState(false);

	const { cover: coverImg, thumbs: collageThumbs, totalRoomCategories } = useMemo(
		() => buildRoomCollage(property),
		[property],
	);

	useEffect(() => {
		const savedProps = JSON.parse(localStorage.getItem("savedProperties") || "[]");
		setIsSaved(savedProps.some((p) => p.id === property.id));
	}, [property.id]);

	const handleSave = (e) => {
		e.preventDefault();
		e.stopPropagation();
		let savedProps = JSON.parse(localStorage.getItem("savedProperties") || "[]");
		const isCurrentlySaved = savedProps.some((p) => p.id === property.id);
		if (isCurrentlySaved) {
			savedProps = savedProps.filter((p) => p.id !== property.id);
			setIsSaved(false);
			showToast("Removed from Saved");
		} else {
			savedProps.push({ id: property.id, title: property.title, location: property.location, price: String(property.price ?? ""), beds: property.beds, baths: property.baths, img: coverImg });
			setIsSaved(true);
			showToast("Property Saved Successfully!");
		}
		localStorage.setItem("savedProperties", JSON.stringify(savedProps));
	};

	const discountPercent = property.originalPrice && property.originalPrice > property.price
		? Math.round(((property.originalPrice - property.price) / property.originalPrice) * 100)
		: 0;
	const catEntry = RENTAL_CATEGORIES.find((c) => c.id === property.rentalCategory);
	const catLabel = (catEntry?.tKey && t[catEntry.tKey]) || catEntry?.label || "Others";
	const extraRoomCount = Math.max(0, totalRoomCategories - 1 - collageThumbs.length);

	return (
		<div onMouseEnter={() => onHover && onHover(property.id)} onMouseLeave={() => onHoverEnd && onHoverEnd()} className={`bg-white rounded-3xl border overflow-hidden flex flex-col md:flex-row hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] transition-all duration-500 group ${isHighlighted ? "border-brandRed shadow-[0_0_0_2px_rgba(186,0,54,0.3)]" : "border-gray-100"}`}>
			<div className="w-full md:w-[280px] lg:w-[300px] h-[190px] md:h-auto p-2.5 shrink-0">
				<div className="relative w-full h-full rounded-2xl overflow-hidden flex gap-1.5 bg-gray-100">
					<div className="relative w-[75%] h-full overflow-hidden cursor-pointer" onClick={() => navigate(`/property/${property.id}`)}>
						{coverImg ? (
							<img src={coverImg} alt={property.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-in-out" loading="lazy" decoding="async" />
						) : (
							<div className="w-full h-full flex items-center justify-center text-gray-300 bg-gray-100">
								<Camera size={42} />
							</div>
						)}
						<div className="absolute top-3 left-3 flex flex-col gap-2 items-start">
							{property.verified && (
								<div className="bg-white/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-sm text-[10px] font-black text-brandRed">
									<ShieldCheck size={12} /> {t.verified || "Verified"}
								</div>
							)}
							<span className="bg-brandRed/90 backdrop-blur-md text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg shadow-sm">{catLabel}</span>
						</div>
						<button onClick={handleSave} className="absolute top-3 right-3 p-2 bg-white/80 backdrop-blur-md rounded-full hover:bg-white hover:scale-110 active:scale-95 transition-all z-20 shadow-sm">
							<Heart size={16} className={isSaved ? "fill-brandRed text-brandRed" : "text-gray-700"} />
						</button>
					</div>
					{/* ── ROOM COLLAGE STRIP ──────────────────────────────────────────
					    Renders ONE thumbnail per requested room category (bedroom /
					    bathroom / living / kitchen / other) instead of downloading the whole gallery.
					    Falls back to the flat images list only for older records that
					    did not tag photos by room. */}
					<div className="w-[25%] flex flex-col gap-1.5 h-full">
						{collageThumbs.map((shot, idx) => (
							<div key={`${shot.room || "x"}-${idx}`} className="relative flex-1 overflow-hidden cursor-pointer bg-gray-200" onClick={() => navigate(`/property/${property.id}`)}>
								<img src={shot.url} className="w-full h-full object-cover hover:opacity-80 transition-opacity duration-300" alt={shot.room ? (ROOM_LABEL_FALLBACK[shot.room] || shot.room) : ""} loading="lazy" decoding="async" />
								{shot.room && (
									<span className="absolute bottom-1 left-1 px-1.5 py-[2px] rounded-md bg-black/55 text-white text-[8px] font-black uppercase tracking-wider">
										{ROOM_LABEL_FALLBACK[shot.room] || shot.room}
									</span>
								)}
								{idx === collageThumbs.length - 1 && extraRoomCount > 0 && (
									<div className="absolute inset-0 bg-brandRed/80 backdrop-blur-sm flex items-center justify-center text-white text-xs font-black">+{extraRoomCount}</div>
								)}
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="p-3.5 md:p-4 flex-1 flex flex-col justify-between">
				<div>
					<div className="flex justify-between items-start gap-4 mb-2">
						<div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate(`/property/${property.id}`)}>
							<div className="bg-gray-900 text-white text-[11px] font-black px-2 py-1 rounded-lg flex items-center gap-1 shadow-sm">
								<Star size={10} className="fill-yellow-400 text-yellow-400" /> {property.rating}
							</div>
							<span className="text-xs font-bold text-gray-400 hover:text-brandRed transition-colors">
								{property.reviews} {t.reviews || "Reviews"}
							</span>
						</div>
						<div className="hidden md:flex bg-red-50 px-2.5 py-1 rounded-lg items-center gap-1">
							<Flame size={12} className="fill-brandRed text-brandRed" />
							<span className="text-[10px] font-black text-brandRed uppercase tracking-widest">
								{property.inquiries} {t.inquiriesToday || "Inquiries Today"}
							</span>
						</div>
					</div>
					<h3 className="text-base md:text-lg font-black text-gray-900 leading-tight group-hover:text-brandRed transition-colors cursor-pointer mb-1" onClick={() => navigate(`/property/${property.id}`)}>
						{property.title}
					</h3>
					<p className="text-xs font-bold text-gray-500 flex items-center gap-1.5 mb-2.5">
						<MapPin size={14} className="text-gray-400" /> {property.location}
					</p>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-bold text-gray-600 bg-gray-50 p-2.5 rounded-xl">
						<span className="flex items-center gap-1.5">
							<BedDouble size={14} className="text-gray-400" /> {property.beds} {t.beds || "Beds"}
						</span>
						<span className="flex items-center gap-1.5">
							<Bath size={14} className="text-gray-400" /> {property.baths} {t.baths || "Baths"}
						</span>
						<span className="flex items-center gap-1.5">
							<Square size={14} className="text-gray-400" /> {property.sqft} {t.sqft || "sqft"}
						</span>
						<span className="flex items-center gap-1.5">
							<Layers size={14} className="text-gray-400" /> {(property.floor || property.floorNumber) ? `${t.floorLabel || "Floor"} ${property.floor || property.floorNumber}` : (t.groundFloor || "Ground")}
						</span>
						<span className="hidden sm:flex items-center gap-1.5">
							<Building size={14} className="text-gray-400" />
							{property.furnishing === "Furnished" ? t.furnished || "Furnished" : property.furnishing === "Semi-Furnished" ? t.semiFurnished || "Semi-Furnished" : t.unfurnished || "Unfurnished"}
						</span>
					</div>
				</div>
				<div className="flex flex-col sm:flex-row justify-between items-center gap-2.5 pt-3 mt-3 border-t border-gray-100">
					<div className="w-full sm:w-auto flex flex-col cursor-pointer" onClick={() => navigate(`/property/${property.id}`)}>
						<div className="flex items-baseline gap-2">
							<span className="text-lg md:text-xl font-black text-gray-900 tracking-tighter">৳ {property.price.toLocaleString("en-IN")}</span>
							{property.originalPrice > property.price && (
								<div className="flex items-center gap-2">
									<span className="text-xs text-gray-400 line-through font-bold">৳ {property.originalPrice.toLocaleString("en-IN")}</span>
									<span className="bg-green-100 text-green-700 text-[9px] font-black uppercase px-1.5 py-0.5 rounded">
										{discountPercent}% {t.off || "Off"}
									</span>
								</div>
							)}
						</div>
						<p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">{t.perMonth || "Per Month"}</p>
					</div>
					<div className="flex items-center gap-3 w-full sm:w-auto">
						<button onClick={() => navigate(`/property/${property.id}`)} className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-[11px] font-black text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all">
							{t.detailsBtn || "Details"}
						</button>
						{/* ── INQUIRY BUTTON: opens modal inline, no page navigation ── */}
						<button
							onClick={(e) => {
								e.stopPropagation();
								onInquire(property);
							}}
							className="flex-1 sm:flex-none px-5 py-2 rounded-lg bg-brandRed hover:bg-[#a0002e] text-white text-[11px] font-black shadow-[0_8px_16px_rgba(186,0,54,0.18)] hover:shadow-[0_12px_24px_rgba(186,0,54,0.28)] hover:-translate-y-0.5 active:scale-95 transition-all flex items-center justify-center gap-1.5">
							<MessageCircle size={13} />
							{t.inquireBtn || "Inquire"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};

const PropertyCardSkeleton = () => (
	<div className="bg-white rounded-3xl border border-gray-100 overflow-hidden flex flex-col md:flex-row shadow-sm animate-pulse">
		<div className="w-full md:w-[280px] lg:w-[300px] h-[190px] md:h-auto p-2.5 shrink-0">
			<div className="relative w-full h-full rounded-2xl overflow-hidden flex gap-1.5 bg-gray-100">
				<div className="w-[75%] h-full bg-gray-200" />
				<div className="w-[25%] flex flex-col gap-1.5 h-full">
					<div className="flex-1 bg-gray-200" />
					<div className="flex-1 bg-gray-200" />
					<div className="flex-1 bg-gray-200" />
				</div>
			</div>
		</div>
		<div className="p-3.5 md:p-4 flex-1 flex flex-col justify-between">
			<div>
				<div className="flex justify-between items-start gap-4 mb-3">
					<div className="h-6 w-28 rounded-lg bg-gray-200" />
					<div className="hidden md:block h-6 w-32 rounded-lg bg-gray-100" />
				</div>
				<div className="h-5 w-3/4 rounded bg-gray-200 mb-2" />
				<div className="h-4 w-1/2 rounded bg-gray-100 mb-3" />
				<div className="flex flex-wrap items-center gap-2 bg-gray-50 p-2.5 rounded-xl">
					<div className="h-4 w-16 rounded bg-gray-200" />
					<div className="h-4 w-16 rounded bg-gray-200" />
					<div className="h-4 w-20 rounded bg-gray-200" />
					<div className="h-4 w-20 rounded bg-gray-200" />
				</div>
			</div>
			<div className="flex flex-col sm:flex-row justify-between items-center gap-2.5 pt-3 mt-3 border-t border-gray-100">
				<div className="w-full sm:w-auto">
					<div className="h-6 w-28 rounded bg-gray-200" />
					<div className="h-3 w-20 rounded bg-gray-100 mt-2" />
				</div>
				<div className="flex items-center gap-3 w-full sm:w-auto">
					<div className="h-9 flex-1 sm:w-20 rounded-lg bg-gray-100" />
					<div className="h-9 flex-1 sm:w-24 rounded-lg bg-gray-200" />
				</div>
			</div>
		</div>
	</div>
);

// ─── FILTER SECTION ──────────────────────────────────────────────────────────
const FilterSection = ({ title, children }) => (
	<div className="border-b border-gray-100 last:border-0 pb-6 mb-6">
		<h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-4">{title}</h3>
		{children}
	</div>
);

// ─── MAP VIEW (Google Maps) ──────────────────────────────────────────────────
// Renders an interactive Google Map with custom price-chip markers. A marker
// click bubbles up via `onMarkerClick(property)` so the parent can pop the
// MapMiniCard. Hover/highlight stay in sync with the listing rail on the left.
//
// The `properties` array is fetched by the parent from `propertyService` —
// there is no demo data layer. This component is purely presentational.
const MapView = ({ properties, highlightedId, onMarkerHover, onMarkerHoverEnd, onMarkerClick, searchArea, defaultCenter = DEFAULT_MAP_CENTER, defaultZoom = DEFAULT_MAP_ZOOM }) => {
	const [hoveredId, setHoveredId] = useState(null);
	const [mapInstance, setMapInstance] = useState(null);

	// Memoised options so GoogleMap doesn't re-init on every parent re-render.
	const mapOptions = useMemo(
		() => ({
			disableDefaultUI: false,
			mapTypeControl: false,
			streetViewControl: false,
			fullscreenControl: false,
			clickableIcons: false,
			gestureHandling: "greedy",
			styles: MAP_STYLES,
		}),
		[]
	);

	// Load the Maps JS SDK once per page (the loader de-duplicates internally).
	// NOTE: `libraries` prop is intentionally omitted — passing an empty array
	// causes an internal constructor crash in some versions of @react-google-maps/api.
	const { isLoaded, loadError } = useJsApiLoader({
		id: "tlp-google-map-script",
		googleMapsApiKey: GOOGLE_MAPS_API_KEY,
	});

	// TODO (backend): when the user pans/zooms the map, refetch properties
	// inside the new viewport bounds:
	//
	//   <GoogleMap onIdle={() => {
	//     const b = mapInstance.getBounds();
	//     if (!b) return;
	//     const ne = b.getNorthEast(), sw = b.getSouthWest();
	//     api.get('/api/properties', { params: {
	//       neLat: ne.lat(), neLng: ne.lng(), swLat: sw.lat(), swLng: sw.lng()
	//     }}).then(r => setProperties(r.data));
	//   }} ... />
	//
	// Hook is intentionally left commented so the demo data still works as-is.

	// When the search area or property set changes, fit the map to the matches.
	useEffect(() => {
		if (!mapInstance || !window.google) return;
		// `properties` is already the (server-side) search-filtered set — fit the
		// map to all of them instead of re-filtering by the raw search text.
		const points = properties.filter((p) => p.lat && p.lng);
		if (points.length === 0) return;
		if (points.length === 1) {
			mapInstance.panTo({ lat: points[0].lat, lng: points[0].lng });
			mapInstance.setZoom(14);
			return;
		}
		const bounds = new window.google.maps.LatLngBounds();
		points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
		mapInstance.fitBounds(bounds, 64);
	}, [properties, mapInstance]);

	const onLoad = useCallback((map) => setMapInstance(map), []);
	const onUnmount = useCallback(() => setMapInstance(null), []);

	// ── Fallback: no API key → public iframe embed (no key required) ──────────
	// Lets the page keep rendering before the key is provisioned.
	if (!GOOGLE_MAPS_API_KEY) {
		return (
			<div className="relative w-full h-full rounded-[2rem] overflow-hidden bg-gray-100">
				<iframe
					title="Properties map"
					src={`https://www.google.com/maps?q=${defaultCenter.lat},${defaultCenter.lng}&hl=en&z=${defaultZoom}&output=embed`}
					width="100%"
					height="100%"
					loading="lazy"
					referrerPolicy="no-referrer-when-downgrade"
					style={{ border: "none", minHeight: 400 }}
					allowFullScreen
				/>
				<div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-lg text-[10px] font-bold text-gray-600 shadow-sm border border-gray-100">
					Add VITE_GOOGLE_MAPS_API_KEY to enable interactive markers
				</div>
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="relative w-full h-full rounded-[2rem] overflow-hidden bg-gray-50 flex items-center justify-center" style={{ minHeight: 400 }}>
				<div className="text-center px-6">
					<div className="w-12 h-12 mx-auto rounded-full bg-red-50 flex items-center justify-center mb-3">
						<MapPin size={20} className="text-brandRed" />
					</div>
					<p className="text-sm font-black text-gray-900 mb-1">Couldn't load Google Maps</p>
					<p className="text-xs font-bold text-gray-500">Check the API key, billing status, and HTTP referrer restrictions.</p>
				</div>
			</div>
		);
	}

	if (!isLoaded) {
		return (
			<div className="relative w-full h-full rounded-[2rem] overflow-hidden bg-gray-50 flex items-center justify-center" style={{ minHeight: 400 }}>
				<div className="flex flex-col items-center gap-3">
					<div className="w-10 h-10 border-4 border-brandRed border-t-transparent rounded-full animate-spin" />
					<span className="text-sm font-bold text-gray-400">Loading map…</span>
				</div>
			</div>
		);
	}

	return (
		<div className="relative w-full h-full rounded-[2rem] overflow-hidden bg-gray-100">
			<GoogleMap
				mapContainerStyle={{ width: "100%", height: "100%", minHeight: 400 }}
				center={defaultCenter}
				zoom={defaultZoom}
				options={mapOptions}
				onLoad={onLoad}
				onUnmount={onUnmount}
			>
				{properties.map((prop) => {
					if (!prop.lat || !prop.lng) return null;
					const isActive = highlightedId === prop.id || hoveredId === prop.id;
					return (
						<OverlayViewF
							key={prop.id}
							position={{ lat: prop.lat, lng: prop.lng }}
							mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
							getPixelPositionOffset={(width, height) => ({ x: -width / 2, y: -height + 6 })}
						>
							{/* OYO-style price pill: dark by default, brand red when active, with a
							    downward pointer that anchors the chip on the marker coordinate. */}
							<button
								type="button"
								onMouseEnter={() => {
									setHoveredId(prop.id);
									onMarkerHover && onMarkerHover(prop.id);
								}}
								onMouseLeave={() => {
									setHoveredId(null);
									onMarkerHoverEnd && onMarkerHoverEnd();
								}}
								onClick={() => onMarkerClick && onMarkerClick(prop)}
								aria-label={`${prop.title} — ৳${prop.price.toLocaleString("en-IN")}`}
								className="map-price-marker relative"
								style={{
									background: isActive ? "#BA0036" : "#111827",
									color: "#ffffff",
									fontSize: 11,
									fontWeight: 900,
									padding: "6px 11px",
									borderRadius: 9999,
									whiteSpace: "nowrap",
									boxShadow: isActive
										? "0 6px 22px rgba(186,0,54,0.45)"
										: "0 6px 18px rgba(17,24,39,0.32)",
									cursor: "pointer",
									border: "2px solid #ffffff",
									transition: "transform 0.18s ease, background 0.18s ease",
									transform: isActive ? "scale(1.12)" : "scale(1)",
									transformOrigin: "center bottom",
									zIndex: isActive ? 9999 : 1,
									outline: "none",
								}}
							>
								৳{(prop.price / 1000).toFixed(0)}k
								{/* Downward pointer (chat-bubble style, matches OYO markers) */}
								<span
									aria-hidden
									style={{
										position: "absolute",
										left: "50%",
										bottom: -5,
										transform: "translateX(-50%)",
										width: 0,
										height: 0,
										borderLeft: "6px solid transparent",
										borderRight: "6px solid transparent",
										borderTop: `7px solid ${isActive ? "#BA0036" : "#111827"}`,
										filter: "drop-shadow(0 2px 1px rgba(0,0,0,0.18))",
									}}
								/>
							</button>
						</OverlayViewF>
					);
				})}
			</GoogleMap>
		</div>
	);
};

// ─── MAP MINI CARD (bottom card on map marker click) ──────────────────────────
// Matches the OYO map reference: a slim horizontal card with the property
// photo on the left and a compact title/price/rating block on the right.
// Used by both mobile and desktop map views — the bottom dock with Filter/List
// renders below it.
//   • Tap the card body  → navigate to the full property page.
//   • Tap "Inquire"      → open the global inquiry modal.
//   • Tap the × button   → close the preview, keep the map state.
const MapMiniCard = ({ property, navigate, onClose, onInquire, t }) => {
	if (!property) return null;
	return (
		<AnimatePresence>
			<motion.div
				key={property.id}
				initial={{ opacity: 0, y: 40 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: 40 }}
				transition={{ type: "spring", damping: 28, stiffness: 240 }}
				className="
					relative bg-white shadow-[0_18px_40px_rgba(0,0,0,0.18)] rounded-2xl
					overflow-hidden border border-gray-100 max-w-[560px] mx-auto
				"
				role="dialog"
				aria-label={`${property.title} preview`}
			>
				<div
					onClick={() => navigate(`/property/${property.id}`)}
					className="flex cursor-pointer"
				>
					{/* Photo */}
					<div className="relative w-[130px] sm:w-[150px] h-[130px] sm:h-[140px] shrink-0 bg-gray-100">
						<img
							src={property.images[0] || property.img || property.coverPhoto || ""}
							alt={property.title}
							className="absolute inset-0 w-full h-full object-cover"
							loading="lazy"
							decoding="async"
						/>
						<div className="absolute bottom-2 left-2 bg-white/95 backdrop-blur px-1.5 py-0.5 rounded-md flex items-center gap-1 text-[10px] font-black">
							<Star size={10} className="fill-yellow-400 text-yellow-400" />
							{property.rating}
							<span className="text-gray-400 font-bold">({property.reviews})</span>
						</div>
					</div>

					{/* Info */}
					<div className="flex-1 min-w-0 p-3 sm:p-4 pr-9 flex flex-col">
						{(() => {
							const cat = RENTAL_CATEGORIES.find((c) => c.id === property.rentalCategory);
							const label = (cat?.tKey && t[cat.tKey]) || cat?.label || "Property";
							return (
								<p className="text-[10px] font-black text-brandRed uppercase tracking-widest mb-1 line-clamp-1">{label}</p>
							);
						})()}
						<p className="text-sm sm:text-[15px] font-black text-gray-900 leading-tight line-clamp-2 mb-1">
							{property.title}
						</p>
						<p className="text-[11px] text-gray-500 font-bold flex items-center gap-1 line-clamp-1 mb-2">
							<MapPin size={10} className="shrink-0" />
							<span className="truncate">{property.location}</span>
						</p>
						<div className="mt-auto flex items-baseline gap-2 flex-wrap">
							<span className="text-base sm:text-lg font-black text-gray-900">
								৳{property.price.toLocaleString("en-IN")}
							</span>
							<span className="text-[10px] text-gray-500 font-bold">/{t?.monthText || "month"}</span>
						</div>
						<div className="mt-2 flex items-center gap-3 text-[10px] font-bold text-gray-500">
							<span className="flex items-center gap-1"><BedDouble size={11} /> {property.beds}</span>
							<span className="flex items-center gap-1"><Bath size={11} /> {property.baths}</span>
							<span className="flex items-center gap-1"><Square size={11} /> {property.sqft}</span>
						</div>
					</div>
				</div>

				{/* Inquire CTA — anchored bottom-right inside the card */}
				<button
					onClick={(e) => {
						e.stopPropagation();
						onClose();
						onInquire(property);
					}}
					className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-brandRed text-white text-[11px] font-black active:scale-95 transition-transform flex items-center gap-1 shadow-md"
				>
					<MessageCircle size={11} /> {t?.inquireBtn || "INQUIRE"}
				</button>

				{/* Close */}
				<button
					onClick={onClose}
					aria-label="Close preview"
					className="absolute top-2 right-2 z-10 p-1.5 bg-white/95 backdrop-blur rounded-full hover:bg-gray-100 active:scale-95 transition-all shadow-sm border border-gray-100"
				>
					<X size={13} className="text-gray-600" />
				</button>
			</motion.div>
		</AnimatePresence>
	);
};

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
const PropertyListing = () => {
	const navigate = useNavigate();
	const { t } = useLanguage();
	const [searchParams, setSearchParams] = useSearchParams();
	const { scrollY } = useScroll();

    // ── NEW LOGIC TO PARSE THE URL SAFELY ──
	const { divisionName } = useParams();
	const routeParam = divisionName ? divisionName.toLowerCase() : "all";

	// Determine if the URL parameter is a known division, or a custom area search (like 'dhanmondi-dhaka')
	const isKnownDivision = validDivisions.includes(routeParam);
	const activeDivision = isKnownDivision ? routeParam : "all";
	// Extract the area name from the URL slug. Restore spaces from hyphens
	// so "/properties/dhanmondi-12" searches for "dhanmondi 12" (full phrase),
	// not just "dhanmondi". The downstream filter does case-insensitive
	// substring matching against every location-ish field on the property,
	// so this also matches a property where area="Dhanmondi" and the address
	// line has "Dhanmondi 12".
	const initialSearchAreaFromURL = searchParams.get("q") 
		? searchParams.get("q") 
		: (!isKnownDivision && routeParam !== "all")
			? routeParam.replace(/-/g, ' ')
			: "";

	const formattedDivision = (t.cities && t.cities[activeDivision]) || (t.districtNames && t.districtNames[activeDivision]) || (activeDivision === 'all' ? (t.allCities || "All") : activeDivision.charAt(0).toUpperCase() + activeDivision.slice(1));


	// ── INQUIRY MODAL STATE ─────────────────────────────────────────────────────
	// inquiryTarget: the property object the user wants to inquire about (null = modal closed)
	const [inquiryTarget, setInquiryTarget] = useState(null);
	const [inquiryLandlord, setInquiryLandlord] = useState(null);

	const openInquiry = (property) => setInquiryTarget(property);
	const closeInquiry = () => { setInquiryTarget(null); setInquiryLandlord(null); };

	// ── LIVE PROPERTY DATA ──────────────────────────────────────────────────────
	// Pulled from propertyService — backend first, localStorage fallback. No
	// demo data is merged in anywhere; an empty list is a legitimate state.
	const [properties, setProperties] = useState([]);
	const [isPropertiesLoading, setIsPropertiesLoading] = useState(true);
	const [propertyLoadError, setPropertyLoadError] = useState("");
	const [propertyRefreshTick, setPropertyRefreshTick] = useState(0);

	// ── UI STATES ───────────────────────────────────────────────────────────────
	const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
	const [toastMessage, setToastMessage] = useState(null);
	const [isStickyFilter, setIsStickyFilter] = useState(false);
	const [isLocating, setIsLocating] = useState(false);
	const [viewMode, setViewMode] = useState("list");
	const [highlightedId, setHighlightedId] = useState(null);
	const [selectedMapProperty, setSelectedMapProperty] = useState(null);
	const [openSections, setOpenSections] = useState([]);

	// ── FILTER STATES ───────────────────────────────────────────────────────────
	const [searchArea, setSearchArea] = useState(initialSearchAreaFromURL);
	// Debounced mirror of the search box → drives the server-side `q` fetch so
	// we don't hit the API on every keystroke. The header/input use `searchArea`
	// directly so typing still feels instant.
	const [debouncedSearch, setDebouncedSearch] = useState(initialSearchAreaFromURL);
	useEffect(() => {
		const id = setTimeout(() => setDebouncedSearch(searchArea), 300);
		return () => clearTimeout(id);
	}, [searchArea]);
	// Visibility of the location autocomplete dropdown.
	const [showSuggest, setShowSuggest] = useState(false);
	// Default to 0 so freshly-uploaded test listings priced below 5000 BDT
	// (very common in dev/QA — placeholder rents of 2000–3000) still show
	// up out of the box. Users can drag the slider up if they want a real
	// floor.
	const [minPrice, setMinPrice] = useState(0);
	const [maxPrice, setMaxPrice] = useState(300000);
	const [selectedIntent, setSelectedIntent] = useState("");
	const [selectedTypes, setSelectedTypes] = useState([]);
	const [selectedCategories, setSelectedCategories] = useState([]);
	const [selectedBeds, setSelectedBeds] = useState("any");
	const [selectedBathType, setSelectedBathType] = useState([]);
	const [maxSqft, setMaxSqft] = useState(4000);
	const [selectedUtilities, setSelectedUtilities] = useState([]);
	const [selectedTenants, setSelectedTenants] = useState([]);
	const [selectedFurnish, setSelectedFurnish] = useState("");
	const [selectedAmenities, setSelectedAmenities] = useState([]);
	const [selectedFloor, setSelectedFloor] = useState(t.anyFloor || "Any Floor");
	const [minRating, setMinRating] = useState(0);
	const [sortBy, setSortBy] = useState("Newest Listings");

	useMotionValueEvent(scrollY, "change", (latest) => {
		setIsStickyFilter(latest > 120);
	});

	// ── LOAD PROPERTIES (live, no demo merge) ───────────────────────────────────
	// Re-fetches whenever the route division changes and re-subscribes so a new
	// upload from another tab / from Add Property shows up immediately.
	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			if (!cancelled) {
				setIsPropertiesLoading(true);
				setPropertyLoadError("");
			}
			try {
				const list = await propertyService.getProperties(
					{ activeDivision, searchArea: debouncedSearch, nearMeLabel: t.nearMe || "Nearby Location", intent: selectedIntent, selectedCategories, selectedTypes, minPrice, maxPrice },
					sortBy,
				);
				if (!cancelled) setProperties(Array.isArray(list) ? list : []);
			} catch (err) {
				if (!cancelled) {
					setProperties([]);
					setPropertyLoadError(err?.message || "Could not load properties. Please try again.");
				}
			} finally {
				if (!cancelled) setIsPropertiesLoading(false);
			}
		};
		load();
		const unsub = subscribeUserProperties(load);
		return () => { cancelled = true; unsub && unsub(); };
	}, [activeDivision, debouncedSearch, selectedIntent, selectedCategories, selectedTypes, minPrice, maxPrice, propertyRefreshTick, sortBy, t.nearMe]);

	// ── LANDLORD LOOKUP FOR INQUIRY ─────────────────────────────────────────────
	// Look up the landlord lazily when the inquiry modal opens so we don't issue
	// a request per card render. If no landlord record exists yet (host hasn't
	// uploaded), we still open the inquiry — the modal handles a null landlord.
	useEffect(() => {
		let cancelled = false;
		if (!inquiryTarget) { setInquiryLandlord(null); return; }
		(async () => {
			const ll = await propertyService.getLandlord(inquiryTarget.landlordId);
			if (!cancelled) setInquiryLandlord(ll);
		})();
		return () => { cancelled = true; };
	}, [inquiryTarget]);

	useEffect(() => {
		window.scrollTo(0, 0);

		// ── Budget ────────────────────────────────────────────────────────────────
		const initialBudget = searchParams.get("budget");
		if (initialBudget === "low") { setMinPrice(5000);   setMaxPrice(20000); }
		else if (initialBudget === "mid")     { setMinPrice(20000);  setMaxPrice(50000); }
		else if (initialBudget === "high")    { setMinPrice(50000);  setMaxPrice(100000); }
		else if (initialBudget === "premium") { setMinPrice(100000); setMaxPrice(300000); }
		else if (initialBudget && initialBudget.includes("-")) {
			const [mn, mx] = initialBudget.split("-").map(Number);
			if (!isNaN(mn) && !isNaN(mx)) { setMinPrice(mn); setMaxPrice(mx); }
		}

		// ── Intent / Purpose ──────────────────────────────────────────────────────
		const initialPurpose = searchParams.get("purpose");
		if (initialPurpose === 'buy') {
			setSelectedIntent('buy');
		} else if (initialPurpose === 'rent') {
			setSelectedIntent('rent');
		} else if (initialPurpose === 'commercial') {
			setSelectedIntent('commercial');
		}

		// ── Property Type (prop.type: apartment / studio / duplex …) ─────────────
		// Comes from the sidebar "Property Type" checkboxes.
		const initialType = searchParams.get("type");
		if (initialType && initialType !== "any") setSelectedTypes([initialType]);

		// ── Rental Category (prop.rentalCategory: family / bachelor_male …) ──────
		// ⚠️  This is the FIX: Hero & Navbar both send ?category=… (NOT ?type=…)
		//     Routing 'category' to selectedCategories makes Family/Bachelor filters work.
		const initialCategory = searchParams.get("category");
		if (initialCategory && initialCategory !== "any" && initialCategory !== "any_commercial" && initialCategory !== "any_buy") {
			setSelectedCategories([initialCategory]);
		}

		// ── Location fallback from explicit ?location= param ─────────────────────
		const urlLocation = searchParams.get("location");
		if (urlLocation && !searchArea) {
			setSearchArea(urlLocation.split(",")[0]);
		}
	}, [searchParams]);

	const handleNearestMe = () => {
		setIsLocating(true);
		if ("geolocation" in navigator) {
			navigator.geolocation.getCurrentPosition(
				() => {
					setIsLocating(false);
					setSearchArea(t.nearMe || "Nearby Location");
					showToast("Live location applied!");
				},
				() => {
					setIsLocating(false);
					showToast("Please enable location permissions.");
				}
			);
		} else {
			setIsLocating(false);
			showToast("Geolocation not supported.");
		}
	};

	const showToast = (msg) => {
		setToastMessage(msg);
		setTimeout(() => setToastMessage(null), 3000);
	};

	const handleClearAll = () => {
		setSearchArea("");
		setMinPrice(0);
		setMaxPrice(300000);
		setSelectedTypes([]);
		setSelectedCategories([]);
		setSelectedBeds("any");
		setSelectedBathType([]);
		setMaxSqft(4000);
		setSelectedUtilities([]);
		setSelectedTenants([]);
		setSelectedFurnish("");
		setSelectedAmenities([]);
		setSelectedFloor(t.anyFloor || "Any Floor");
		setMinRating(0);
		setSortBy("Newest Listings");
		setSearchParams({});
		window.scrollTo({ top: 0, behavior: "smooth" });
        // Force redirect to /properties/all so the 'dhanmondi-dhaka' path is also wiped
		navigate("/properties/all");
	};

	const toggleSection = (section) => setOpenSections((prev) => (prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]));
	const handleTypeToggle = (typeId) => setSelectedTypes((prev) => (prev.includes(typeId) ? prev.filter((t) => t !== typeId) : [...prev, typeId]));
	const toggleArrayState = (setter, item) => setter((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));

	const handleSave = (e, property) => {
		e.preventDefault();
		e.stopPropagation();
		let savedProps = JSON.parse(localStorage.getItem("savedProperties") || "[]");
		const isCurrentlySaved = savedProps.some((p) => p.id === property.id);
		if (isCurrentlySaved) {
			savedProps = savedProps.filter((p) => p.id !== property.id);
			showToast("Removed from Saved");
		} else {
			savedProps.push({ id: property.id, title: property.title, location: property.location, price: property.price.toString(), beds: property.beds, baths: property.baths, img: property.images[0] });
			showToast("Property Saved Successfully!");
		}
		localStorage.setItem("savedProperties", JSON.stringify(savedProps));
	};

    // ── FILTER + SORT (over the live properties state) ─────────────────────────
	// Same shape as the propertyService.applyFilters helper, just inlined so it
	// can read directly from the sidebar state without a serialisation step.
	const filteredProperties = useMemo(() => {
		// Text search is handled server-side now (the `q` param → $text + regex
		// over the rich haystack). We deliberately do NOT re-filter by the
		// search term here — that would undo the server's alias / multi-word
		// matches. Everything else (price/beds/sqft/floor/…) stays client-side.
		const list = (properties || []).filter((prop) => {
			if (activeDivision !== "all" && prop.division !== activeDivision) return false;
			if (prop.price < minPrice || prop.price > maxPrice) return false;
			if (selectedTypes.length > 0 && !selectedTypes.includes(prop.type)) return false;
			if (selectedCategories.length > 0 && !selectedCategories.includes(prop.rentalCategory)) return false;
			if (selectedBeds !== "any") {
				if (selectedBeds === "4+" && prop.beds < 4) return false;
				if (selectedBeds !== "4+" && prop.beds !== Number(selectedBeds)) return false;
			}
			if ((prop.sqft || 0) > maxSqft) return false;
			if (selectedFurnish && prop.furnishing !== selectedFurnish) return false;
			if (minRating > 0 && (prop.rating || 0) < minRating) return false;
			if (selectedFloor && selectedFloor !== (t.anyFloor || "Any Floor")) {
				const fl = Number(prop.floor) || 0;
				if (selectedFloor === (t.groundFloor || "Ground Floor")) { if (fl !== 0) return false; }
				else if (selectedFloor === (t.floor1to3 || "1st to 3rd Floor")) { if (fl < 1 || fl > 3) return false; }
			}
			return true;
		});
		list.sort((a, b) => {
			if (sortBy === "Price: Low to High") return a.price - b.price;
			if (sortBy === "Price: High to Low") return b.price - a.price;
			if (sortBy === "Popular")            return (b.popularity || 0) - (a.popularity || 0);
			return new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0);
		});
		return list;
	}, [properties, activeDivision, minPrice, maxPrice, selectedTypes, selectedCategories, selectedBeds, maxSqft, selectedFurnish, minRating, selectedFloor, sortBy]);

	// ── LOCATION AUTOCOMPLETE ────────────────────────────────────────────────
	// Distinct, human-readable place labels pulled from the loaded listings'
	// own `area` / `location` fields (the granular names hosts entered), each
	// tagged with its district for context. Lets a tenant jump straight to e.g.
	// "Lalmohan" instead of browsing the whole district.
	//
	// NOTE: We use a plain object instead of `new Map()` here because the
	// lucide-react `Map` icon is imported in this file and shadows the built-in
	// JavaScript Map class — causing a "Map is not a constructor" crash when
	// bundled/minified by Vite.
	const locationSuggestions = useMemo(() => {
		const seen = {};
		for (const p of properties || []) {
			for (const cand of [{ label: p.thana, sub: p.district || p.division }, { label: p.area, sub: p.district || p.division }, { label: p.location, sub: p.district || p.division }]) {
				const label = String(cand.label || "").trim();
				if (!label) continue;
				const key = label.toLowerCase();
				if (!seen[key]) seen[key] = { label, sub: String(cand.sub || "").trim() };
			}
		}
		return Object.values(seen);
	}, [properties]);

	const matchingSuggestions = useMemo(() => {
		const q = (searchArea || "").trim().toLowerCase();
		if (q.length < 1) return [];
		const out = locationSuggestions.filter((s) => {
			const l = s.label.toLowerCase();
			return l.includes(q) && l !== q;
		});
		out.sort((a, b) => {
			const aS = a.label.toLowerCase().startsWith(q) ? 0 : 1;
			const bS = b.label.toLowerCase().startsWith(q) ? 0 : 1;
			return aS - bS || a.label.localeCompare(b.label);
		});
		return out.slice(0, 6);
	}, [locationSuggestions, searchArea]);

	const isMapMode = viewMode === "map";
	const resultCountLabel = isPropertiesLoading ? "..." : filteredProperties.length;

	return (
		<div className="w-full bg-[#f8f9fa] min-h-screen font-sans pb-20 relative">
			{/* TOAST */}
			<AnimatePresence>
				{toastMessage && (
					<motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-4 rounded-2xl shadow-2xl z-[100] flex items-center gap-3 text-sm font-bold whitespace-nowrap border border-gray-700">
						<CheckCircle2 size={20} className="text-[#1ab64f]" /> {toastMessage}
					</motion.div>
				)}
			</AnimatePresence>

			{/* STICKY TOP BAR (desktop) */}
			<motion.div initial={{ y: -100 }} animate={{ y: isStickyFilter ? 0 : -100 }} transition={{ duration: 0.3 }} className="fixed top-0 inset-x-0 z-40 bg-white border-b-2 border-gray-900 hidden lg:block">
				<div className="max-w-[1400px] mx-auto px-4 h-16 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<span className="border-2 border-gray-900 text-gray-900 text-xs font-black px-4 py-1.5 rounded-lg flex items-center gap-1 uppercase tracking-wide shadow-[2px_2px_0_0_#ba0036]">
                            {searchArea ? searchArea.charAt(0).toUpperCase() + searchArea.slice(1) : formattedDivision}
                        </span>
						<span className="text-gray-500 font-bold text-sm">
							{t.showing || "Showing"} <strong className="text-gray-900">{resultCountLabel}</strong> {t.properties || "properties"}
						</span>
					</div>
					<button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="text-sm font-black text-gray-900 hover:text-[#ba0036] transition-colors flex items-center gap-2 uppercase tracking-wide border-b-2 border-gray-900 hover:border-[#ba0036] pb-0.5">
						<Filter size={14} /> {t.backToTop || "Back to Top"}
					</button>
				</div>
			</motion.div>

			{/* ═══════════════════════════════════════════════════════════════
			    MOBILE: Daraz-style immersive header — replaces global Navbar
			    ─────────────────────────────────────────────────────────────── */}
			<div className="md:hidden sticky top-0 z-40 bg-white shadow-sm">
				{/* Row 1: Back arrow · Search bar · Sort icon */}
				<div className="flex items-center gap-2 px-3 pt-3 pb-2">
					<button
						onClick={() => window.history.length > 2 ? navigate(-1) : navigate("/")}
						className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0 active:scale-90 transition-transform"
						aria-label="Go back">
						<ArrowLeft size={18} className="text-gray-800" />
					</button>
					<div className="flex-1 relative">
						<input
							type="text"
							value={searchArea}
							onChange={(e) => setSearchArea(e.target.value)}
							placeholder={t.searchAreaPlaceholder || "Search area, location..."}
							className="w-full bg-gray-100 rounded-full py-2.5 pl-9 pr-8 text-[13px] font-bold text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-brandRed/30 transition-all"
						/>
						<Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
						{searchArea && (
							<button
								onClick={() => setSearchArea("")}
								className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-gray-300 text-white active:scale-90 transition-transform"
								aria-label="Clear search">
								<X size={12} />
							</button>
						)}
					</div>
				</div>

				{/* Row 2: Sort Dropdown, Filter, Map */}
				<div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-white">
					{/* Sort Dropdown */}
					<div className="flex items-center gap-2 flex-1">
						<select 
							value={sortBy} 
							onChange={(e) => setSortBy(e.target.value)} 
							className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] font-bold text-gray-900 outline-none focus:border-brandRed cursor-pointer"
						>
							<option value="Newest Listings">{t.sortNewest || "Newest Listings"}</option>
							<option value="Price: Low to High">{t.sortPriceLowHigh || "Price: Low to High"}</option>
							<option value="Price: High to Low">{t.sortPriceHighLow || "Price: High to Low"}</option>
							<option value="Popular">{t.sortPopular || "Popular"}</option>
						</select>
					</div>
					
					<div className="flex items-center gap-2 shrink-0">
						{/* Filter button */}
						<button
							onClick={() => setIsMobileFilterOpen(true)}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-black border transition-all active:scale-95 ${
								(selectedCategories.length > 0 || selectedFurnish || selectedBeds !== "any" || minRating > 0)
									? "bg-brandRed text-white border-brandRed shadow-sm"
									: "bg-white text-gray-700 border-gray-200"
							}`}>
							<Filter size={14} />
							{t.filtersBtn || "Filters"}
						</button>

						{/* Map button */}
						<button
							onClick={() => setViewMode((v) => (v === "map" ? "list" : "map"))}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-black border transition-all active:scale-95 ${
								isMapMode
									? "bg-brandRed text-white border-brandRed shadow-sm"
									: "bg-white text-gray-700 border-gray-200"
							}`}>
							{isMapMode ? <List size={14} /> : <Map size={14} />}
							{isMapMode ? "List" : "Map"}
						</button>
					</div>
				</div>

				{/* Row 3: Results count + location context */}
				<div className="flex items-center justify-between px-3 py-1.5 bg-gray-50/80">
					<span className="text-[11px] font-bold text-gray-500">
						<strong className="text-gray-900">{resultCountLabel}</strong> {t.properties || "প্রপার্টি"} · {searchArea ? searchArea.charAt(0).toUpperCase() + searchArea.slice(1) : formattedDivision}
					</span>
					{searchArea && (
						<button onClick={() => setSearchArea("")} className="text-[10px] font-black text-brandRed active:scale-95 transition-transform">
							{t.clearAll || "Clear"}
						</button>
					)}
				</div>
			</div>

			{/* Old desktop-only top bar — hidden on mobile since the new header above replaces it */}
			<div className="hidden md:block">
				<div className={`bg-white border-b border-gray-100 sticky top-[72px] z-30 shadow-sm`}>
					<div className="max-w-[1400px] mx-auto px-4 h-16 flex items-center justify-between gap-3">
						<span className="text-sm font-bold text-gray-900 truncate">
							{searchArea ? searchArea.charAt(0).toUpperCase() + searchArea.slice(1) : formattedDivision} {t.properties || "Properties"}
						</span>
						<div className="flex items-center gap-2 shrink-0">
							<button onClick={() => setIsMobileFilterOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-full text-sm font-bold text-gray-700 active:scale-95 transition-transform">
								<Filter size={16} /> {t.filtersBtn || "Filters"}
							</button>
						</div>
					</div>
				</div>
			</div>

			<div className="max-w-[1400px] mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-8 items-start">
				{/* Backdrop. On mobile it shows whenever the filter sheet is open.
				    In map mode it ALSO shows on desktop because the filter renders as a
				    full sheet over the OYO map at every breakpoint. */}
				{isMobileFilterOpen && (
					<div
						className={`fixed inset-0 bg-black/50 transition-opacity ${
							isMapMode ? "z-[75]" : "z-40 lg:hidden"
						}`}
						onClick={() => setIsMobileFilterOpen(false)}
					/>
				)}

				{/* SIDEBAR FILTERS
				    Two render modes:
				      • Default (list view)  → desktop: in-flow sticky sidebar; mobile: bottom-sheet
				      • Map mode             → bottom-sheet on EVERY breakpoint so the Filter
				                                button in the map's bottom dock can open it on top
				                                of the full-screen map. */}
				<aside className={`bg-white max-h-[90vh] overflow-y-auto transition-transform duration-300 transform ${
					isMapMode
						? `fixed inset-x-0 bottom-0 z-[80] rounded-t-[2rem] ${isMobileFilterOpen ? "translate-y-0" : "translate-y-full"}`
						: `fixed inset-x-0 bottom-0 z-50 rounded-t-[2rem] lg:sticky lg:top-[90px] lg:z-10 lg:h-[calc(100vh-110px)] lg:block lg:rounded-[2rem] lg:border lg:border-gray-100 lg:shadow-sm lg:p-0 ${isMobileFilterOpen ? "translate-y-0" : "translate-y-full lg:translate-y-0"}`
				}`}>
					<div className={`sticky top-0 bg-white z-20 px-6 pt-4 pb-2 border-b border-gray-50 rounded-t-[2rem] ${isMapMode ? "" : "lg:hidden"}`}>
						<div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-4"></div>
						<div className="flex justify-between items-center mb-2">
							<h2 className="text-xl font-black text-gray-900">{t.filtersBtn || "Filters"}</h2>
							<div className="flex items-center gap-2">
								<button onClick={handleClearAll} className="text-[11px] font-black text-[#ba0036] uppercase tracking-wider px-2 py-1 rounded-md hover:bg-red-50 transition-colors">
									{t.clearAll || "Clear All"}
								</button>
								<button onClick={() => setIsMobileFilterOpen(false)} aria-label="Close filters" className="p-2 bg-gray-100 rounded-full active:scale-95 transition-transform">
									<X size={18} />
								</button>
							</div>
						</div>
					</div>

					<div className="p-6 lg:p-6 lg:h-full lg:overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
						<div className="hidden lg:flex justify-between items-center mb-8 border-b-2 border-gray-900 pb-4">
							<h2 className="text-xl font-black text-gray-900 uppercase tracking-wider">{t.filtersBtn || "Filters"}</h2>
							<button onClick={handleClearAll} className="text-xs font-black text-[#ba0036] hover:text-gray-900 uppercase tracking-widest transition-colors border-b-2 border-transparent hover:border-gray-900">
								{t.clearAll || "Clear All"}
							</button>
						</div>

						<FilterSection title={t.filterLocation || "Location"}>
							{/* Search input — desktop sidebar only.
							    On mobile the top bar search already handles this. */}
							<div className="hidden lg:block relative mb-4">
								<input type="text" value={searchArea} onChange={(e) => { setSearchArea(e.target.value); setShowSuggest(true); }} onFocus={() => setShowSuggest(true)} onBlur={() => setTimeout(() => setShowSuggest(false), 120)} placeholder={t.searchAreaPlaceholder || "Search area..."} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-24 text-xs font-bold focus:border-brandRed outline-none" />
								<Search size={14} className="absolute left-3.5 top-3.5 text-gray-400" />
								<button onClick={handleNearestMe} disabled={isLocating} className="absolute right-2 top-2 bg-white border border-gray-200 shadow-sm text-[9px] font-black uppercase text-brandRed px-2 py-1 rounded-lg flex items-center gap-1 hover:bg-red-50 transition-colors">
									<Navigation size={10} className={isLocating ? "animate-spin" : ""} /> {isLocating ? t.locating || "Locating" : t.nearMe || "Near Me"}
								</button>
								{showSuggest && matchingSuggestions.length > 0 && (
									<div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-100 rounded-xl shadow-[0_12px_30px_rgba(0,0,0,0.10)] z-40 overflow-hidden">
										{matchingSuggestions.map((s, i) => (
											<button
												key={`${s.label}-${i}`}
												onMouseDown={(e) => { e.preventDefault(); setSearchArea(s.label); setShowSuggest(false); }}
												className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
												<MapPin size={13} className="text-brandRed shrink-0" />
												<span className="text-xs font-bold text-gray-900 truncate">{s.label}</span>
												{s.sub && <span className="text-[10px] font-bold text-gray-400 ml-auto uppercase tracking-wide shrink-0 capitalize">{s.sub}</span>}
											</button>
										))}
									</div>
								)}
							</div>
							<div className="flex flex-wrap gap-2">
								{[t.districtNames?.gulshan || "Gulshan", t.districtNames?.banani || "Banani", t.districtNames?.dhanmondi || "Dhanmondi", t.districtNames?.bashundhara || "Bashundhara"].map((area) => (
									<button key={area} onClick={() => setSearchArea(searchArea === area ? "" : area)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${searchArea === area ? "bg-brandRed text-white border-brandRed shadow-md" : "bg-gray-50 text-gray-600 border-transparent hover:border-brandRed hover:text-brandRed"}`}>
										{area}
									</button>
								))}
							</div>
						</FilterSection>

						<FilterSection title={t.filterPrice || "Price Range"}>
							<div className="px-2 pb-4">
								{/* Quick budget pills — one tap sets the min/max range. */}
								<div className="mb-5">
									<p className="text-[10px] font-black text-gray-400 mb-2 uppercase tracking-wider">{t.quickBudgetLabel || "Quick budget"}</p>
									<div className="flex flex-wrap gap-1.5">
										{[
											{ id: "u15", min: 5000,  max: 15000,  tKey: "budgetUpto15k",  fallback: "Under ৳15k" },
											{ id: "u25", min: 15000, max: 25000,  tKey: "budgetUpto25k",  fallback: "৳15k–৳25k" },
											{ id: "u40", min: 25000, max: 40000,  tKey: "budgetUpto40k",  fallback: "৳25k–৳40k" },
											{ id: "u60", min: 40000, max: 60000,  tKey: "budgetUpto60k",  fallback: "৳40k–৳60k" },
											{ id: "a60", min: 60000, max: 300000, tKey: "budgetAbove60k", fallback: "Above ৳60k" },
										].map((b) => {
											const active = minPrice === b.min && maxPrice === b.max;
											return (
												<button
													key={b.id}
													type="button"
													onClick={() => { setMinPrice(b.min); setMaxPrice(b.max); }}
													className={`px-2.5 py-1.5 rounded-full text-[11px] font-black border-2 transition-all ${
														active
															? "bg-gray-900 text-white border-gray-900"
															: "bg-white text-gray-700 border-gray-200 hover:border-gray-900"
													}`}
												>
													{t[b.tKey] || b.fallback}
												</button>
											);
										})}
									</div>
								</div>
								<div className="relative h-2 bg-gray-200 rounded-full mb-10 mt-6 mx-2">
									<div className="absolute h-full bg-brandRed rounded-full z-10" style={{ left: `${(minPrice / 300000) * 100}%`, right: `${((300000 - maxPrice) / 300000) * 100}%` }}></div>
									<input type="range" min="0" max="300000" step="1000" value={minPrice} onChange={(e) => setMinPrice(Math.min(Number(e.target.value), maxPrice - 1000))} className="absolute w-full -top-3 h-8 appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-[5px] [&::-webkit-slider-thumb]:border-brandRed [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg cursor-pointer" />
									<input type="range" min="0" max="300000" step="1000" value={maxPrice} onChange={(e) => setMaxPrice(Math.max(Number(e.target.value), minPrice + 1000))} className="absolute w-full -top-3 h-8 appearance-none bg-transparent pointer-events-none z-30 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-[5px] [&::-webkit-slider-thumb]:border-brandRed [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg cursor-pointer" />
								</div>
								<div className="flex gap-4">
									<div className="flex-1">
										<label className="text-[9px] font-black text-gray-400 uppercase">{t.minPrice || "Min Price"}</label>
										<input type="number" value={minPrice} onChange={(e) => setMinPrice(Number(e.target.value))} className="w-full bg-gray-50 border border-gray-100 rounded-lg p-2.5 text-xs font-bold outline-none focus:border-brandRed text-gray-700" />
									</div>
									<div className="flex-1">
										<label className="text-[9px] font-black text-gray-400 uppercase">{t.maxPrice || "Max Price"}</label>
										<input type="number" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} className="w-full bg-gray-50 border border-gray-100 rounded-lg p-2.5 text-xs font-bold outline-none focus:border-brandRed text-gray-700" />
									</div>
								</div>
							</div>
						</FilterSection>

						<FilterSection title={t.filterPropType || "Property Type"}>
							<div className="grid grid-cols-1 gap-2">
								{[
									{ id: "apartment",   label: t.propApartment   || "Apartment" },
									{ id: "independent", label: t.propIndependent || "Independent House" },
									{ id: "duplex",      label: t.propDuplex      || "Duplex" },
									{ id: "studio",      label: t.propStudio      || "Studio" },
									{ id: "penthouse",   label: t.propPenthouse   || "Penthouse" },
								].map((type) => (
									<label key={type.id} className={`flex items-center gap-3 cursor-pointer px-3 py-2 rounded-lg border-2 text-xs font-bold transition-all ${selectedTypes.includes(type.id) ? 'border-gray-900 bg-gray-50' : 'border-transparent hover:border-gray-300'}`}>
										<input type="checkbox" checked={selectedTypes.includes(type.id)} onChange={() => handleTypeToggle(type.id)} className="w-4 h-4 rounded accent-gray-900" /> {type.label}
									</label>
								))}
							</div>
						</FilterSection>

						<FilterSection title={t.filterWhoMovesIn || "Who's moving in?"}>
							{/* 2-column chip grid. Each chip toggles a category id —
							    multi-select supported so e.g. "Family + Sublet" works. */}
							<div className="grid grid-cols-2 gap-2">
								{RENTAL_CATEGORIES.map((cat) => {
									const Icon = cat.icon;
									const active = selectedCategories.includes(cat.id);
									const label = (cat.tKey && t[cat.tKey]) || cat.label;
									return (
										<button
											key={cat.id}
											type="button"
											onClick={() => toggleArrayState(setSelectedCategories, cat.id)}
											className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl border-2 text-[11px] font-black leading-tight text-center transition-all ${
												active
													? "bg-gray-900 text-white border-gray-900 shadow-[2px_2px_0_0_#ba0036]"
													: "bg-white text-gray-700 border-gray-200 hover:border-gray-900 hover:text-gray-900"
											}`}
										>
											<Icon size={18} className={active ? "text-white" : "text-brandRed"} />
											<span>{label}</span>
										</button>
									);
								})}
							</div>
						</FilterSection>

						<FilterSection title={t.filterRooms || "Bedrooms & Bathrooms"}>
							<p className="text-[10px] font-black text-gray-400 mb-2 uppercase">{t.bedrooms || "Bedrooms"}</p>
							<div className="flex gap-2 mb-5">
								{[
									{ id: "any", text: t.any || "Any" },
									{ id: "1", text: "1" },
									{ id: "2", text: "2" },
									{ id: "3", text: "3" },
									{ id: "4+", text: "4+" },
								].map((num) => (
									<button key={num.id} onClick={() => setSelectedBeds(num.id)} className={`flex-1 py-2 text-xs font-black rounded-lg border transition-all ${selectedBeds === num.id ? "bg-brandRed text-white border-brandRed" : "border-gray-100 text-gray-500 hover:border-brandRed"}`}>
										{num.text}
									</button>
								))}
							</div>
							<p className="text-[10px] font-black text-gray-400 mb-2 uppercase">{t.bathroomType || "Bathroom Type"}</p>
							<div className="grid grid-cols-2 gap-3">
								{[t.attachedBath || "Attached", t.sharedBath || "Shared"].map((b) => (
									<label key={b} className="flex items-center gap-2 text-xs font-bold text-gray-600">
										<input type="checkbox" checked={selectedBathType.includes(b)} onChange={() => toggleArrayState(setSelectedBathType, b)} className="accent-brandRed w-4 h-4" /> {b}
									</label>
								))}
							</div>
						</FilterSection>

						<FilterSection title={t.filterSize || "Size (Area Sqft)"}>
							<div className="px-2">
								<div className="flex items-center justify-between mb-4 text-xs font-bold text-gray-600">
									<span className="flex items-center gap-2">
										<Ruler size={14} className="text-brandRed" /> {t.maxSize || "Max Size:"}
									</span>
									<span className="text-brandRed">{maxSqft} sqft</span>
								</div>
								<input type="range" min="500" max="4000" step="100" value={maxSqft} onChange={(e) => setMaxSqft(Number(e.target.value))} className="w-full accent-brandRed cursor-pointer" />
							</div>
						</FilterSection>

						<FilterSection title={t.filterUtilities || "Utilities Included"}>
							<div className="grid grid-cols-2 gap-3">
								{[t.waterBill || "Water", t.electricityBill || "Electricity", t.gasSupply || "Gas", t.internetWifi || "WiFi", t.serviceCharge || "Service Charge"].map((u) => (
									<label key={u} className="flex items-center gap-2 text-[11px] font-bold text-gray-600">
										<input type="checkbox" checked={selectedUtilities.includes(u)} onChange={() => toggleArrayState(setSelectedUtilities, u)} className="accent-brandRed w-4 h-4 rounded" /> {u}
									</label>
								))}
							</div>
						</FilterSection>

						<FilterSection title={t.filterTenant || "Tenant & Furnishing"}>
							<p className="text-[10px] font-black text-gray-400 mb-2 uppercase">{t.tenantType || "Tenant Type"}</p>
							<div className="grid grid-cols-2 gap-3 mb-5">
								{[t.family || "Family", t.bachelor || "Bachelor", t.students || "Students", t.petsAllowed || "Pets Allowed"].map((tn) => (
									<label key={tn} className="flex items-center gap-2 text-[11px] font-bold text-gray-600">
										<input type="checkbox" checked={selectedTenants.includes(tn)} onChange={() => toggleArrayState(setSelectedTenants, tn)} className="accent-brandRed w-4 h-4 rounded" /> {tn}
									</label>
								))}
							</div>
							<p className="text-[10px] font-black text-gray-400 mb-2 uppercase">{t.furnishing || "Furnishing"}</p>
							<div className="grid grid-cols-1 gap-2">
								{[
									{ id: "", label: t.any || "Any" },
									{ id: "Furnished", label: t.furnished || "Furnished" },
									{ id: "Semi-Furnished", label: t.semiFurnished || "Semi-Furnished" },
									{ id: "Unfurnished", label: t.unfurnished || "Unfurnished" },
								].map((f) => (
									<label key={f.id} className="flex items-center gap-2 text-[11px] font-bold text-gray-600">
										<input type="radio" name="furnish" checked={selectedFurnish === f.id} onChange={() => setSelectedFurnish(f.id)} className="accent-brandRed w-4 h-4" /> {f.label}
									</label>
								))}
							</div>
						</FilterSection>

						<FilterSection title={t.filterAmenities || "Amenities & Floor"}>
							<p className="text-[10px] font-black text-gray-400 mb-2 uppercase">{t.amenities || "Amenities"}</p>
							<div className="grid grid-cols-2 gap-3 mb-5">
								{[t.parking || "Parking", t.elevator || "Elevator", t.securityCctv || "CCTV", t.generator || "Generator", t.ac || "AC"].map((a) => (
									<label key={a} className="flex items-center gap-2 text-[11px] font-bold text-gray-600">
										<input type="checkbox" checked={selectedAmenities.includes(a)} onChange={() => toggleArrayState(setSelectedAmenities, a)} className="accent-brandRed w-4 h-4 rounded" /> {a}
									</label>
								))}
							</div>
							<p className="text-[10px] font-black text-gray-400 mb-2 uppercase">{t.floorLevel || "Floor Level"}</p>
							<select value={selectedFloor} onChange={(e) => setSelectedFloor(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-lg p-2.5 text-xs font-bold outline-none focus:border-brandRed">
								<option>{t.anyFloor || "Any Floor"}</option>
								<option>{t.groundFloor || "Ground Floor"}</option>
								<option>{t.floor1to3 || "1st to 3rd Floor"}</option>
							</select>
						</FilterSection>

						<FilterSection title={t.filterRating || "Property Rating"}>
							<div className="flex flex-col gap-3">
								{[
									{ val: 4, label: t.star4Above || "4.0 & Above" },
									{ val: 3, label: t.star3Above || "3.0 & Above" },
									{ val: 0, label: t.anyRating || "Any Rating" },
								].map((r) => (
									<label key={r.val} className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
										<input type="radio" name="rating" checked={minRating === r.val} onChange={() => setMinRating(r.val)} className="accent-brandRed w-4 h-4" />
										<Star size={14} className={r.val > 0 ? "fill-yellow-400 text-yellow-400" : "text-gray-300"} /> {r.label}
									</label>
								))}
							</div>
						</FilterSection>

						<div className="pt-4 mt-6 lg:hidden">
							<button
								onClick={() => {
									setIsMobileFilterOpen(false);
									window.scrollTo({ top: 0, behavior: "smooth" });
								}}
								className="w-full bg-gray-900 text-white py-4 rounded-xl font-black text-sm shadow-xl active:scale-95 transition-transform">
								{t.applyFiltersBtn || "Apply Filters"}
							</button>
						</div>
					</div>
				</aside>

				{/* MAIN RIGHT CONTENT */}
				<main className="flex flex-col gap-6 lg:gap-8 min-h-screen">
					<div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-2">
						<div>
							<p className="text-xs font-bold text-gray-500 flex items-center gap-2 mb-2">
								<Link to="/" className="hover:text-brandRed transition-colors">
									{t.home || "Home"}
								</Link>{" "}
								<ChevronRight size={12} />
								<Link to="/properties/all" className="hover:text-brandRed transition-colors">
									{t.bangladesh || "Bangladesh"}
								</Link>{" "}
								<ChevronRight size={12} />
								<span className={searchArea ? "hover:text-brandRed cursor-pointer transition-colors" : "text-gray-900"} onClick={() => setSearchArea("")}>
									{formattedDivision}
								</span>
								{searchArea && searchArea !== (t.nearMe || "Nearby Location") && (
									<>
										<ChevronRight size={12} />
										<span className="text-brandRed">{searchArea.charAt(0).toUpperCase() + searchArea.slice(1)}</span>
									</>
								)}
							</p>
							<h1 className="text-3xl font-black text-gray-900 tracking-tight">
								{searchArea && searchArea !== (t.nearMe || "Nearby Location") ? searchArea.charAt(0).toUpperCase() + searchArea.slice(1) : formattedDivision} {t.properties || "Properties"}
							</h1>
						</div>
						<div className="flex items-center gap-3">
							<div className="hidden md:flex items-center bg-gray-100 rounded-xl p-1 gap-1">
								<button onClick={() => setViewMode("list")} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all ${!isMapMode ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
									<List size={14} /> List
								</button>
								<button onClick={() => setViewMode("map")} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all ${isMapMode ? "bg-brandRed text-white shadow-sm" : "text-gray-500 hover:text-brandRed"}`}>
									<Map size={14} /> Map View
								</button>
							</div>
							<div className="hidden md:flex items-center gap-2">
								<span className="text-sm font-bold text-gray-500">{t.sortBy || "Sort by:"}</span>
								<select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brandRed cursor-pointer shadow-sm hover:shadow-md transition-shadow">
									<option value="Newest Listings">{t.sortNewest || "Newest Listings"}</option>
									<option value="Price: Low to High">{t.sortPriceLowHigh || "Price: Low to High"}</option>
									<option value="Price: High to Low">{t.sortPriceHighLow || "Price: High to Low"}</option>
									<option value="Popular">{t.sortPopular || "Popular"}</option>
								</select>
							</div>
						</div>
					</div>

					<AnimatePresence mode="wait">
						{isMapMode ? null : (
							<motion.div key="list-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="w-full">
								{isPropertiesLoading ? (
									Array.from({ length: 6 }, (_, idx) => (
										<div key={`property-skeleton-${idx}`} className="mb-4 md:mb-6">
											<PropertyCardSkeleton />
										</div>
									))
								) : filteredProperties.length > 0 ? (
									filteredProperties.map((property) => {
										return (
											<React.Fragment key={property.id}>
												{/* Unified PropertyCard for both Desktop and Mobile */}
												<div className="mb-4 md:mb-6">
													<PropertyCard property={property} navigate={navigate} t={t} showToast={showToast} isHighlighted={highlightedId === property.id} onHover={setHighlightedId} onHoverEnd={() => setHighlightedId(null)} onInquire={openInquiry} />
												</div>
											</React.Fragment>
										);
									})
								) : (
									<div className="text-center py-20 bg-white rounded-[2rem] border border-gray-100 flex flex-col items-center justify-center shadow-sm">
										<div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
											<Search className="text-brandRed" size={24} />
										</div>
										<h3 className="text-xl font-black text-gray-900 mb-2">{propertyLoadError ? "Could not load properties" : (t.noPropsFound || "No Properties Found")}</h3>
										<p className="text-sm font-bold text-gray-500 mb-6">{propertyLoadError || t.noPropsDesc || "Try adjusting your filters or search criteria."}</p>
										<button onClick={propertyLoadError ? () => setPropertyRefreshTick((tick) => tick + 1) : handleClearAll} className="bg-gray-900 text-white px-8 py-3 rounded-xl text-sm font-bold active:scale-95 transition-transform shadow-md hover:shadow-lg">
											{propertyLoadError ? "Retry" : (t.clearFilters || "Clear Filters")}
										</button>
									</div>
								)}
							</motion.div>
						)}
					</AnimatePresence>
				</main>
			</div>

			{/* ── OYO-STYLE FULL-SCREEN MAP (shared by mobile + desktop) ─────────────
			    Renders as a fixed overlay above the page when `viewMode === 'map'`.
			    Same component & state on every breakpoint — no mobile/desktop fork. */}
			<AnimatePresence>
				{isMapMode && (
					<motion.div
						key="oyo-map"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.18 }}
						className="fixed inset-0 z-[60] bg-white flex flex-col"
						role="dialog"
						aria-label="Map view"
					>
						{/* Floating search bar — back + search + clear (matches OYO). */}
						<div className="absolute top-0 inset-x-0 z-30 px-3 pt-3 pb-2 pointer-events-none">
							<div className="max-w-[640px] mx-auto bg-white rounded-xl shadow-[0_8px_28px_rgba(0,0,0,0.18)] flex items-center gap-1 px-2 py-1.5 pointer-events-auto border border-gray-100">
								<button
									onClick={() => setViewMode("list")}
									aria-label="Back to list"
									className="p-2 rounded-lg hover:bg-gray-100 active:scale-95 transition-all">
									<ArrowLeft size={18} className="text-gray-800" />
								</button>
								<input
									type="text"
									value={searchArea}
									onChange={(e) => setSearchArea(e.target.value)}
									placeholder={searchArea ? "" : (t.searchAreaPlaceholder || "Search area...")}
									className="flex-1 outline-none bg-transparent text-sm font-bold text-gray-900 placeholder:text-gray-400"
								/>
								{searchArea && (
									<button
										onClick={() => setSearchArea("")}
										aria-label="Clear search"
										className="p-2 rounded-lg hover:bg-gray-100 active:scale-95 transition-all">
										<X size={16} className="text-gray-600" />
									</button>
								)}
							</div>
							{/* Property count pill */}
							<div className="max-w-[640px] mx-auto mt-2 pointer-events-auto flex">
								<span className="bg-white/95 backdrop-blur px-3 py-1.5 rounded-full text-[11px] font-black text-gray-900 shadow-md flex items-center gap-1.5 border border-gray-100">
									<MapPin size={11} className="text-brandRed" />
									{resultCountLabel} {t.properties || "Properties"}
								</span>
							</div>
						</div>

						{/* Map fills the whole screen */}
						<div className="absolute inset-0">
							<div className="w-full h-full">
								<MapView
									properties={filteredProperties}
									highlightedId={highlightedId}
									onMarkerHover={setHighlightedId}
									onMarkerHoverEnd={() => setHighlightedId(null)}
									onMarkerClick={(prop) => setSelectedMapProperty(prop)}
									searchArea={searchArea}
								/>
							</div>
						</div>

						{/* Bottom card — appears just above the dock when a marker is tapped. */}
						{selectedMapProperty && (
							<div className="absolute inset-x-0 bottom-[64px] z-30 px-3 pb-2 pointer-events-none">
								<div className="pointer-events-auto">
									<MapMiniCard
										property={selectedMapProperty}
										navigate={navigate}
										onClose={() => setSelectedMapProperty(null)}
										onInquire={openInquiry}
										t={t}
									/>
								</div>
							</div>
						)}

						{/* Bottom dock: Filter | Sort | List (matches OYO black bar). */}
						<div className="absolute inset-x-0 bottom-0 z-30 bg-gray-900 text-white shadow-[0_-8px_24px_rgba(0,0,0,0.25)]">
							<div className="max-w-[640px] mx-auto flex items-stretch divide-x divide-white/10">
								<button
									onClick={() => setIsMobileFilterOpen(true)}
									className="flex-1 py-4 flex items-center justify-center gap-2 text-sm font-black active:bg-white/10 transition-colors">
									<SlidersHorizontal size={16} /> {t.filtersBtn || "Filter"}
								</button>
								<div className="flex-1 relative">
									<select
										value={sortBy}
										onChange={(e) => setSortBy(e.target.value)}
										aria-label={t.sortBy || "Sort by"}
										className="absolute inset-0 opacity-0 cursor-pointer text-white"
									>
										<option value="Newest Listings">{t.sortNewest || "Newest Listings"}</option>
										<option value="Price: Low to High">{t.sortPriceLowHigh || "Price: Low to High"}</option>
										<option value="Price: High to Low">{t.sortPriceHighLow || "Price: High to Low"}</option>
										<option value="Popular">{t.sortPopular || "Popular"}</option>
									</select>
									<div className="py-4 flex items-center justify-center gap-2 text-sm font-black pointer-events-none">
										<ArrowUpDown size={16} /> {t.sortBy?.replace(":", "") || "Sort"}
									</div>
								</div>
								<button
									onClick={() => setViewMode("list")}
									className="flex-1 py-4 flex items-center justify-center gap-2 text-sm font-black active:bg-white/10 transition-colors">
									<List size={16} /> List
								</button>
							</div>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{/* ── INQUIRY MODAL (single instance, shown for whichever property was clicked) ── */}
			<InquiryModal isOpen={!!inquiryTarget} onClose={closeInquiry} property={inquiryTarget} landlord={inquiryLandlord} />
		</div>
	);
};

export default PropertyListing;
