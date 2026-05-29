import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  Search,
  MessageCircle,
  User,
  PlusCircle,
  Heart,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * MobileBottomNav — fixed-position bottom rail for the mobile app shell.
 *
 * Rendered globally in App.jsx, gated with `md:hidden` so desktop is never
 * affected. The centre slot is a raised brand-red "+ List Property" floating
 * action.
 *
 * Layout (left to right) — role-aware:
 *   Tenant       : Home · Saved · Explore · Messages · Profile
 *   Landlord/guest: Home · Explore · [+List FAB] · Messages · Profile
 *
 * Tenants never list properties, so the centre slot becomes a regular
 * "Saved" tab (deep-link into the tenant dashboard's Saved tab) instead
 * of the floating + List action.
 *
 * Profile button behaviour (auth-aware):
 *   - Not logged in → opens the Navbar slide-out drawer (Join TO-LET PRO,
 *     Login / Sign Up). The drawer used to open from the bell; now it lives
 *     under Profile so the bell can be reserved for notifications.
 *   - Logged in as `tenant` → /tenant-dashboard
 *   - Logged in as `landlord` → /host-dashboard
 *   - Logged in as admin/support → /admin (already-protected route)
 *
 * @param {{ hideOnRoutes?: string[] }} props - optional route prefixes where
 *   the bottom nav should be hidden (defaults to /login + /admin).
 */
const MobileBottomNav = ({ hideOnRoutes }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isAdmin } = useAuth();

  const hides = hideOnRoutes ?? ['/login', '/admin', '/list-property'];

  if (hides.some((r) => location.pathname.startsWith(r))) return null;

  // Tenants don't list properties — swap the centre +List FAB for a
  // regular "Saved" tab that deep-links into the tenant dashboard's
  // Saved view. Landlords + guests keep the existing FAB so they can
  // start a new listing in one tap.
  const isTenant = isAuthenticated && user?.role === 'tenant';

  const LEFT = isTenant
    ? [
        { id: 'home',  label: 'Home',  icon: Home,  to: '/' },
        { id: 'saved', label: 'Saved', icon: Heart, to: '/tenant-dashboard', tab: 'saved' },
      ]
    : [
        { id: 'home',    label: 'Home',    icon: Home,   to: '/' },
        { id: 'explore', label: 'Explore', icon: Search, to: '/properties/all' },
      ];

  // Profile target depends on who's logged in. Falls back to "open drawer"
  // for guests so they can pick Login / Sign Up.
  const profileTarget = (() => {
    if (!isAuthenticated) return { id: 'profile', label: 'Profile', icon: User, action: 'drawer' };
    if (isAdmin)           return { id: 'profile', label: 'Profile', icon: User, to: '/admin' };
    if (user?.role === 'landlord') return { id: 'profile', label: 'Profile', icon: User, to: '/host-dashboard' };
    // default to tenant
    return { id: 'profile', label: 'Profile', icon: User, to: '/tenant-dashboard' };
  })();

  const RIGHT = isTenant
    ? [
        { id: 'explore',  label: 'Explore',  icon: Search,        to: '/properties/all' },
        { id: 'messages', label: 'Messages', icon: MessageCircle, to: '/messages' },
        profileTarget,
      ]
    : [
        { id: 'messages', label: 'Messages', icon: MessageCircle, to: '/messages' },
        profileTarget,
      ];

  const isActive = (item) => {
    if (item.action === 'drawer') return false;
    if (item.id === 'home') return location.pathname === '/';
    // Tenant Saved + Profile both point at /tenant-dashboard —
    // disambiguate via the `tab` flag in location.state so only the
    // matching button shows the active treatment.
    if (item.to === '/tenant-dashboard') {
      const onTenant = location.pathname === '/tenant-dashboard';
      if (!onTenant) return false;
      const activeTab = location.state && location.state.activeTab;
      if (item.tab === 'saved')  return activeTab === 'saved';
      if (!item.tab)             return !activeTab || activeTab === 'overview' || activeTab === 'profile';
      return activeTab === item.tab;
    }
    return location.pathname === item.to || location.pathname.startsWith(item.to + '/');
  };

  const handleClick = (item) => {
    if (item.action === 'drawer') {
      // Tell <Navbar> to open its slide-out drawer. See the matching
      // `open-mobile-menu` listener in Navbar.jsx.
      window.dispatchEvent(new CustomEvent('open-mobile-menu'));
      return;
    }
    if (item.tab) {
      navigate(item.to, { state: { activeTab: item.tab } });
      return;
    }
    navigate(item.to);
  };

  const NavBtn = ({ item }) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <button
        onClick={() => handleClick(item)}
        className="flex-1 h-full flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform select-none"
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
      >
        <span
          className={`relative w-11 h-7 flex items-center justify-center transition-all duration-300 ${
            active ? '-translate-y-[3px]' : ''
          }`}
        >
          {active && (
            <span className="absolute inset-0 rounded-full bg-[#ba0036]/10 ring-2 ring-[#ba0036]/15" />
          )}
          <Icon
            size={20}
            strokeWidth={active ? 2.6 : 2.1}
            className={`relative ${active ? 'text-[#ba0036]' : 'text-gray-500'}`}
          />
        </span>
        <span
          className={`text-[10px] font-bold transition-colors ${
            active ? 'text-[#ba0036]' : 'text-gray-500'
          }`}
        >
          {item.label}
        </span>
      </button>
    );
  };

  return (
    <>
      {/* soft fade above the bar so content underneath blends smoothly */}
      <div className="md:hidden fixed bottom-[64px] inset-x-0 h-6 pointer-events-none bg-gradient-to-t from-white/85 to-transparent z-30" />

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-[64px] bg-white/85 backdrop-blur-xl backdrop-saturate-150 border-t border-white/60 shadow-[0_-6px_20px_-8px_rgba(15,23,42,0.12)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="relative h-full max-w-md mx-auto flex items-center px-1">
          {LEFT.map((item) => (
            <NavBtn key={item.id} item={item} />
          ))}

          {isTenant ? null : (
            /* CENTRE (non-tenant only): floating "+ List" action. Tenants
               never list properties, so the FAB is omitted for them and the
               nav becomes 5 equal-width tabs. */
            <div className="flex-1 h-full flex flex-col items-center justify-end relative pb-1">
              <button
                onClick={() => navigate('/list-property')}
                className="absolute -top-5 w-14 h-14 rounded-2xl bg-gradient-to-br from-[#ba0036] via-[#d4143a] to-[#ff4d6d] text-white flex items-center justify-center shadow-[0_12px_30px_-8px_rgba(186,0,54,0.55)] active:scale-95 transition-transform ring-4 ring-white"
                aria-label="List a property"
              >
                <PlusCircle size={26} strokeWidth={2.2} />
              </button>
              <span className="text-[9px] font-black uppercase tracking-widest text-[#ba0036]">
                List
              </span>
            </div>
          )}

          {RIGHT.map((item) => (
            <NavBtn key={item.id} item={item} />
          ))}
        </div>
      </nav>
    </>
  );
};

export default MobileBottomNav;
