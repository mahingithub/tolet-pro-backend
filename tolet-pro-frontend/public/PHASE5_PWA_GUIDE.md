# Phase Call-5 (PWA) — Part A সম্পূর্ণ + Part B নির্দেশনা

app-টাকে installable (Add to Home Screen) বানানো হলো। **শুধু frontend, কোনো
backend পরিবর্তন নেই।**

---

## ✅ Part A — তৈরি ফাইল (এই zip-এ আছে, সরাসরি বসান)

সব ফাইল `tolet-pro-frontend/`-এর ভেতরে, একই কাঠামোতে রাখুন:

| ফাইল | কাজ |
|---|---|
| `public/manifest.json` | Web App Manifest (নাম, icon, theme color, standalone) |
| `public/service-worker.js` | Static asset cache; **API/socket/Zego কখনো cache হয় না** |
| `public/offline.html` | offline হলে যে পেজ দেখায় |
| `public/icons/` | সব size: 72–512 + maskable 192/512 + logo.svg, maskable.svg |
| `public/apple-touch-icon.png` | iOS home-screen icon (180) |
| `public/favicon-16/32/48.png` | browser tab icon |
| `public/splash/` | iOS splash screen (৬টা device size) |
| `src/components/InstallPrompt.jsx` | custom "Install" banner |

logo বদলাতে চাইলে: `public/icons/logo.svg`-এ comment দেখুন — রং (`#ba0036`) আর
building shape ওখানে; বদলে PNG আবার generate করতে হবে, অথবা PNG-গুলো নিজের
ছবি দিয়ে replace করুন (একই নাম/size রাখলে কিছু ভাঙবে না)।

---

## ✅ Part B — DONE (index.html, main.jsx, App.jsx এই zip-এ বদলানো আছে)

এই তিনটে ফাইল এখন আপনার আসল কোডের সাথে মিলিয়ে বদলানো হয়েছে — সরাসরি বসান, হাতে
কিছু করতে হবে না:

- **`index.html`** — manifest link, theme-color, favicon, Apple touch icon,
  status-bar style, ৬টা iOS splash link, Open Graph/Twitter meta যোগ করা হয়েছে।
  viewport-এ `viewport-fit=cover`-ও যোগ (iOS notch-এর জন্য)।
- **`src/main.jsx`** — production-এ service worker register যোগ করা হয়েছে।
- **`src/App.jsx`** — `InstallPrompt` import + `AppLayout`-এর `MobileBottomNav`-এর
  পরে mount করা হয়েছে।

> বোনাস: আপনার route ইতিমধ্যে `/landlord/:id` ও `/tenant/:id` — তাই Phase 4-এর call
> detail modal-এর "View Profile" বাটন কোনো বদল ছাড়াই কাজ করবে।

নিচের পুরনো manual snippet-গুলো শুধু রেফারেন্সের জন্য রইল (আর দরকার নেই)।

---

## (রেফারেন্স) Part B manual snippets — আর দরকার নেই, উপরেরটা done

### 1️⃣ `index.html` — `<head>`-এ যোগ করুন

`<head>` ট্যাগের ভেতরে (যেখানে অন্য meta/title আছে তার কাছে) এগুলো বসান:

```html
<!-- PWA: manifest + theme -->
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#ba0036" />

<!-- Favicons -->
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />

<!-- iOS: installable + status bar + icon -->
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="TO-LET PRO" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />

<!-- iOS splash screens (per device) -->
<link rel="apple-touch-startup-image" href="/splash/splash-iphone-8-se.png"
      media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" />
<link rel="apple-touch-startup-image" href="/splash/splash-iphone-xr-11.png"
      media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" />
<link rel="apple-touch-startup-image" href="/splash/splash-iphone-x-xs-11pro.png"
      media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" />
<link rel="apple-touch-startup-image" href="/splash/splash-iphone-13-14.png"
      media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" />
<link rel="apple-touch-startup-image" href="/splash/splash-iphone-pro-max.png"
      media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" />
<link rel="apple-touch-startup-image" href="/splash/splash-ipad.png"
      media="(min-device-width: 768px) and (max-device-width: 1024px)" />

<!-- Open Graph / Twitter (লিংক শেয়ার করলে সুন্দর preview) -->
<meta property="og:title" content="TO-LET PRO" />
<meta property="og:description" content="Find and manage rental properties across Bangladesh." />
<meta property="og:type" content="website" />
<meta property="og:image" content="/icons/icon-512.png" />
<meta name="twitter:card" content="summary" />
```

> যদি `index.html`-এ আগে থেকে কোনো `<link rel="icon">` বা `theme-color` থাকে,
> সেটা মুছে এগুলো রাখুন (ডুপ্লিকেট এড়াতে)।

---

### 2️⃣ `src/main.jsx` — service worker register করুন

ফাইলের **একদম শেষে** (render করার পরে) এটা যোগ করুন:

```js
// ─── PWA: register the service worker (Phase Call-5) ───────────────────────
// Only in production builds — in dev it can interfere with hot-reload.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.warn('[pwa] service worker registration failed:', err);
    });
  });
}
```

---

### 3️⃣ `src/App.jsx` — InstallPrompt mount করুন

উপরে import যোগ করুন (অন্য import-এর সাথে):

```js
import InstallPrompt from './components/InstallPrompt';
```

তারপর App-এর return-এর ভেতরে, সবচেয়ে বাইরের wrapper-এর শেষে (router/routes-এর
পরে, বন্ধ ট্যাগের ঠিক আগে) এটা বসান:

```jsx
<InstallPrompt />
```

উদাহরণ:
```jsx
return (
  <>
    {/* ...আপনার router / routes... */}
    <InstallPrompt />
  </>
);
```

---

## 🧪 টেস্ট

1. Vercel-এ deploy → live সাইটে যান।
2. **hard refresh** (`Cmd+Shift+R`) — পুরনো bundle এড়াতে।
3. **Chrome DevTools → Application ট্যাব**:
   - **Manifest** → নাম, icon দেখা যাচ্ছে কিনা, কোনো error আছে কিনা।
   - **Service Workers** → "activated and running" দেখাচ্ছে কিনা।
4. **Android Chrome:** কয়েকবার ভিজিট করলে (৩+) নিচে "Install TO-LET PRO" banner
   আসবে → Install → home screen-এ icon → tap করলে full-screen (browser bar ছাড়া)।
5. **iOS Safari:** Share → "Add to Home Screen" → icon + splash দেখা যাবে।
6. **Offline টেস্ট:** DevTools → Network → "Offline" → reload → offline.html দেখাবে
   (cached static asset-ও লোড হবে)। **কিন্তু কল/chat কাজ করবে না — এটা ঠিক**,
   কারণ ওগুলো ইচ্ছে করে network-only রাখা।

---

## ⚠️ গুরুত্বপূর্ণ — service worker আর real-time

service worker **ইচ্ছে করে** API, socket.io, ZegoCloud কখনো cache করে না — শুধু
static asset (JS/CSS/icon)। তাই কল, chat, live data সবসময় network থেকে fresh
আসবে, PWA install করার পরেও। এটা না করলে কল ভাঙত বা পুরনো message দেখাত।

নতুন release-এর পর সব user-কে fresh asset দিতে চাইলে: `service-worker.js`-এ
`CACHE_VERSION = 'tolet-pro-v1'` → `'tolet-pro-v2'` করুন।

---

## 🚀 Push

Part A বসিয়ে + Part B-এর ৩টে edit করে:

```bash
cd tolet-pro-frontend
git add -A
git status              # .env.local যেন list-এ না থাকে
git commit -m "feat: PWA — manifest, service worker, icons, install prompt (Phase 5)"
git push origin main
```

Vercel auto-deploy হবে।
