// FeedbackButton.jsx — floating "Send feedback" button. [Phase 7 / beta]
// ───────────────────────────────────────────────────────────────────────────
// A small floating button (bottom-left, so it doesn't clash with the AI
// assistant / install prompt that sit bottom-right/center) that opens your
// feedback form in a new tab. Handy during beta to collect bug reports + ideas.
//
// ► SET YOUR FORM LINK: replace FEEDBACK_URL below with your Google Form (or any
//   feedback form) URL. Until you do, the button stays HIDDEN automatically so
//   it never sends users to a dead link.
//
//   Example: const FEEDBACK_URL = 'https://forms.gle/your-form-id';

import React from 'react';

// ⚠️ Put your real feedback form URL here. Leave as '' to hide the button.
const FEEDBACK_URL = '';

export default function FeedbackButton() {
  // No link set yet → render nothing (avoids a button that goes nowhere).
  if (!FEEDBACK_URL) return null;

  return (
    <a
      href={FEEDBACK_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Send feedback"
      style={{
        position: 'fixed',
        left: '16px',
        bottom: '16px',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: '#ba0036',
        color: '#fff',
        borderRadius: '999px',
        padding: '10px 16px',
        fontSize: '13px',
        fontWeight: 800,
        textDecoration: 'none',
        boxShadow: '0 8px 24px rgba(186,0,54,0.35)',
      }}
    >
      {/* speech-bubble icon (inline SVG — no icon lib dependency) */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      Feedback
    </a>
  );
}
