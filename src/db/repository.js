/**
 * Repository Data Access Layer
 * Provides clean CRUD and domain queries for PINs, Messages, Rate Limits, and Security Events.
 */
const { v4: uuidv4 } = require('uuid');
const db = require('./connection');
const config = require('../config');

/**
 * Normalize Arabic character '٩' (U+0669) to 'ج' (jeem) in any text per system rules,
 * UNLESS the string is strictly a numeric PIN.
 */
function normalizeArabicJeem(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\u0669/g, 'ج');
}

const PinRepo = {
  getAll() {
    return db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM messages m WHERE m.pin_id = p.id AND m.is_internal = 0) AS message_count,
        (SELECT COUNT(*) FROM messages m WHERE m.pin_id = p.id AND m.sender = 'dev_note') AS dev_note_count
      FROM pins p
      ORDER BY p.created_at DESC
    `).all();
  },

  getById(id) {
    return db.prepare('SELECT * FROM pins WHERE id = ?').get(id);
  },

  getByPinCode(pinCode) {
    return db.prepare('SELECT * FROM pins WHERE pin = ?').get(pinCode);
  },

  create({ pin, client_name, project_name, custom_instructions = '', persona = 'friendly_consultant' }) {
    const id = `pin-${uuidv4().slice(0, 8)}`;
    const now = Date.now();
    const cleanClient = normalizeArabicJeem(client_name.trim());
    const cleanProject = normalizeArabicJeem(project_name.trim());
    const cleanInstructions = normalizeArabicJeem(custom_instructions.trim());

    db.prepare(`
      INSERT INTO pins (id, pin, client_name, project_name, custom_instructions, persona, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, pin, cleanClient, cleanProject, cleanInstructions, persona, now, now);

    // Seed welcome message for this PIN
    const welcomeContent = `أهلاً بك يا **${cleanClient}** في جلسة استكشاف متطلبات مشروع **${cleanProject}**! 🚀\n\nأنا مستشار تحليل الأعمال الذكي في **Gapless**. سأساعدك خطوة بخطوة لاكتشاف كافة التفاصيل والزوايا المخفية لمشروعك.\n\nيمكنك التحدث معي أو إرفاق صور ورسومات تخطيطية (Wireframes / Sketches) لمناقشتها.\n\n**للبدء:** هل يمكنك إعطائي فكرة موجزة عن الهدف الرئيسي للمشروع ومن هم المستخدمون الأساسيون؟`;

    MessageRepo.create({
      pin_id: id,
      sender: 'ai',
      content: welcomeContent,
      is_internal: 0
    });

    return this.getById(id);
  },

  update(id, { client_name, project_name, custom_instructions, persona, status, pin }) {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = Date.now();
    const updatedClient = client_name !== undefined ? normalizeArabicJeem(client_name.trim()) : existing.client_name;
    const updatedProject = project_name !== undefined ? normalizeArabicJeem(project_name.trim()) : existing.project_name;
    const updatedInstructions = custom_instructions !== undefined ? normalizeArabicJeem(custom_instructions.trim()) : existing.custom_instructions;
    const updatedPersona = persona !== undefined ? persona : existing.persona;
    const updatedStatus = status !== undefined ? status : existing.status;
    const updatedPin = pin !== undefined ? pin : existing.pin;

    db.prepare(`
      UPDATE pins
      SET pin = ?, client_name = ?, project_name = ?, custom_instructions = ?, persona = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(updatedPin, updatedClient, updatedProject, updatedInstructions, updatedPersona, updatedStatus, now, id);

    return this.getById(id);
  },

  updateConversationId(id, conversationId) {
    const now = Date.now();
    db.prepare(`
      UPDATE pins SET conversation_id = ?, last_active_at = ?, updated_at = ? WHERE id = ?
    `).run(conversationId, now, now, id);
  },

  updatePrd(id, prdMarkdown) {
    const now = Date.now();
    const cleanPrd = normalizeArabicJeem(prdMarkdown);
    db.prepare(`
      UPDATE pins SET prd_markdown = ?, updated_at = ? WHERE id = ?
    `).run(cleanPrd, now, id);
    return this.getById(id);
  },

  touchActivity(id) {
    const now = Date.now();
    db.prepare('UPDATE pins SET last_active_at = ? WHERE id = ?').run(now, id);
  },

  delete(id) {
    return db.prepare('DELETE FROM pins WHERE id = ?').run(id);
  }
};

const MessageRepo = {
  getByPinId(pinId, includeInternal = false) {
    if (includeInternal) {
      return db.prepare('SELECT * FROM messages WHERE pin_id = ? ORDER BY created_at ASC').all(pinId);
    }
    return db.prepare('SELECT * FROM messages WHERE pin_id = ? AND is_internal = 0 ORDER BY created_at ASC').all(pinId);
  },

  getPendingDevNotes(pinId) {
    // Get dev notes created since the last AI response
    const lastAiMsg = db.prepare(`
      SELECT created_at FROM messages
      WHERE pin_id = ? AND sender = 'ai'
      ORDER BY created_at DESC LIMIT 1
    `).get(pinId);

    const since = lastAiMsg ? lastAiMsg.created_at : 0;
    return db.prepare(`
      SELECT * FROM messages
      WHERE pin_id = ? AND sender = 'dev_note' AND created_at > ?
      ORDER BY created_at ASC
    `).all(pinId, since);
  },

  getAllDevNotes(pinId) {
    return db.prepare(`
      SELECT * FROM messages
      WHERE pin_id = ? AND sender = 'dev_note'
      ORDER BY created_at ASC
    `).all(pinId);
  },

  create({ pin_id, sender, content, media_path = null, media_url = null, is_internal = 0, metadata = {} }) {
    const id = `msg-${uuidv4()}`;
    const now = Date.now();
    const cleanContent = normalizeArabicJeem(content);
    db.prepare(`
      INSERT INTO messages (id, pin_id, sender, content, media_path, media_url, is_internal, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      pin_id,
      sender,
      cleanContent,
      media_path,
      media_url,
      is_internal ? 1 : 0,
      JSON.stringify(metadata || {}),
      now
    );
    PinRepo.touchActivity(pin_id);
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  },

  clearHistory(pinId) {
    db.prepare('DELETE FROM messages WHERE pin_id = ?').run(pinId);
    db.prepare('UPDATE pins SET conversation_id = NULL WHERE id = ?').run(pinId);
  }
};

const RateLimitRepo = {
  getByIp(ip) {
    const row = db.prepare('SELECT * FROM rate_limits WHERE ip = ?').get(ip);
    if (!row) {
      return { ip, failed_attempts: 0, lockout_until: 0, last_attempt_at: 0, is_locked: false, remaining_ms: 0 };
    }
    const now = Date.now();
    // If lockout expired, reset failed_attempts automatically
    if (row.lockout_until > 0 && now >= row.lockout_until) {
      this.resetIp(ip);
      return { ip, failed_attempts: 0, lockout_until: 0, last_attempt_at: row.last_attempt_at, is_locked: false, remaining_ms: 0 };
    }
    const isLocked = row.lockout_until > now;
    const remainingMs = isLocked ? row.lockout_until - now : 0;
    return {
      ...row,
      is_locked: isLocked,
      remaining_ms: remainingMs,
      remaining_seconds: Math.ceil(remainingMs / 1000)
    };
  },

  recordFailedAttempt(ip, userAgent = '') {
    const current = this.getByIp(ip);
    if (current.is_locked) {
      return current;
    }

    const now = Date.now();
    const attempts = (current.failed_attempts || 0) + 1;
    let lockoutUntil = 0;

    if (attempts >= config.MAX_FAILED_ATTEMPTS) {
      lockoutUntil = now + config.LOCKOUT_DURATION_MS;
    }

    db.prepare(`
      INSERT INTO rate_limits (ip, failed_attempts, lockout_until, last_attempt_at, user_agent)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        failed_attempts = excluded.failed_attempts,
        lockout_until = excluded.lockout_until,
        last_attempt_at = excluded.last_attempt_at,
        user_agent = excluded.user_agent
    `).run(ip, attempts, lockoutUntil, now, String(userAgent).slice(0, 255));

    return this.getByIp(ip);
  },

  resetIp(ip) {
    db.prepare('DELETE FROM rate_limits WHERE ip = ?').run(ip);
  },

  lockIpManually(ip, durationMs = config.LOCKOUT_DURATION_MS) {
    const now = Date.now();
    const lockoutUntil = now + durationMs;
    db.prepare(`
      INSERT INTO rate_limits (ip, failed_attempts, lockout_until, last_attempt_at, user_agent)
      VALUES (?, ?, ?, ?, 'Manual Admin Lock')
      ON CONFLICT(ip) DO UPDATE SET
        failed_attempts = excluded.failed_attempts,
        lockout_until = excluded.lockout_until,
        last_attempt_at = excluded.last_attempt_at
    `).run(ip, config.MAX_FAILED_ATTEMPTS, lockoutUntil, now);
    return this.getByIp(ip);
  },

  getAllTracked() {
    const rows = db.prepare('SELECT * FROM rate_limits ORDER BY last_attempt_at DESC').all();
    const now = Date.now();
    return rows.map((row) => {
      const isLocked = row.lockout_until > now;
      const remainingMs = isLocked ? row.lockout_until - now : 0;
      return {
        ...row,
        is_locked: isLocked,
        remaining_ms: remainingMs,
        remaining_seconds: Math.ceil(remainingMs / 1000)
      };
    });
  }
};

const SecurityEventRepo = {
  log({ ip, pin_id = null, event_type, details }) {
    const id = `sec-${uuidv4()}`;
    const now = Date.now();
    db.prepare(`
      INSERT INTO security_events (id, ip, pin_id, event_type, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, ip || 'unknown', pin_id, event_type, normalizeArabicJeem(String(details)), now);
    return { id, ip, pin_id, event_type, details, created_at: now };
  },

  getRecent(limit = 50) {
    return db.prepare(`
      SELECT s.*, p.client_name, p.project_name, p.pin
      FROM security_events s
      LEFT JOIN pins p ON s.pin_id = p.id
      ORDER BY s.created_at DESC
      LIMIT ?
    `).all(limit);
  }
};

module.exports = {
  PinRepo,
  MessageRepo,
  RateLimitRepo,
  SecurityEventRepo,
  normalizeArabicJeem
};
