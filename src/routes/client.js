/**
 * Client Gateway & Chat API Routes
 * Handles:
 * - Rate-limited 4-digit PIN authentication (max 5 failed attempts -> 5-minute lockout)
 * - Real-time lockout countdown status
 * - Client session verification & chat history loading
 * - Client message submission & media uploads (sketches, screenshots, wireframes)
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { PinRepo, MessageRepo, RateLimitRepo, SecurityEventRepo } = require('../db/repository');
const { createClientToken, extractClientIp, requireClientAuth } = require('../security/auth');
const { sanitizeClientInput } = require('../security/sanitizer');
const agyManager = require('../services/agyManager');

// Ensure uploads directory exists
if (!fs.existsSync(config.UPLOADS_DIR)) {
  fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.pdf'].includes(ext) ? ext : '.png';
    cb(null, `sketch-${Date.now()}-${uuidv4().slice(0, 8)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only image files (PNG, JPG, WEBP, SVG) or PDF wireframes are allowed.'));
    }
  }
});

module.exports = function createClientRouter(io) {
  const router = express.Router();

  /**
   * GET /api/client/lockout-status
   * Returns current rate-limit & lockout timer for the visitor's IP.
   */
  router.get('/lockout-status', (req, res) => {
    const ip = extractClientIp(req);
    const status = RateLimitRepo.getByIp(ip);
    res.json({
      ip,
      isLocked: status.is_locked,
      failedAttempts: status.failed_attempts,
      maxAttempts: config.MAX_FAILED_ATTEMPTS,
      lockoutUntil: status.lockout_until,
      remainingMs: status.remaining_ms,
      remainingSeconds: status.remaining_seconds || 0
    });
  });

  /**
   * POST /api/client/verify-pin
   * Validates a 4-digit PIN with strict 5-attempt / 5-minute lockout enforcement.
   */
  router.post('/verify-pin', (req, res) => {
    const ip = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const rateStatus = RateLimitRepo.getByIp(ip);

    if (rateStatus.is_locked) {
      return res.status(429).json({
        error: 'تم قفل المحاولات مؤقتاً بسبب تجاوز الحد المسموح (5 محاولات خاطئة). يرجى الانتظار حتى انتهاء المؤقت.',
        isLocked: true,
        failedAttempts: rateStatus.failed_attempts,
        maxAttempts: config.MAX_FAILED_ATTEMPTS,
        lockoutUntil: rateStatus.lockout_until,
        remainingMs: rateStatus.remaining_ms,
        remainingSeconds: rateStatus.remaining_seconds
      });
    }

    const rawPin = String(req.body?.pin || '').trim();
    if (!/^\d{4}$/.test(rawPin)) {
      const updatedRate = RateLimitRepo.recordFailedAttempt(ip, userAgent);
      SecurityEventRepo.log({
        ip,
        event_type: updatedRate.is_locked ? 'IP_LOCKOUT_TRIGGERED' : 'PIN_FAILED_ATTEMPT',
        details: `Invalid PIN format attempt (${rawPin ? 'non-4-digit' : 'empty'}). Attempt ${updatedRate.failed_attempts}/${config.MAX_FAILED_ATTEMPTS}`
      });

      io.to('dev_monitors').emit('security:rate_limit_updated', RateLimitRepo.getAllTracked());

      const statusCode = updatedRate.is_locked ? 429 : 401;
      return res.status(statusCode).json({
        error: updatedRate.is_locked
          ? 'تم تجاوز 5 محاولات خاطئة! تم تفعيل الحظر المؤقت لمدة 5 دقائق.'
          : `رمز الدخول غير صالح. المحاولات المتبقية: ${Math.max(0, config.MAX_FAILED_ATTEMPTS - updatedRate.failed_attempts)}`,
        isLocked: updatedRate.is_locked,
        failedAttempts: updatedRate.failed_attempts,
        maxAttempts: config.MAX_FAILED_ATTEMPTS,
        lockoutUntil: updatedRate.lockout_until,
        remainingMs: updatedRate.remaining_ms,
        remainingSeconds: updatedRate.remaining_seconds
      });
    }

    const pinRecord = PinRepo.getByPinCode(rawPin);
    if (!pinRecord || pinRecord.status !== 'active') {
      const updatedRate = RateLimitRepo.recordFailedAttempt(ip, userAgent);
      SecurityEventRepo.log({
        ip,
        pin_id: pinRecord ? pinRecord.id : null,
        event_type: updatedRate.is_locked ? 'IP_LOCKOUT_TRIGGERED' : 'PIN_FAILED_ATTEMPT',
        details: pinRecord
          ? `Attempted login to revoked/inactive PIN ${rawPin}. Attempt ${updatedRate.failed_attempts}/${config.MAX_FAILED_ATTEMPTS}`
          : `Failed PIN attempt "${rawPin}". Attempt ${updatedRate.failed_attempts}/${config.MAX_FAILED_ATTEMPTS}`
      });

      io.to('dev_monitors').emit('security:rate_limit_updated', RateLimitRepo.getAllTracked());

      const statusCode = updatedRate.is_locked ? 429 : 401;
      return res.status(statusCode).json({
        error: updatedRate.is_locked
          ? 'تم تجاوز 5 محاولات خاطئة! تم قفل الدخول لمدة 5 دقائق لحماية البوابة.'
          : pinRecord && pinRecord.status !== 'active'
          ? `هذا الرمز تم إيقافه من قبل الإدارة. المحاولات المتبقية: ${Math.max(0, config.MAX_FAILED_ATTEMPTS - updatedRate.failed_attempts)}`
          : `رمز PIN غير صحيح. المحاولات المتبقية: ${Math.max(0, config.MAX_FAILED_ATTEMPTS - updatedRate.failed_attempts)}`,
        isLocked: updatedRate.is_locked,
        failedAttempts: updatedRate.failed_attempts,
        maxAttempts: config.MAX_FAILED_ATTEMPTS,
        lockoutUntil: updatedRate.lockout_until,
        remainingMs: updatedRate.remaining_ms,
        remainingSeconds: updatedRate.remaining_seconds
      });
    }

    // Valid PIN! Reset failed attempts for this IP
    RateLimitRepo.resetIp(ip);
    PinRepo.touchActivity(pinRecord.id);

    SecurityEventRepo.log({
      ip,
      pin_id: pinRecord.id,
      event_type: 'PIN_LOGIN_SUCCESS',
      details: `Client "${pinRecord.client_name}" authenticated with PIN ${pinRecord.pin}`
    });

    const token = createClientToken(pinRecord);
    res.cookie('gapless_client_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    const messages = MessageRepo.getByPinId(pinRecord.id, false);
    io.to('dev_monitors').emit('session:client_online', {
      pinId: pinRecord.id,
      clientName: pinRecord.client_name,
      projectName: pinRecord.project_name,
      ip
    });

    res.json({
      success: true,
      token,
      session: {
        id: pinRecord.id,
        pin: pinRecord.pin,
        clientName: pinRecord.client_name,
        projectName: pinRecord.project_name,
        projectGroup: pinRecord.project_group || pinRecord.project_name,
        participantRole: pinRecord.participant_role || 'العميل الرئيسي',
        persona: pinRecord.persona
      },
      messages
    });
  });

  /**
   * GET /api/client/session
   * Restores active client session and loads chat messages.
   */
  router.get('/session', requireClientAuth, (req, res) => {
    const pinRecord = PinRepo.getById(req.clientSession.pinId);
    if (!pinRecord || pinRecord.status !== 'active') {
      res.clearCookie('gapless_client_token');
      return res.status(401).json({ error: 'تم إنهاء الجلسة أو إلغاء رمز الدخول.' });
    }

    const messages = MessageRepo.getByPinId(pinRecord.id, false);
    res.json({
      session: {
        id: pinRecord.id,
        pin: pinRecord.pin,
        clientName: pinRecord.client_name,
        projectName: pinRecord.project_name,
        projectGroup: pinRecord.project_group || pinRecord.project_name,
        participantRole: pinRecord.participant_role || 'العميل الرئيسي',
        persona: pinRecord.persona
      },
      messages
    });
  });

  /**
   * POST /api/client/logout
   * Clears client session cookie.
   */
  router.post('/logout', (req, res) => {
    res.clearCookie('gapless_client_token');
    res.json({ success: true });
  });

  /**
   * POST /api/client/message
   * Submits a conversational message and/or uploaded wireframe/screenshot to `agy`.
   */
  router.post('/message', requireClientAuth, upload.single('media'), async (req, res) => {
    try {
      const ip = extractClientIp(req);
      const pinRecord = PinRepo.getById(req.clientSession.pinId);
      if (!pinRecord || pinRecord.status !== 'active') {
        return res.status(403).json({ error: 'رمز الجلسة غير نشط حالياً.' });
      }

      const rawText = req.body?.content || '';
      const uploadedFile = req.file || null;

      if (!rawText.trim() && !uploadedFile) {
        return res.status(400).json({ error: 'يرجى كتابة رسالة أو إرفاق صورة.' });
      }

      // 1. Strict Input Sanitization & Prompt Injection Check
      const sanitized = sanitizeClientInput(rawText || (uploadedFile ? 'أرفقت صورة لتصميم مقترح للمناقشة.' : ''));

      if (sanitized.flagged) {
        SecurityEventRepo.log({
          ip,
          pin_id: pinRecord.id,
          event_type: 'PROMPT_INJECTION_BLOCKED',
          details: `Flagged patterns [${sanitized.reasons.join(', ')}] in input: "${sanitized.cleanText.slice(0, 160)}"`
        });
        io.to('dev_monitors').emit('security:event', {
          ip,
          pinId: pinRecord.id,
          clientName: pinRecord.client_name,
          reasons: sanitized.reasons,
          text: sanitized.cleanText
        });
      }

      const mediaPath = uploadedFile ? uploadedFile.path : null;
      const mediaUrl = uploadedFile ? `/uploads/${uploadedFile.filename}` : null;

      // 2. Save client message
      const clientMsg = MessageRepo.create({
        pin_id: pinRecord.id,
        sender: 'client',
        content: sanitized.cleanText,
        media_path: mediaPath,
        media_url: mediaUrl,
        is_internal: 0,
        metadata: {
          flagged: sanitized.flagged,
          reasons: sanitized.reasons
        }
      });

      // Broadcast client message to client room & developer co-pilot monitors
      io.to(`pin:${pinRecord.id}`).emit('chat:message', clientMsg);
      io.to('dev_monitors').emit('dev:chat_message', { pinId: pinRecord.id, message: clientMsg });

      // Emit live typing indicator while `agy` processes
      io.to(`pin:${pinRecord.id}`).emit('chat:typing', { isTyping: true, sender: 'ai' });
      io.to('dev_monitors').emit('dev:typing', { pinId: pinRecord.id, isTyping: true });

      // 3. Invoke `agy` in strict sandbox mode
      const agyResult = await agyManager.runAgyTurn({
        pinId: pinRecord.id,
        userSafeWrappedPrompt: sanitized.safeWrappedText,
        mediaPath,
        isPrdGeneration: false,
        flaggedInput: sanitized.flagged,
        flagReasons: sanitized.reasons
      });

      // 4. Save AI response (including interactive quick-reply choices)
      const aiMsg = MessageRepo.create({
        pin_id: pinRecord.id,
        sender: 'ai',
        content: agyResult.response,
        is_internal: 0,
        metadata: {
          engine: agyResult.engine,
          conversationId: agyResult.conversationId,
          choices: agyResult.choices || []
        }
      });

      io.to(`pin:${pinRecord.id}`).emit('chat:typing', { isTyping: false, sender: 'ai' });
      io.to('dev_monitors').emit('dev:typing', { pinId: pinRecord.id, isTyping: false });

      io.to(`pin:${pinRecord.id}`).emit('chat:message', aiMsg);
      io.to('dev_monitors').emit('dev:chat_message', { pinId: pinRecord.id, message: aiMsg });

      res.json({
        success: true,
        clientMessage: clientMsg,
        aiMessage: aiMsg,
        securityFlagged: sanitized.flagged
      });
    } catch (err) {
      console.error('[ClientMessageRoute Error]:', err);
      res.status(500).json({ error: 'حدث خطأ أثناء معالجة الرسالة.' });
    }
  });

  return router;
};
