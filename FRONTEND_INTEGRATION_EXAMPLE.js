/**
 * Frontend Integration Example for JWT Token Refresh
 * 
 * This file shows how to implement automatic token refresh in the frontend
 * using axios interceptors. Copy this code to your frontend auth service.
 */

import axios from 'axios';

// ─── 1. Configure Axios to Send Cookies ─────────────────────────────────────
// Enable sending cookies with every request (required for httpOnly cookies)
axios.defaults.withCredentials = true;
axios.defaults.baseURL = 'http://localhost:5000/api'; // Update for production

// ─── 2. Response Interceptor for Automatic Token Refresh ────────────────────
axios.interceptors.response.use(
  // Success responses pass through
  (response) => response,
  
  // Handle errors, specifically 401 Unauthorized
  async (error) => {
    const originalRequest = error.config;
    
    // Check if:
    // 1. Response is 401 (Unauthorized)
    // 2. We haven't already tried to refresh for this request
    // 3. It's not the refresh endpoint itself (prevent infinite loop)
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      originalRequest._retry = true; // Mark this request as retried
      
      try {
        console.log('[Auth] Access token expired, refreshing...');
        
        // Call refresh endpoint (refreshToken cookie sent automatically)
        const { data } = await axios.post('/auth/refresh', {}, {
          withCredentials: true, // Important: send cookies
        });
        
        console.log('[Auth] Token refreshed successfully');
        
        // Store new access token
        localStorage.setItem('token', data.token);
        
        // Update axios default header
        axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
        
        // Update the failed request's header
        originalRequest.headers['Authorization'] = `Bearer ${data.token}`;
        
        // Retry the original request with new token
        return axios(originalRequest);
        
      } catch (refreshError) {
        console.error('[Auth] Token refresh failed:', refreshError);
        
        // Refresh failed - user must log in again
        localStorage.removeItem('token');
        delete axios.defaults.headers.common['Authorization'];
        
        // Redirect to login page
        window.location.href = '/login';
        
        return Promise.reject(refreshError);
      }
    }
    
    // For other errors, pass them through
    return Promise.reject(error);
  }
);

// ─── 3. Request Interceptor to Add Access Token ─────────────────────────────
axios.interceptors.request.use(
  (config) => {
    // Add access token to every request (if it exists)
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── 4. Auth Service Functions ──────────────────────────────────────────────

export const authService = {
  /**
   * Login with phone and password
   */
  async login(phone, password) {
    const { data } = await axios.post('/auth/login', {
      phoneNumber: phone,
      password: password,
    }, {
      withCredentials: true, // Important: receive cookies
    });
    
    // Store access token in localStorage
    localStorage.setItem('token', data.token);
    
    // Set default header for future requests
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    
    return data.user;
  },

  /**
   * Logout and clear tokens
   */
  async logout() {
    try {
      await axios.post('/auth/logout', {}, {
        withCredentials: true, // Important: send cookies to clear them
      });
    } catch (error) {
      console.error('[Auth] Logout error:', error);
    } finally {
      // Always clear local storage
      localStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
      window.location.href = '/login';
    }
  },

  /**
   * Signup verification (OTP)
   */
  async signupVerify(phone, otp) {
    const { data } = await axios.post('/auth/signup-verify', {
      phoneNumber: phone,
      otp: otp,
    }, {
      withCredentials: true, // Important: receive cookies
    });
    
    // Store access token
    localStorage.setItem('token', data.token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    
    return data.user;
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!localStorage.getItem('token');
  },

  /**
   * Get current access token
   */
  getToken() {
    return localStorage.getItem('token');
  },

  /**
   * Initialize auth (call on app startup)
   */
  init() {
    const token = localStorage.getItem('token');
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
  },
};

// ─── 5. React Hook Example (Optional) ────────────────────────────────────────

/**
 * Custom React hook for authentication
 * Usage: const { user, login, logout, isLoading } = useAuth();
 */
export function useAuth() {
  const [user, setUser] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);

  // Initialize on mount
  React.useEffect(() => {
    const initAuth = async () => {
      if (authService.isAuthenticated()) {
        try {
          // Fetch current user
          const { data } = await axios.get('/auth/me');
          setUser(data.user);
        } catch (error) {
          console.error('[Auth] Failed to fetch user:', error);
          // Token might be expired, let interceptor handle it
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = async (phone, password) => {
    setIsLoading(true);
    try {
      const user = await authService.login(phone, password);
      setUser(user);
      return user;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await authService.logout();
    setUser(null);
  };

  return { user, login, logout, isLoading, isAuthenticated: !!user };
}

// ─── 6. Protected Route Component Example ────────────────────────────────────

/**
 * React Router protected route component
 * Usage: <ProtectedRoute><YourComponent /></ProtectedRoute>
 */
export function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

// ─── 7. App Initialization ──────────────────────────────────────────────────

/**
 * Call this in your App.jsx or main.jsx
 */
export function initializeAuth() {
  // Initialize axios with stored token
  authService.init();
  
  // Log interceptor setup
  console.log('[Auth] Axios interceptors configured');
  console.log('[Auth] Token refresh will happen automatically on 401');
}

// ─── Usage Example ──────────────────────────────────────────────────────────

/*
// In your App.jsx or main.jsx:

import { initializeAuth } from './services/auth';

function App() {
  React.useEffect(() => {
    initializeAuth();
  }, []);
  
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
      </Routes>
    </Router>
  );
}

// In your LoginPage.jsx:

import { authService } from './services/auth';

function LoginPage() {
  const handleLogin = async (phone, password) => {
    try {
      const user = await authService.login(phone, password);
      console.log('Logged in:', user);
      navigate('/dashboard');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };
  
  // ... rest of component
}
*/

// ─── Testing the Setup ──────────────────────────────────────────────────────

/**
 * How to test:
 * 
 * 1. Login and check localStorage for 'token'
 * 2. Check browser DevTools > Application > Cookies for 'refreshToken'
 * 3. Wait 15 minutes and make an API call - should auto-refresh
 * 4. Logout and verify cookie is cleared
 * 5. Check Network tab for /auth/refresh calls on 401 errors
 */
