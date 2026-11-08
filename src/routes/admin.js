/**
 * Admin Management Dashboard (/admin) API Routes
 * Handles:
 * - Protected login (admin / admin123)
 * - Creating, updating, revoking, reactivating, and deleting 4-digit PINs
 * - Custom Instructions & Recommendations per PIN
 * - Response Tone / Model Persona per PIN
 * - Tracking lockout states, security audit logs, and unblocking/locking IPs manually
 */
const express = require('express');
const config = require('../config');
const { PinRepo, MessageRepo, RateLimitRepo, SecurityEventRepo, buildContextAwareWelcomeMessage } = require('../db/repository');
const { createAdminToken, extractClientIp, requireAdminAuth } = require('../security/auth');
const agyManager = require('../services/agyManager');

module.exports = function createAdminRouter(io) {
  const router = express.Router();

  /**
   * POST /api/admin/login
   * Authenticates with admin / admin123 credentials.
   */
  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const ip = extractClientIp(req);

    if (username === config.ADMIN_USERNAME && password === config.ADMIN_PASSWORD) {
      const token = createAdminToken(username);
      res.cookie('gapless_admin_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      SecurityEventRepo.log({
        ip,
        event_type: 'ADMIN_LOGIN_SUCCESS',
        details: `Admin "${username}" signed in successfully.`
      });

      return res.json({
        success: true,
        token,
        admin: { username }
      });
    }

    SecurityEventRepo.log({
      ip,
      event_type: 'ADMIN_LOGIN_FAILED',
      details: `Failed admin login attempt with username "${username || ''}".`
    });

    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة (اسم المستخدم أو كلمة المرور خاطئة).' });
  });

  /**
   * POST /api/admin/logout
   */
  router.post('/logout', (_req, res) => {
    res.clearCookie('gapless_admin_token');
    res.json({ success: true });
  });

  /**
   * GET /api/admin/me
   */
  router.get('/me', requireAdminAuth, (req, res) => {
    res.json({ authenticated: true, admin: req.admin });
  });

  /**
   * GET /api/admin/overview
   * Returns all PINs, rate-limit lockouts, security events, and `agy` engine status.
   */
  router.get('/overview', requireAdminAuth, (_req, res) => {
    const pins = PinRepo.getAll();
    const rateLimits = RateLimitRepo.getAllTracked();
    const securityEvents = SecurityEventRepo.getRecent(50);
    const engineStatus = agyManager.getStatus();

    res.json({
      pins,
      rateLimits,
      securityEvents,
      engineStatus
    });
  });

  /**
   * POST /api/admin/pins
   * Create a new 4-digit PIN linked to a Client/Project Name, Custom Instructions, and Persona.
   */
  router.post('/pins', requireAdminAuth, (req, res) => {
    const { pin, client_name, project_name, custom_instructions, persona } = req.body || {};
    const cleanPin = String(pin || '').trim();

    if (!/^\d{4}$/.test(cleanPin)) {
      return res.status(400).json({ error: 'يجب أن يتكون رمز PIN من 4 أرقام بالضبط (مثال: 4829).' });
    }
    if (!client_name || !project_name) {
      return res.status(400).json({ error: 'يرجى إدخال اسم العميل واسم المشروع.' });
    }

    const existing = PinRepo.getByPinCode(cleanPin);
    if (existing) {
      return res.status(409).json({ error: `رمز PIN (${cleanPin}) مستخدم بالفعل لمشروع آخر.` });
    }

    const created = PinRepo.create({
      pin: cleanPin,
      client_name,
      project_name,
      custom_instructions: custom_instructions || '',
      persona: persona || 'friendly_consultant'
    });

    io.to('dev_monitors').emit('admin:pins_updated', PinRepo.getAll());
    res.status(201).json({ success: true, pin: created });
  });

  /**
   * PUT /api/admin/pins/:id
   * Update PIN details, Custom Instructions, Persona, or status (active / revoked).
   */
  router.put('/pins/:id', requireAdminAuth, (req, res) => {
    const { id } = req.params;
    const { pin, client_name, project_name, custom_instructions, persona, status } = req.body || {};

    if (pin !== undefined) {
      const cleanPin = String(pin).trim();
      if (!/^\d{4}$/.test(cleanPin)) {
        return res.status(400).json({ error: 'يجب أن يتكون رمز PIN من 4 أرقام بالضبط.' });
      }
      const conflict = PinRepo.getByPinCode(cleanPin);
      if (conflict && conflict.id !== id) {
        return res.status(409).json({ error: `رمز PIN (${cleanPin}) مستخدم بالفعل.` });
      }
    }

    const updated = PinRepo.update(id, {
      pin: pin !== undefined ? String(pin).trim() : undefined,
      client_name,
      project_name,
      custom_instructions,
      persona,
      status
    });

    if (!updated) {
      // If the PIN record was deleted earlier while the form was still in edit mode,
      // gracefully create it as a new PIN if full creation details are present!
      if (pin && client_name && project_name) {
        const cleanPin = String(pin).trim();
        const created = PinRepo.create({
          pin: cleanPin,
          client_name,
          project_name,
          custom_instructions: custom_instructions || '',
          persona: persona || 'adaptive_smart'
        });
        io.to('dev_monitors').emit('admin:pins_updated', PinRepo.getAll());
        return res.status(201).json({ success: true, pin: created });
      }
      return res.status(404).json({ error: 'لم يتم العثور على رمز PIN المطلوب.' });
    }

    if (status === 'revoked') {
      io.to(`pin:${id}`).emit('session:revoked', {
        message: 'تم إيقاف جلسة هذا الرمز من قبل مسؤول النظام.'
      });
    }

    io.to('dev_monitors').emit('admin:pins_updated', PinRepo.getAll());
    res.json({ success: true, pin: updated });
  });

  /**
   * DELETE /api/admin/pins/:id
   * Deletes a PIN and its associated session history.
   */
  router.delete('/pins/:id', requireAdminAuth, (req, res) => {
    const { id } = req.params;
    const existing = PinRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'لم يتم العثور على الرمز.' });
    }

    PinRepo.delete(id);
    io.to(`pin:${id}`).emit('session:revoked', {
      message: 'تم حذف جلسة المشروع من قبل الإدارة.'
    });
    io.to('dev_monitors').emit('admin:pins_updated', PinRepo.getAll());
    res.json({ success: true });
  });

  /**
   * POST /api/admin/rate-limits/unblock
   * Manually unblocks an IP and resets its failed attempts counter.
   */
  router.post('/rate-limits/unblock', requireAdminAuth, (req, res) => {
    const { ip } = req.body || {};
    if (!ip) {
      return res.status(400).json({ error: 'عنوان IP مطلوب.' });
    }

    RateLimitRepo.resetIp(ip);
    SecurityEventRepo.log({
      ip,
      event_type: 'ADMIN_UNBLOCKED_IP',
      details: `Admin manually unblocked IP ${ip} and reset failed attempts.`
    });

    const updatedList = RateLimitRepo.getAllTracked();
    io.to('dev_monitors').emit('security:rate_limit_updated', updatedList);
    res.json({ success: true, rateLimits: updatedList });
  });

  /**
   * POST /api/admin/rate-limits/lock
   * Allows admin to manually lock a suspicious IP for 5 minutes.
   */
  router.post('/rate-limits/lock', requireAdminAuth, (req, res) => {
    const { ip } = req.body || {};
    if (!ip) {
      return res.status(400).json({ error: 'عنوان IP مطلوب.' });
    }

    RateLimitRepo.lockIpManually(ip);
    SecurityEventRepo.log({
      ip,
      event_type: 'ADMIN_LOCKED_IP',
      details: `Admin manually locked IP ${ip} for 5 minutes.`
    });

    const updatedList = RateLimitRepo.getAllTracked();
    io.to('dev_monitors').emit('security:rate_limit_updated', updatedList);
    res.json({ success: true, rateLimits: updatedList });
  });

  /**
   * POST /api/admin/pins/:id/reset-chat
   * Clears messages and resets the conversation for a PIN while keeping the welcome message.
   */
  router.post('/pins/:id/reset-chat', requireAdminAuth, (req, res) => {
    const { id } = req.params;
    const pinRecord = PinRepo.getById(id);
    if (!pinRecord) {
      return res.status(404).json({ error: 'الرمز غير موجود.' });
    }

    MessageRepo.clearHistory(id);
    const welcomeText = buildContextAwareWelcomeMessage({
      clientName: pinRecord.client_name,
      projectName: pinRecord.project_name,
      customInstructions: pinRecord.custom_instructions,
      persona: pinRecord.persona
    });
    const welcomeMsg = MessageRepo.create({
      pin_id: id,
      sender: 'ai',
      content: welcomeText,
      is_internal: 0
    });

    io.to(`pin:${id}`).emit('chat:reset', { messages: [welcomeMsg] });
    io.to('dev_monitors').emit('dev:chat_reset', { pinId: id, messages: [welcomeMsg] });
    res.json({ success: true, messages: [welcomeMsg] });
  });

  return router;
};
