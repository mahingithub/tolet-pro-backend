import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import './index.css'

// ─── Sentry: frontend error tracking (Phase 7) ─────────────────────────────
// DSN comes from VITE_SENTRY_DSN (set it on Vercel). If unset, Sentry stays
// disabled — the app runs normally. Only enabled in production builds so dev
// noise doesn't fill your Sentry quota.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn && import.meta.env.PROD) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    // Capture 10% of transactions for performance — plenty for beta, stays in
    // the free tier. Raise toward 1.0 for more detail.
    tracesSampleRate: 0.1,
    // Session Replay is OFF by default (it can be heavy + privacy-sensitive).
    // Enable later if you want to watch what led to an error.
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// ─── PWA: register the service worker (Phase Call-5) ───────────────────────
// Production only — in dev it interferes with Vite hot-reload.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.warn('[pwa] service worker registration failed:', err);
    });
  });
}