/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Your existing brand colors (Kept for backward compatibility)
        brandRed: '#ba0036',
        darkBg: '#0f172a',
        
        // 🎨 NEW: Bangladesh-Inspired Premium Palette
        emerald: {
          50: '#ECF7F2',   // Light bg / Success state
          100: '#CDE8DB',  // Muted borders
          500: '#1B8553',  // Primary Green (Rich Forest)
          600: '#136B41',  // Hover state
          800: '#0A4529',  // Active state
          900: '#062E1A',  // Deep dark green
        },
        crimson: {
          50: '#FDF2F5',   // Light bg / Error state
          100: '#FBE5EB',  // Muted borders
          500: '#ba0036',  // Secondary Red (Synced with brandRed)
          600: '#90002A',  // Hover state
          800: '#60001C',  // Active state
          900: '#400013',  // Deep dark red
        },
        gold: {
          500: '#D99B28',  // Accent / Highlights / Ratings
        },
        slate: {
          50: '#F8F9FA',   // App Main Background
          200: '#E5E7EB',  // Dividers / Borders
          600: '#4B5563',  // Subtext / Paragraphs
          800: '#1F2937',  // Primary Body Text
          900: '#111827',  // Headings (H1, H2, etc.)
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}