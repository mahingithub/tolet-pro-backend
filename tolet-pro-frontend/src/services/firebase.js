// src/services/firebase.js
//
// Firebase Web SDK is initialized from VITE_* env vars (see .env.example).
// The web apiKey is *not* a secret — Google publishes it as the public
// identifier for client SDK calls. The real authentication boundary is the
// Firebase ID token, which is verified by the backend with firebase-admin.
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  // Don't crash the bundle — but make the misconfig loud in the console.
  console.error(
    `[firebase] Missing env vars: ${missing.join(', ')}. ` +
      'Add them to your .env.local — see .env.example for the full list.'
  );
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
