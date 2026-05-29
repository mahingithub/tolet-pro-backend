import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  getCurrentUser,
  getCurrentToken,
  fetchMe,
  login as svcLogin,
  loginAsDemoAdmin as svcLoginAsDemoAdmin,
  logout as svcLogout,
  updateMe as svcUpdateMe,
  addRole as svcAddRole,
  setActiveRole as svcSetActiveRole,
  submitVerification as svcSubmitVerification,
  isAdminRole,
} from '../services/authService.js';
import { subscribe } from '../services/_storage.js';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => getCurrentUser());

  // On boot, if a token exists, validate it server-side via /me. If the token
  // is invalid or the user was deleted, this returns null and we clear the
  // local session so stale data can't impersonate a real account.
  //
  // RACE GUARD: we capture the token at the start of the effect. If a user
  // manually logs in while /me is still pending, the localStorage token gets
  // swapped to a fresh one. We must NOT then logout based on the old failing
  // call — that was killing fresh logins immediately and forcing the user back
  // to the login screen.
  useEffect(() => {
    const initialToken = getCurrentToken();
    if (!initialToken) return;
    let cancelled = false;
    fetchMe()
      .then((u) => { if (!cancelled) setUser(u); })
      .catch(() => {
        if (cancelled) return;
        // If the token in localStorage changed (or was cleared) while /me
        // was pending, treat the failure as belonging to the previous
        // session. The new session is the source of truth — leave it alone.
        if (getCurrentToken() !== initialToken) return;
        // Token genuinely bad — drop the session quietly via the service so
        // the localStorage key namespace stays consistent.
        svcLogout().finally(() => setUser(null));
      });
    return () => { cancelled = true; };
  }, []);

  // Keep state in sync with localStorage broadcasts from authService.
  useEffect(() => {
    const refresh = () => setUser(getCurrentUser());
    return subscribe('auth:user', refresh);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const u = await fetchMe();
      setUser(u);
      return u;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  // ─── Multi-role helpers ────────────────────────────────────────────────
  // `roles` is the canonical superset granted to this user; `activeRole`
  // is whichever one the UI currently treats as primary (mirrors
  // `user.role` on the backend). The Navbar mode pill flips this.
  const roles      = Array.isArray(user?.roles) && user.roles.length
    ? user.roles
    : (user?.role ? [user.role] : []);
  const activeRole = user?.role || roles[0] || null;

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isAdmin: !!user && isAdminRole(user.role),
      // ── New: multi-role surface ──────────────────────────────────────
      roles,
      activeRole,
      hasRole: (r) => roles.includes(r),
      // ──────────────────────────────────────────────────────────────────
      login: async (input) => {
        const u = await svcLogin(input);
        setUser(u);
        return u;
      },
      loginAsDemoAdmin: async () => {
        const u = await svcLoginAsDemoAdmin();
        setUser(u);
        return u;
      },
      logout: async () => {
        await svcLogout();
        setUser(null);
      },
      updateMe: async (patch) => {
        const u = await svcUpdateMe(patch);
        setUser(u);
        return u;
      },
      // Grant the current user a new role (e.g. tenant → also landlord).
      // Idempotent server-side.
      addRole: async (role) => {
        const u = await svcAddRole(role);
        setUser(u);
        return u;
      },
      // Flip the UI's active role. Caller must already own `role`.
      setActiveRole: async (role) => {
        const u = await svcSetActiveRole(role);
        setUser(u);
        return u;
      },
      // Tenant verification round-trip.
      submitVerification: async (verification) => {
        const u = await svcSubmitVerification(verification);
        setUser(u);
        return u;
      },
      refresh,
    }),
    [user, refresh, roles, activeRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
