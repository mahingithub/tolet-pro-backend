'use strict';

/**
 * zegoToken.js — ZegoCloud token generator (token version "04").
 *
 * This is a faithful port of ZEGOCLOUD's official Node.js token generator
 * (`zego_server_assistant/token/nodejs/server/zegoServerAssistant.js`),
 * rewritten to use only Node's built-in `crypto` module — so it adds NO
 * new npm dependency.
 *
 * Token wire format (must be byte-exact or ZegoCloud rejects it):
 *   "04" + base64( expire(8 bytes, BE) | ivLen(2) | iv | cipherLen(2) | cipher )
 *   cipher = AES-CBC( JSON(tokenInfo), key=serverSecret, iv )
 *   AES key size is chosen from the secret's byte length (16/24/32 → 128/192/256).
 *
 * ── If you ever see a ZegoCloud "tokenInvalid" / auth error ──────────────
 * Replace the body of `generateToken04` below with the upstream file from
 *   https://github.com/ZEGOCLOUD/zego_server_assistant
 *   (token/nodejs/server/zegoServerAssistant.js)
 * Keep the exported `generateZegoToken(...)` wrapper at the bottom unchanged
 * so the controller keeps working.
 */

const crypto = require('crypto');

const ErrorCode = {
  success: 0,
  appIDInvalid: 1,
  userIDInvalid: 3,
  secretInvalid: 5,
  effectiveTimeInSecondsInvalid: 6,
};

// Random signed 32-bit integer for the token nonce.
function randNonce() {
  return Math.floor(Math.random() * 2147483647) - Math.floor(Math.random() * 2147483648);
}

// 16-byte random IV (printable ASCII so it's exactly 16 bytes).
function makeRandomIv() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let iv = '';
  for (let i = 0; i < 16; i++) {
    iv += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return iv;
}

// Pick the AES variant from the key length, mirroring the official lib.
function aesAlgorithmForKey(keyBuf) {
  switch (keyBuf.length) {
    case 16: return 'aes-128-cbc';
    case 24: return 'aes-192-cbc';
    case 32: return 'aes-256-cbc';
    default:
      throw new Error(`[zegoToken] serverSecret must be 16/24/32 bytes, got ${keyBuf.length}`);
  }
}

// AES-CBC with PKCS#7 padding (Node default), returns the ciphertext Buffer.
function aesEncrypt(plainText, keyBuf, ivStr) {
  const algorithm = aesAlgorithmForKey(keyBuf);
  const cipher = crypto.createCipheriv(algorithm, keyBuf, Buffer.from(ivStr));
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(Buffer.from(plainText, 'utf8')), cipher.final()]);
}

/**
 * Generate a version-04 ZegoCloud token.
 *
 * @param {number} appId                  ZegoCloud App ID (number).
 * @param {string} userId                 The user identity (must match loginRoom's userID).
 * @param {string} secret                 32-byte ZegoCloud Server Secret.
 * @param {number} effectiveTimeInSeconds Token lifetime in seconds.
 * @param {string} [payload]              JSON string for room/privilege scoping ('' = basic token).
 * @returns {string} The token string (starts with "04").
 */
function generateToken04(appId, userId, secret, effectiveTimeInSeconds, payload = '') {
  if (!appId || typeof appId !== 'number') {
    throw { errorCode: ErrorCode.appIDInvalid, errorMessage: 'appID invalid' };
  }
  if (!userId || typeof userId !== 'string') {
    throw { errorCode: ErrorCode.userIDInvalid, errorMessage: 'userId invalid' };
  }
  if (!secret || typeof secret !== 'string' || secret.length !== 32) {
    throw { errorCode: ErrorCode.secretInvalid, errorMessage: 'secret must be a 32-byte string' };
  }
  if (!(effectiveTimeInSeconds > 0)) {
    throw { errorCode: ErrorCode.effectiveTimeInSecondsInvalid, errorMessage: 'effectiveTimeInSeconds invalid' };
  }

  const createTime = Math.floor(Date.now() / 1000);
  const expire = createTime + effectiveTimeInSeconds;

  const tokenInfo = {
    app_id: appId,
    user_id: userId,
    nonce: randNonce(),
    ctime: createTime,
    expire,
    payload: payload || '',
  };

  const plainText = JSON.stringify(tokenInfo);
  const iv = makeRandomIv();
  const keyBuf = Buffer.from(secret);
  const cipher = aesEncrypt(plainText, keyBuf, iv);

  // expire: 8 bytes big-endian (int64)
  const bExpire = Buffer.alloc(8);
  bExpire.writeBigInt64BE(BigInt(expire), 0);

  // iv length: 2 bytes big-endian
  const bIvLen = Buffer.alloc(2);
  bIvLen.writeUInt16BE(iv.length, 0);

  // cipher length: 2 bytes big-endian
  const bCipherLen = Buffer.alloc(2);
  bCipherLen.writeUInt16BE(cipher.length, 0);

  const packet = Buffer.concat([
    bExpire,
    bIvLen,
    Buffer.from(iv),
    bCipherLen,
    cipher,
  ]);

  return '04' + packet.toString('base64');
}

// Privilege keys for the RTC room payload.
const PRIVILEGE_KEY_LOGIN = 1;
const PRIVILEGE_KEY_PUBLISH = 2;
const PRIVILEGE_ENABLE = 1;

/**
 * High-level helper used by the calls controller.
 * Produces a room-scoped token that allows BOTH login and publish for `roomId`.
 *
 * @param {Object} p
 * @param {number} p.appId
 * @param {string} p.userId
 * @param {string} p.serverSecret
 * @param {number} p.effectiveTimeInSeconds
 * @param {string} p.roomId
 * @returns {string} token
 */
function generateZegoToken({ appId, userId, serverSecret, effectiveTimeInSeconds, roomId }) {
  const payloadObject = {
    room_id: String(roomId),
    privilege: {
      [PRIVILEGE_KEY_LOGIN]: PRIVILEGE_ENABLE,   // allow loginRoom
      [PRIVILEGE_KEY_PUBLISH]: PRIVILEGE_ENABLE, // allow publishStream
    },
    stream_id_list: null,
  };
  const payload = JSON.stringify(payloadObject);
  return generateToken04(Number(appId), String(userId), serverSecret, effectiveTimeInSeconds, payload);
}

module.exports = { generateZegoToken, generateToken04, ErrorCode };
