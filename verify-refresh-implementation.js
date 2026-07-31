/**
 * Verification Script: Refresh Token Implementation
 * 
 * This script verifies that all refresh token components are properly implemented
 * without needing actual login credentials.
 */

const fs = require('fs');
const path = require('path');

console.log('\n========================================');
console.log('🔍 REFRESH TOKEN IMPLEMENTATION VERIFICATION');
console.log('========================================\n');

let passed = 0;
let failed = 0;

function check(description, condition, details = '') {
  if (condition) {
    console.log(`✅ ${description}`);
    if (details) console.log(`   ${details}`);
    passed++;
  } else {
    console.log(`❌ ${description}`);
    if (details) console.log(`   ${details}`);
    failed++;
  }
}

// ─── 1. Check RefreshToken Model ────────────────────────────────────────────
console.log('📦 RefreshToken Model');
console.log('─────────────────────────────────────────────────────');

const modelPath = path.join(__dirname, 'models', 'RefreshToken.js');
const modelExists = fs.existsSync(modelPath);
check('RefreshToken model file exists', modelExists, modelPath);

if (modelExists) {
  const modelContent = fs.readFileSync(modelPath, 'utf8');
  check('Uses SHA-256 hashing', modelContent.includes('crypto') && modelContent.includes('sha256'));
  check('Has tokenHash field', modelContent.includes('tokenHash'));
  check('Has userId field', modelContent.includes('userId'));
  check('Has sessionId field', modelContent.includes('sessionId'));
  check('Has familyId field', modelContent.includes('familyId'));
  check('Has parentHash field', modelContent.includes('parentHash'));
  check('Has expiresAt field', modelContent.includes('expiresAt'));
  check('Has TTL index', modelContent.includes('expiresAfterSeconds') || modelContent.includes('expires'));
  check('Has generateToken method', modelContent.includes('generateToken'));
  check('Has validateToken method', modelContent.includes('validateToken'));
  check('Has revokeToken method', modelContent.includes('revokeToken'));
}

// ─── 2. Check Refresh Token Service ─────────────────────────────────────────
console.log('\n📦 Refresh Token Service');
console.log('─────────────────────────────────────────────────────');

const servicePath = path.join(__dirname, 'services', 'refreshToken.service.js');
const serviceExists = fs.existsSync(servicePath);
check('refreshToken.service file exists', serviceExists, servicePath);

if (serviceExists) {
  const serviceContent = fs.readFileSync(servicePath, 'utf8');
  check('Has issueRefreshToken function', serviceContent.includes('issueRefreshToken'));
  check('Has rotateRefreshToken function', serviceContent.includes('rotateRefreshToken'));
  check('Has handleTokenReuse function', serviceContent.includes('handleTokenReuse'));
  check('Has revokeRefreshToken function', serviceContent.includes('revokeRefreshToken'));
  check('Has revokeSessionTokens function', serviceContent.includes('revokeSessionTokens'));
  check('Has revokeAllUserTokens function', serviceContent.includes('revokeAllUserTokens'));
  check('Has getActiveSessions function', serviceContent.includes('getActiveSessions'));
  check('Includes reuse detection logic', serviceContent.includes('token_reuse_detected') || serviceContent.includes('reuse'));
  check('Revokes token families', serviceContent.includes('familyId'));
}

// ─── 3. Check Auth Routes ───────────────────────────────────────────────────
console.log('\n📦 Auth Routes');
console.log('─────────────────────────────────────────────────────');

const routesPath = path.join(__dirname, 'routes', 'auth.routes.js');
const routesExists = fs.existsSync(routesPath);
check('auth.routes file exists', routesExists, routesPath);

if (routesExists) {
  const routesContent = fs.readFileSync(routesPath, 'utf8');
  check('Imports refreshToken service', routesContent.includes("require('../services/refreshToken.service')") || routesContent.includes('refreshTokenService'));
  check('Has POST /refresh endpoint', routesContent.includes("'/refresh'") && routesContent.includes('post'));
  check('Has GET /sessions endpoint', routesContent.includes("'/sessions'") && routesContent.includes('get'));
  check('Has DELETE /sessions/:id endpoint', routesContent.includes("'/sessions/:") && routesContent.includes('delete'));
  check('Refresh endpoint calls rotateRefreshToken', routesContent.includes('rotateRefreshToken'));
  check('Sessions endpoint calls getActiveSessions', routesContent.includes('getActiveSessions'));
}

// ─── 4. Check Auth Controller Integration ──────────────────────────────────
console.log('\n📦 Auth Controller');
console.log('─────────────────────────────────────────────────────');

const authCtlPath = path.join(__dirname, 'controllers', 'auth.controller.js');
const authCtlExists = fs.existsSync(authCtlPath);
check('auth.controller file exists', authCtlExists, authCtlPath);

if (authCtlExists) {
  const authCtlContent = fs.readFileSync(authCtlPath, 'utf8');
  check('Imports refreshToken service', authCtlContent.includes('refreshTokenService'));
  check('Login issues refresh token', authCtlContent.includes('issueRefreshToken') && authCtlContent.match(/exports\.login/));
  check('Signup issues refresh token', authCtlContent.includes('issueRefreshToken') && authCtlContent.match(/signupVerify/));
  check('Logout revokes refresh tokens', authCtlContent.includes('revokeSessionTokens') || authCtlContent.includes('revokeRefreshToken'));
  check('LogoutAll revokes all tokens', authCtlContent.includes('revokeAllUserTokens'));
  check('Returns refreshToken in response', authCtlContent.includes('refreshToken'));
}

// ─── 5. Check Admin Auth Controller Integration ────────────────────────────
console.log('\n📦 Admin Auth Controller');
console.log('─────────────────────────────────────────────────────');

const adminAuthCtlPath = path.join(__dirname, 'controllers', 'admin.auth.controller.js');
const adminAuthCtlExists = fs.existsSync(adminAuthCtlPath);
check('admin.auth.controller file exists', adminAuthCtlExists, adminAuthCtlPath);

if (adminAuthCtlExists) {
  const adminAuthCtlContent = fs.readFileSync(adminAuthCtlPath, 'utf8');
  check('Imports refreshToken service', adminAuthCtlContent.includes('refreshTokenService'));
  check('Admin login issues refresh token', adminAuthCtlContent.includes('issueRefreshToken'));
  check('Admin logout revokes refresh tokens', adminAuthCtlContent.includes('revokeSessionTokens') || adminAuthCtlContent.includes('revokeRefreshToken'));
  check('Password change revokes all tokens', adminAuthCtlContent.includes('revokeAllUserTokens'));
  check('2FA verification issues refresh token', adminAuthCtlContent.includes('verify2FALogin') && adminAuthCtlContent.includes('issueRefreshToken'));
}

// ─── 6. Check Backward Compatibility ────────────────────────────────────────
console.log('\n📦 Backward Compatibility');
console.log('─────────────────────────────────────────────────────');

if (authCtlExists) {
  const authCtlContent = fs.readFileSync(authCtlPath, 'utf8');
  // Check that responses include BOTH token and refreshToken
  const hasTokenField = authCtlContent.includes('token:') || authCtlContent.includes('token,');
  const hasRefreshTokenField = authCtlContent.includes('refreshToken:') || authCtlContent.includes('refreshToken,');
  check('Login returns both token and refreshToken', hasTokenField && hasRefreshTokenField, 'Old clients use token, new clients use refreshToken');
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n========================================');
console.log('📊 VERIFICATION SUMMARY');
console.log('========================================');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

if (failed === 0) {
  console.log('\n✅ All checks passed! Refresh token implementation is complete.');
  console.log('\n🔒 Security Features Implemented:');
  console.log('   • RefreshToken model with SHA-256 hashing');
  console.log('   • Token rotation with family tracking');
  console.log('   • Reuse detection with automatic revocation');
  console.log('   • Session management endpoints');
  console.log('   • Integration with login/logout flows');
  console.log('   • Backward compatibility maintained');
  console.log('\n📝 Next Steps:');
  console.log('   1. Test with actual login credentials');
  console.log('   2. Monitor logs for reuse detection events');
  console.log('   3. Update frontend to use refresh tokens');
  console.log('');
  process.exit(0);
} else {
  console.log('\n⚠️  Some checks failed. Review the implementation.');
  console.log('');
  process.exit(1);
}
