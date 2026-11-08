/**
 * Authentication & Cryptographic Session Token Manager
 * Uses HMAC-SHA256 signed stateless tokens stored in HTTP-only cookies or Bearer headers.
 */
const crypto = require('crypto');
const config = require('../config');

function signPayload(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [data, signature] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', config.SESSION_SECRET)
    .update(data)
    .digest('base64url');

  if (signature.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function createClientToken(pinRecord) {
  return signPayload({
    role: 'client',
    pinId: pinRecord.id,
    pin: pinRecord.pin,
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  });
}

function createAdminToken(username) {
  return signPayload({
    role: 'admin',
    username,
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  });
}

function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

function requireAdminAuth(req, res, next) {
  const token =
    req.cookies?.gapless_admin_token ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  const payload = verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required' });
  }
  req.admin = payload;
  next();
}

function requireClientAuth(req, res, next) {
  const token =
    req.cookies?.gapless_client_token ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null) ||
    req.headers['x-client-token'];

  const payload = verifyToken(token);
  if (!payload || payload.role !== 'client') {
    return res.status(401).json({ error: 'Unauthorized: Valid PIN session required' });
  }
  req.clientSession = payload;
  next();
}

module.exports = {
  signPayload,
  verifyToken,
  createClientToken,
  createAdminToken,
  extractClientIp,
  requireAdminAuth,
  requireClientAuth
};
