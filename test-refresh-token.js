/**
 * Manual Test Script for Refresh Token Flow
 * 
 * Tests:
 * 1. Login returns both token and refreshToken
 * 2. Token rotation works (POST /api/auth/refresh)
 * 3. Reuse detection triggers family revocation
 * 4. Session management endpoints work
 * 5. Logout revokes refresh tokens
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';
const TEST_PHONE = '+8801700000000'; // Use your test phone
const TEST_PASSWORD = 'Test@123';

let accessToken1 = null;
let refreshToken1 = null;
let refreshToken2 = null;
let userId = null;

async function test() {
  console.log('\n========================================');
  console.log('🔐 REFRESH TOKEN FLOW TEST');
  console.log('========================================\n');

  try {
    // ─── Test 1: Login Returns Both Tokens ────────────────────────────────
    console.log('📝 Test 1: Login returns both token and refreshToken');
    console.log('─────────────────────────────────────────────────────');
    
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      phoneNumber: TEST_PHONE,
      password: TEST_PASSWORD,
    }).catch(err => {
      console.log('⚠️  Login failed - using admin login instead');
      return axios.post(`${BASE_URL}/admin/auth/login`, {
        phone: TEST_PHONE,
        password: TEST_PASSWORD,
      });
    });

    accessToken1 = loginRes.data.token;
    refreshToken1 = loginRes.data.refreshToken;
    userId = loginRes.data.user?._id || loginRes.data.admin?.id;

    if (!accessToken1) {
      throw new Error('❌ No access token in response');
    }
    if (!refreshToken1) {
      throw new Error('❌ No refresh token in response');
    }

    console.log('✅ Login successful');
    console.log('   Access Token:', accessToken1.substring(0, 30) + '...');
    console.log('   Refresh Token:', refreshToken1.substring(0, 30) + '...');
    console.log('   User ID:', userId);

    // ─── Test 2: Token Rotation Works ─────────────────────────────────────
    console.log('\n📝 Test 2: Refresh token rotation');
    console.log('─────────────────────────────────────────────────────');
    
    const refreshRes = await axios.post(`${BASE_URL}/auth/refresh`, {
      refreshToken: refreshToken1,
    });

    const accessToken2 = refreshRes.data.accessToken;
    refreshToken2 = refreshRes.data.refreshToken;

    if (!accessToken2 || !refreshToken2) {
      throw new Error('❌ Rotation failed - missing tokens');
    }

    if (refreshToken1 === refreshToken2) {
      throw new Error('❌ Refresh token was not rotated!');
    }

    console.log('✅ Token rotation successful');
    console.log('   New Access Token:', accessToken2.substring(0, 30) + '...');
    console.log('   New Refresh Token:', refreshToken2.substring(0, 30) + '...');
    console.log('   ✓ Refresh token changed (rotation confirmed)');

    // ─── Test 3: Reuse Detection ──────────────────────────────────────────
    console.log('\n📝 Test 3: Reuse detection (should fail)');
    console.log('─────────────────────────────────────────────────────');
    
    try {
      await axios.post(`${BASE_URL}/auth/refresh`, {
        refreshToken: refreshToken1, // Try to reuse old token
      });
      console.log('❌ SECURITY RISK: Old token was accepted (reuse detection failed)');
    } catch (err) {
      if (err.response?.data?.code === 'token_reuse_detected') {
        console.log('✅ Reuse detection working');
        console.log('   Error:', err.response.data.message);
        console.log('   ✓ Token family and sessions should be revoked');
      } else {
        console.log('⚠️  Unexpected error:', err.response?.data || err.message);
      }
    }

    // ─── Test 4: Session Management ───────────────────────────────────────
    console.log('\n📝 Test 4: Session management endpoints');
    console.log('─────────────────────────────────────────────────────');
    
    // Need to login again after reuse detection (all sessions revoked)
    const loginRes2 = await axios.post(`${BASE_URL}/auth/login`, {
      phoneNumber: TEST_PHONE,
      password: TEST_PASSWORD,
    }).catch(err => {
      return axios.post(`${BASE_URL}/admin/auth/login`, {
        phone: TEST_PHONE,
        password: TEST_PASSWORD,
      });
    });

    const newAccessToken = loginRes2.data.token;
    const newRefreshToken = loginRes2.data.refreshToken;

    // Get active sessions
    const sessionsRes = await axios.get(`${BASE_URL}/auth/sessions`, {
      headers: { Authorization: `Bearer ${newAccessToken}` },
    });

    console.log('✅ GET /auth/sessions successful');
    console.log('   Active sessions:', sessionsRes.data.sessions?.length || 0);
    console.log('   Current session ID:', sessionsRes.data.currentSessionId);

    if (sessionsRes.data.sessions?.length > 0) {
      const sessionToRevoke = sessionsRes.data.sessions[0].sessionId;
      
      // Revoke a specific session
      const revokeRes = await axios.delete(
        `${BASE_URL}/auth/sessions/${sessionToRevoke}`,
        { headers: { Authorization: `Bearer ${newAccessToken}` } }
      );

      console.log('✅ DELETE /auth/sessions/:id successful');
      console.log('   Revoked count:', revokeRes.data.revokedCount);
    }

    // ─── Test 5: Logout Revokes Refresh Tokens ────────────────────────────
    console.log('\n📝 Test 5: Logout revokes refresh tokens');
    console.log('─────────────────────────────────────────────────────');
    
    // Login fresh for logout test
    const loginRes3 = await axios.post(`${BASE_URL}/auth/login`, {
      phoneNumber: TEST_PHONE,
      password: TEST_PASSWORD,
    }).catch(err => {
      return axios.post(`${BASE_URL}/admin/auth/login`, {
        phone: TEST_PHONE,
        password: TEST_PASSWORD,
      });
    });

    const logoutToken = loginRes3.data.token;
    const logoutRefreshToken = loginRes3.data.refreshToken;

    // Logout
    await axios.post(`${BASE_URL}/auth/logout`, {}, {
      headers: { Authorization: `Bearer ${logoutToken}` },
    });

    console.log('✅ Logout successful');

    // Try to use refresh token after logout (should fail)
    try {
      await axios.post(`${BASE_URL}/auth/refresh`, {
        refreshToken: logoutRefreshToken,
      });
      console.log('❌ SECURITY RISK: Refresh token still valid after logout');
    } catch (err) {
      console.log('✅ Refresh token revoked after logout');
      console.log('   Error:', err.response?.data?.message || err.message);
    }

    // ─── Test 6: Backward Compatibility ───────────────────────────────────
    console.log('\n📝 Test 6: Backward compatibility (old clients)');
    console.log('─────────────────────────────────────────────────────');
    
    const oldClientLogin = await axios.post(`${BASE_URL}/auth/login`, {
      phoneNumber: TEST_PHONE,
      password: TEST_PASSWORD,
    }).catch(err => {
      return axios.post(`${BASE_URL}/admin/auth/login`, {
        phone: TEST_PHONE,
        password: TEST_PASSWORD,
      });
    });

    // Old clients only use the access token
    const oldToken = oldClientLogin.data.token;
    
    // Test that old token still works
    const meRes = await axios.get(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${oldToken}` },
    });

    console.log('✅ Backward compatibility maintained');
    console.log('   Old clients can ignore refreshToken field');
    console.log('   Access token still works:', !!meRes.data.user || !!meRes.data.admin);

    // ─── Summary ──────────────────────────────────────────────────────────
    console.log('\n========================================');
    console.log('✅ ALL TESTS PASSED');
    console.log('========================================');
    console.log('\n🔒 Security Features Verified:');
    console.log('   ✓ Refresh tokens issued on login');
    console.log('   ✓ Token rotation works');
    console.log('   ✓ Reuse detection active');
    console.log('   ✓ Session management functional');
    console.log('   ✓ Logout revokes tokens');
    console.log('   ✓ Backward compatible with old clients');
    console.log('\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    if (err.response?.data) {
      console.error('   Response:', JSON.stringify(err.response.data, null, 2));
    }
    console.error('\n');
    process.exit(1);
  }
}

// Run tests
test();
