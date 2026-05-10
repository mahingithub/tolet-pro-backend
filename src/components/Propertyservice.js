/**
 * ─── PROPERTY SERVICE ─────────────────────────────────────────────────────────
 *
 * Single source of truth for all property data access.
 *
 * HOW TO CONNECT TO YOUR BACK-END (when you're ready):
 *   1. Replace `_fetchFromDemo()` with `_fetchFromAPI()` below.
 *   2. Set VITE_API_BASE_URL in your .env file.
 *   3. The rest of the app (PropertyListing, etc.) will keep working without
 *      any further changes because it only calls the public methods here.
 *
 *  ⚠️  Never put API keys or secrets here — always use environment variables
 *      (import.meta.env.VITE_*) and keep them server-side when possible.
 */

// ─── DEMO DATA (replace with real API call when backend is ready) ─────────────
export const DEMO_PROPERTIES = [
    {
      id: 1, landlordId: 1, date: "2026-04-20", division: "dhaka",
      type: "apartment", rentalCategory: "family",
      title: "Luxurious 4BHK Family Flat in Gulshan",
      location: "Road 12, Gulshan 2, Dhaka",
      beds: 4, baths: 4, sqft: 2500, furnishing: "Furnished",
      price: 120000, originalPrice: 135000, rating: 4.8, reviews: 124,
      verified: true, lat: 23.7925, lng: 90.4078, popularity: 95, inquiries: 7,
      images: ["https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=800","https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=800","https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?q=80&w=800","https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=800"],
    },
    {
      id: 2, landlordId: 1, date: "2026-04-21", division: "dhaka",
      type: "apartment", rentalCategory: "family",
      title: "Premium 3BHK Family Apartment in Banani",
      location: "Block C, Banani, Dhaka",
      beds: 3, baths: 3, sqft: 1800, furnishing: "Semi-Furnished",
      price: 85000, originalPrice: 95000, rating: 4.5, reviews: 89,
      verified: true, lat: 23.7937, lng: 90.4066, popularity: 88, inquiries: 12,
      images: ["https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?q=80&w=800","https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=800","https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=800"],
    },
    {
      id: 3, landlordId: 2, date: "2026-04-18", division: "chittagong",
      type: "apartment", rentalCategory: "family",
      title: "Sea View Apartment in Agrabad",
      location: "Agrabad C/A, Chattogram",
      beds: 3, baths: 2, sqft: 1500, furnishing: "Unfurnished",
      price: 45000, originalPrice: 50000, rating: 4.7, reviews: 210,
      verified: true, lat: 22.3303, lng: 91.8184, popularity: 90, inquiries: 3,
      images: ["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=800","https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?q=80&w=800"],
    },
    {
      id: 4, landlordId: 2, date: "2026-04-22", division: "dhaka",
      type: "studio", rentalCategory: "bachelor_male",
      title: "Modern Studio for Male Bachelors – Mirpur",
      location: "Section 10, Mirpur, Dhaka",
      beds: 1, baths: 1, sqft: 420, furnishing: "Furnished",
      price: 12000, originalPrice: 14000, rating: 4.2, reviews: 45,
      verified: true, lat: 23.8103, lng: 90.3617, popularity: 72, inquiries: 18,
      images: ["https://images.unsplash.com/photo-1558618666-fcd25c85cd64?q=80&w=800","https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=800"],
    },
    {
      id: 5, landlordId: 3, date: "2026-04-23", division: "dhaka",
      type: "apartment", rentalCategory: "bachelor_female",
      title: "Safe 2BHK for Female Bachelors – Dhanmondi",
      location: "Road 27, Dhanmondi, Dhaka",
      beds: 2, baths: 2, sqft: 900, furnishing: "Semi-Furnished",
      price: 28000, originalPrice: 32000, rating: 4.6, reviews: 67,
      verified: true, lat: 23.7461, lng: 90.3742, popularity: 82, inquiries: 9,
      images: ["https://images.unsplash.com/photo-1484154218962-a197022b5858?q=80&w=800","https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?q=80&w=800"],
    },
    {
      id: 6, landlordId: 3, date: "2026-04-19", division: "dhaka",
      type: "apartment", rentalCategory: "sublet",
      title: "Sublet Room – Bashundhara R/A",
      location: "Block D, Bashundhara, Dhaka",
      beds: 1, baths: 1, sqft: 320, furnishing: "Furnished",
      price: 8500, originalPrice: 9500, rating: 4.0, reviews: 33,
      verified: false, lat: 23.8135, lng: 90.4245, popularity: 65, inquiries: 22,
      images: ["https://images.unsplash.com/photo-1555041469-a586c61ea9bc?q=80&w=800"],
    },
    {
      id: 7, landlordId: 1, date: "2026-04-17", division: "dhaka",
      type: "apartment", rentalCategory: "student",
      title: "Student Mess Near Dhaka University",
      location: "Nilkhet, Dhaka",
      beds: 1, baths: 1, sqft: 280, furnishing: "Furnished",
      price: 6000, originalPrice: 7000, rating: 4.1, reviews: 88,
      verified: true, lat: 23.7288, lng: 90.4023, popularity: 78, inquiries: 30,
      images: ["https://images.unsplash.com/photo-1493809842364-78817add7ffb?q=80&w=800"],
    },
    {
      id: 8, landlordId: 1, date: "2026-04-25", division: "dhaka",
      type: "penthouse", rentalCategory: "family",
      title: "Sky Penthouse – Uttara Sector 13",
      location: "Sector 13, Uttara, Dhaka",
      beds: 5, baths: 5, sqft: 4000, furnishing: "Furnished",
      price: 250000, originalPrice: 280000, rating: 4.9, reviews: 41,
      verified: true, lat: 23.8759, lng: 90.3795, popularity: 98, inquiries: 5,
      images: ["https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?q=80&w=800","https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?q=80&w=800"],
    },
    {
      id: 9, landlordId: 2, date: "2026-04-16", division: "dhaka",
      type: "duplex", rentalCategory: "family",
      title: "Spacious Duplex Villa – Baridhara",
      location: "Baridhara DOHS, Dhaka",
      beds: 5, baths: 4, sqft: 3600, furnishing: "Semi-Furnished",
      price: 180000, originalPrice: 200000, rating: 4.7, reviews: 55,
      verified: true, lat: 23.8006, lng: 90.4283, popularity: 91, inquiries: 4,
      images: ["https://images.unsplash.com/photo-1600585154526-990dced4db0d?q=80&w=800"],
    },
    {
      id: 10, landlordId: 3, date: "2026-04-24", division: "dhaka",
      type: "apartment", rentalCategory: "bachelor_male",
      title: "Bachelor Flat – Mohammadpur",
      location: "Mohammadpur Housing, Dhaka",
      beds: 2, baths: 1, sqft: 750, furnishing: "Unfurnished",
      price: 16000, originalPrice: 18000, rating: 4.0, reviews: 28,
      verified: false, lat: 23.7646, lng: 90.3585, popularity: 60, inquiries: 14,
      images: ["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=800"],
    },
    {
      id: 11, landlordId: 1, date: "2026-04-15", division: "dhaka",
      type: "apartment", rentalCategory: "family",
      title: "Cozy 3BHK – Azimpur Colony",
      location: "Azimpur, Lalbagh, Dhaka",
      beds: 3, baths: 2, sqft: 1200, furnishing: "Unfurnished",
      price: 22000, originalPrice: 25000, rating: 4.3, reviews: 76,
      verified: true, lat: 23.7233, lng: 90.3897, popularity: 74, inquiries: 8,
      images: ["https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?q=80&w=800"],
    },
    {
      id: 12, landlordId: 3, date: "2026-04-26", division: "dhaka",
      type: "studio", rentalCategory: "sublet",
      title: "Sublet Studio – Farmgate",
      location: "Farmgate, Tejgaon, Dhaka",
      beds: 1, baths: 1, sqft: 380, furnishing: "Furnished",
      price: 10000, originalPrice: 11500, rating: 3.9, reviews: 22,
      verified: false, lat: 23.7588, lng: 90.3896, popularity: 55, inquiries: 20,
      images: ["https://images.unsplash.com/photo-1493809842364-78817add7ffb?q=80&w=800"],
    },
    {
      id: 13, landlordId: 2, date: "2026-04-14", division: "chittagong",
      type: "apartment", rentalCategory: "family",
      title: "Hill-view 3BHK – Nasirabad",
      location: "Nasirabad H/S, Chattogram",
      beds: 3, baths: 3, sqft: 1600, furnishing: "Semi-Furnished",
      price: 38000, originalPrice: 43000, rating: 4.5, reviews: 90,
      verified: true, lat: 22.3659, lng: 91.8246, popularity: 83, inquiries: 6,
      images: ["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=800"],
    },
    {
      id: 14, landlordId: 1, date: "2026-04-27", division: "sylhet",
      type: "independent", rentalCategory: "family",
      title: "Independent House – Sylhet Sadar",
      location: "Zindabazar, Sylhet",
      beds: 4, baths: 3, sqft: 2200, furnishing: "Unfurnished",
      price: 30000, originalPrice: 35000, rating: 4.4, reviews: 60,
      verified: true, lat: 24.8949, lng: 91.8687, popularity: 77, inquiries: 9,
      images: ["https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=800"],
    },
    {
      id: 15, landlordId: 2, date: "2026-04-13", division: "rajshahi",
      type: "apartment", rentalCategory: "student",
      title: "Student Room Near RU Campus",
      location: "Binodpur, Rajshahi",
      beds: 1, baths: 1, sqft: 250, furnishing: "Furnished",
      price: 5500, originalPrice: 6500, rating: 4.0, reviews: 105,
      verified: false, lat: 24.3745, lng: 88.6042, popularity: 70, inquiries: 35,
      images: ["https://images.unsplash.com/photo-1558618666-fcd25c85cd64?q=80&w=800"],
    },
    {
      id: 16, landlordId: 3, date: "2026-04-28", division: "dhaka",
      type: "apartment", rentalCategory: "bachelor_female",
      title: "Ladies-only Flat – Rayer Bazar",
      location: "Rayer Bazar, Dhanmondi, Dhaka",
      beds: 2, baths: 1, sqft: 700, furnishing: "Semi-Furnished",
      price: 19000, originalPrice: 21000, rating: 4.4, reviews: 48,
      verified: true, lat: 23.753, lng: 90.362, popularity: 80, inquiries: 11,
      images: ["https://images.unsplash.com/photo-1484154218962-a197022b5858?q=80&w=800"],
    },
    {
      id: 17, landlordId: 1, date: "2026-04-12", division: "dhaka",
      type: "apartment", rentalCategory: "family",
      title: "Elegant 3BHK – Niketan, Gulshan",
      location: "Niketan, Gulshan 1, Dhaka",
      beds: 3, baths: 3, sqft: 1900, furnishing: "Furnished",
      price: 95000, originalPrice: 108000, rating: 4.6, reviews: 73,
      verified: true, lat: 23.782, lng: 90.402, popularity: 87, inquiries: 6,
      images: ["https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?q=80&w=800"],
    },
    {
      id: 18, landlordId: 2, date: "2026-04-29", division: "dhaka",
      type: "apartment", rentalCategory: "bachelor_male",
      title: "Male Bachelor Flat – Shyamoli",
      location: "Shyamoli, Mohammadpur, Dhaka",
      beds: 2, baths: 1, sqft: 800, furnishing: "Unfurnished",
      price: 14500, originalPrice: 16000, rating: 3.8, reviews: 19,
      verified: false, lat: 23.7743, lng: 90.362, popularity: 58, inquiries: 16,
      images: ["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=800"],
    },
    {
      id: 19, landlordId: 3, date: "2026-04-11", division: "khulna",
      type: "independent", rentalCategory: "family",
      title: "Corner Family House – Sonadanga",
      location: "Sonadanga, Khulna",
      beds: 4, baths: 3, sqft: 2000, furnishing: "Unfurnished",
      price: 25000, originalPrice: 28000, rating: 4.3, reviews: 38,
      verified: true, lat: 22.8456, lng: 89.5403, popularity: 68, inquiries: 5,
      images: ["https://images.unsplash.com/photo-1600585154526-990dced4db0d?q=80&w=800"],
    },
    {
      id: 20, landlordId: 3, date: "2026-04-30", division: "dhaka",
      type: "apartment", rentalCategory: "sublet",
      title: "Sublet Room – Wari, Old Dhaka",
      location: "Wari, Dhaka South",
      beds: 1, baths: 1, sqft: 300, furnishing: "Semi-Furnished",
      price: 7500, originalPrice: 8500, rating: 3.7, reviews: 15,
      verified: false, lat: 23.7185, lng: 90.4125, popularity: 48, inquiries: 25,
      images: ["https://images.unsplash.com/photo-1555041469-a586c61ea9bc?q=80&w=800"],
    },
    {
      id: 21, landlordId: 1, date: "2026-05-01", division: "dhaka",
      type: "apartment", rentalCategory: "family",
      title: "Brand New 4BHK – Aftabnagar",
      location: "Aftabnagar, Rampura, Dhaka",
      beds: 4, baths: 3, sqft: 2100, furnishing: "Semi-Furnished",
      price: 65000, originalPrice: 72000, rating: 4.5, reviews: 32,
      verified: true, lat: 23.7633, lng: 90.4342, popularity: 84, inquiries: 10,
      images: ["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=800"],
    },
    {
      id: 22, landlordId: 2, date: "2026-05-02", division: "dhaka",
      type: "studio", rentalCategory: "student",
      title: "Compact Student Studio – Jigatola",
      location: "Jigatola, Dhanmondi, Dhaka",
      beds: 1, baths: 1, sqft: 350, furnishing: "Furnished",
      price: 9000, originalPrice: 10000, rating: 4.2, reviews: 55,
      verified: true, lat: 23.7398, lng: 90.3801, popularity: 69, inquiries: 19,
      images: ["https://images.unsplash.com/photo-1493809842364-78817add7ffb?q=80&w=800"],
    },
  ];
  
  export const DEMO_LANDLORDS = {
    1: { id: 1, name: "Rahman Syndicate", responseTime: "< 1 hour",  avatar: "https://ui-avatars.com/api/?name=Rahman+Syndicate&background=fce4ec&color=ba0036&size=256" },
    2: { id: 2, name: "Karim Properties",  responseTime: "< 2 hours", avatar: "https://ui-avatars.com/api/?name=Karim+Properties&background=e8f5e9&color=2e7d32&size=256" },
    3: { id: 3, name: "Hossain Real Estate",responseTime: "< 4 hours", avatar: "https://ui-avatars.com/api/?name=Hossain+RE&background=fff3e0&color=e65100&size=256" },
  };
  
  // ─── RENTAL CATEGORIES ─────────────────────────────────────────────────────────
  // Keep these IDs in sync with the `rentalCategory` field in property objects above.
  // ⚠️  These IDs are also used in HeroSection and Navbar — do not rename without
  //     updating all three components.
  export const RENTAL_CATEGORIES = [
    { id: "family",         label: "Family Flat",       shortLabel: "Family" },
    { id: "bachelor_male",  label: "Bachelor (Male)",   shortLabel: "Bach. (M)" },
    { id: "bachelor_female",label: "Bachelor (Female)", shortLabel: "Bach. (F)" },
    { id: "sublet",         label: "Sublet / Room",     shortLabel: "Sublet" },
    { id: "student",        label: "Student",           shortLabel: "Student" },
  ];
  
  export const PROPERTY_TYPES = [
    { id: "apartment",   label: "Apartment" },
    { id: "independent", label: "Independent House" },
    { id: "duplex",      label: "Duplex" },
    { id: "studio",      label: "Studio" },
    { id: "penthouse",   label: "Penthouse" },
  ];
  
  export const VALID_DIVISIONS = ["dhaka","chittagong","sylhet","rajshahi","khulna","barishal","rangpur","mymensingh"];
  
  // ─── PURE FILTER HELPER (used by PropertyListing) ─────────────────────────────
  export function applyFilters(properties, filters) {
    const {
      activeDivision = "all",
      searchArea = "",
      nearMeLabel = "Nearby Location",
      minPrice = 5000,
      maxPrice = 300000,
      selectedTypes = [],       // prop.type
      selectedCategories = [],  // prop.rentalCategory  ← this is the key fix
      selectedBeds = "any",
      maxSqft = 4000,
      selectedFurnish = "",
      minRating = 0,
    } = filters;
  
    return properties.filter(prop => {
      if (activeDivision !== "all" && prop.division !== activeDivision) return false;
      if (searchArea && searchArea !== nearMeLabel &&
          !prop.location.toLowerCase().includes(searchArea.toLowerCase())) return false;
      if (prop.price < minPrice || prop.price > maxPrice) return false;
      if (selectedTypes.length > 0 && !selectedTypes.includes(prop.type)) return false;
      // ── FIX: filter by rentalCategory, not prop.type ──────────────────────────
      if (selectedCategories.length > 0 && !selectedCategories.includes(prop.rentalCategory)) return false;
      if (selectedBeds !== "any") {
        if (selectedBeds === "4+" && prop.beds < 4) return false;
        if (selectedBeds !== "4+" && prop.beds !== Number(selectedBeds)) return false;
      }
      if (prop.sqft > maxSqft) return false;
      if (selectedFurnish && prop.furnishing !== selectedFurnish) return false;
      if (minRating > 0 && prop.rating < minRating) return false;
      return true;
    });
  }
  
  // ─── PUBLIC SERVICE API ───────────────────────────────────────────────────────
  //
  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  BACK-END MIGRATION GUIDE                                               ║
  // ║                                                                         ║
  // ║  When your API is ready, swap the demo implementations below for real   ║
  // ║  fetch() / axios calls. Keep the function signatures identical.         ║
  // ║                                                                         ║
  // ║  Example (getProperties):                                               ║
  // ║    const API = import.meta.env.VITE_API_BASE_URL;                       ║
  // ║    const res = await fetch(`${API}/properties?${new URLSearchParams(f)}`);
  // ║    if (!res.ok) throw new Error('API error');                           ║
  // ║    return res.json();                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  
  export const propertyService = {
    /**
     * Returns a filtered + sorted list of properties.
     * @param {object} filters – same shape as applyFilters() above
     * @param {string} sortBy  – "Newest Listings" | "Price: Low to High" | "Price: High to Low" | "Popular"
     */
    async getProperties(filters = {}, sortBy = "Newest Listings") {
      // TODO: replace with `const res = await fetch(...)` when backend is ready
      let results = applyFilters(DEMO_PROPERTIES, filters);
  
      results = [...results].sort((a, b) => {
        if (sortBy === "Price: Low to High")  return a.price - b.price;
        if (sortBy === "Price: High to Low")  return b.price - a.price;
        if (sortBy === "Popular")             return b.popularity - a.popularity;
        return new Date(b.date) - new Date(a.date); // default: Newest
      });
  
      return results;
    },
  
    /**
     * Returns a single property by id, or null.
     */
    async getPropertyById(id) {
      return DEMO_PROPERTIES.find(p => p.id === Number(id)) ?? null;
    },
  
    /**
     * Returns landlord info for a given landlord id, or null.
     */
    async getLandlord(landlordId) {
      return DEMO_LANDLORDS[landlordId] ?? null;
    },
  };