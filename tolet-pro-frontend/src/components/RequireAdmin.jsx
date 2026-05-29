import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Route guard for /admin/* — bounces non-admins to /login with a `next`
 * search param so they return to the admin URL after signing in.
 *
 * Drop-in usage in App.jsx:
 *   <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
 */
const RequireAdmin = ({ children }) => {
  const { isAdmin } = useAuth();
  const location = useLocation();

  if (!isAdmin) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}&admin=1`} replace />;
  }
  return children;
};

export default RequireAdmin;
