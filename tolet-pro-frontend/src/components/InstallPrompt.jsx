// InstallPrompt.jsx
//
// Custom "Install TO-LET PRO" banner. (Phase Call-5 / PWA)
//
// Behaviour:
//   • Android/Chrome/Edge: listens for the `beforeinstallprompt` event, hides
//     the native mini-bar, and shows our own banner. Tapping Install triggers
//     the real OS install dialog.
//   • iOS Safari: there is NO beforeinstallprompt — install is manual via the
//     Share menu. So on iOS we show a short "tap Share → Add to Home Screen"
//     hint instead.
//   • Only appears after the user has visited 3+ times (counted in
//     localStorage), and never again once installed or dismissed.
//
// ► TO CHANGE LATER:
//   - VISIT_THRESHOLD: how many visits before the banner shows.
//   - Copy/strings: all inline below.
//   - To force-show during testing, set localStorage 'pwa:visits' to a big
//     number and clear 'pwa:dismissed' in DevTools.

import React, { useState, useEffect } from 'react';

const VISIT_THRESHOLD = 3;          // show after this many visits
const DISMISS_KEY = 'pwa:dismissed'; // remembers the user said "not now"
const VISITS_KEY = 'pwa:visits';

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Already running as an installed PWA? Then never show the banner.
function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;                       // already installed
    if (localStorage.getItem(DISMISS_KEY) === '1') return; // user dismissed before

    // Count this visit.
    const visits = Number(localStorage.getItem(VISITS_KEY) || '0') + 1;
    localStorage.setItem(VISITS_KEY, String(visits));
    const enoughVisits = visits >= VISIT_THRESHOLD;

    // Android/desktop: capture the install event so we can trigger it later.
    const onBeforeInstall = (e) => {
      e.preventDefault();          // stop the default mini-infobar
      setDeferredPrompt(e);
      if (enoughVisits) setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS has no install event — show the manual hint once enough visits.
    if (isIos() && enoughVisits) {
      setIosHint(true);
      setVisible(true);
    }

    // If the app gets installed, hide + remember so we don't nag.
    const onInstalled = () => {
      setVisible(false);
      localStorage.setItem(DISMISS_KEY, '1');
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();                 // show the real OS dialog
    try { await deferredPrompt.userChoice; } catch {/* ignore */}
    setDeferredPrompt(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '20px',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        width: 'calc(100% - 32px)',
        maxWidth: '420px',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '20px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          border: '1px solid #f0f0f0',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
        }}
      >
        {/* App icon */}
        <div
          style={{
            width: '52px', height: '52px', borderRadius: '14px',
            background: '#ba0036', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="30" height="30" viewBox="0 0 512 512" fill="#fff" xmlns="http://www.w3.org/2000/svg">
            <rect x="176" y="150" width="160" height="226" rx="10"/>
            <rect x="232" y="120" width="48" height="36" rx="8"/>
            <rect x="236" y="320" width="40" height="56" rx="6" fill="#ba0036"/>
            <g fill="#ba0036">
              <rect x="200" y="182" width="34" height="30" rx="5"/><rect x="278" y="182" width="34" height="30" rx="5"/>
              <rect x="200" y="232" width="34" height="30" rx="5"/><rect x="278" y="232" width="34" height="30" rx="5"/>
              <rect x="200" y="282" width="34" height="30" rx="5"/><rect x="278" y="282" width="34" height="30" rx="5"/>
            </g>
          </svg>
        </div>

        {/* Text + actions */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '14px', color: '#1f2937' }}>
            Install TO-LET PRO
          </div>
          {iosHint ? (
            <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, marginTop: '2px', lineHeight: 1.4 }}>
              Tap the Share button, then “Add to Home Screen”.
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, marginTop: '2px' }}>
              Add to your home screen for quick access.
            </div>
          )}

          {!iosHint && (
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
              <button
                onClick={install}
                style={{
                  background: '#ba0036', color: '#fff', border: 'none',
                  borderRadius: '10px', padding: '8px 18px',
                  fontSize: '12px', fontWeight: 800, cursor: 'pointer',
                }}
              >
                Install
              </button>
              <button
                onClick={dismiss}
                style={{
                  background: 'transparent', color: '#6b7280', border: 'none',
                  borderRadius: '10px', padding: '8px 12px',
                  fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                Not now
              </button>
            </div>
          )}
        </div>

        {/* Close X (mainly for the iOS hint, which has no buttons) */}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          style={{
            background: '#f3f4f6', border: 'none', borderRadius: '50%',
            width: '28px', height: '28px', cursor: 'pointer', flexShrink: 0,
            color: '#6b7280', fontSize: '16px', lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
