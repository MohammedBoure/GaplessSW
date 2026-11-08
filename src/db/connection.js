/**
 * Database Connection & Schema Initialization
 * Uses better-sqlite3 with WAL mode for concurrent read/write performance.
 */
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

if (!fs.existsSync(config.DATA_DIR)) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
}

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize schema and seed default sample PINs if the database is empty.
 */
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pins (
      id TEXT PRIMARY KEY,
      pin TEXT UNIQUE NOT NULL,
      client_name TEXT NOT NULL,
      project_name TEXT NOT NULL,
      custom_instructions TEXT DEFAULT '',
      persona TEXT DEFAULT 'friendly_consultant',
      status TEXT DEFAULT 'active',
      conversation_id TEXT DEFAULT NULL,
      prd_markdown TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_active_at INTEGER DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      pin_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      media_path TEXT DEFAULT NULL,
      media_url TEXT DEFAULT NULL,
      is_internal INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (pin_id) REFERENCES pins(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      ip TEXT PRIMARY KEY,
      failed_attempts INTEGER DEFAULT 0,
      lockout_until INTEGER DEFAULT 0,
      last_attempt_at INTEGER DEFAULT 0,
      user_agent TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL,
      pin_id TEXT DEFAULT NULL,
      event_type TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Seed default sample PINs so the system is immediately testable out-of-the-box
  const countRow = db.prepare('SELECT COUNT(*) as count FROM pins').get();
  if (countRow.count === 0) {
    const now = Date.now();
    const insertPin = db.prepare(`
      INSERT INTO pins (id, pin, client_name, project_name, custom_instructions, persona, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `);

    insertPin.run(
      'pin-sami-delivery',
      '4829',
      'سامي (Sami)',
      'تطبيق توصيل سريع (Delivery App)',
      'Client is non-technical, focus on budget, ask about local payment methods in Algeria (BaridiMob, CIB, Edahabia, Cash on Delivery), emphasize delivery logistics and driver tracking.',
      'friendly_consultant',
      now,
      now
    );

    insertPin.run(
      'pin-nadia-clinic',
      '1945',
      'د. نادية (Dr. Nadia)',
      'منصة حجز العيادات الطبية (MedBook)',
      'Client is a clinic director. Focus on patient privacy, appointment reminders via SMS/WhatsApp, doctor shift scheduling, and MVP scope limits.',
      'concise_direct',
      now,
      now
    );

    insertPin.run(
      'pin-karim-fintech',
      '7731',
      'كريم (Karim)',
      'بوابة الفوترة الإلكترونية (B2B SaaS)',
      'Client has technical background. Focus on multi-tenant roles, ERP API integrations, tax compliance, and high-concurrency edge cases.',
      'technical_analyst',
      now,
      now
    );

    // Add initial welcome message for each seeded PIN
    const insertMsg = db.prepare(`
      INSERT INTO messages (id, pin_id, sender, content, is_internal, created_at)
      VALUES (?, ?, 'ai', ?, 0, ?)
    `);

    insertMsg.run(
      'msg-welcome-sami',
      'pin-sami-delivery',
      'أهلاً بك يا **سامي** في جلسة استكشاف متطلبات مشروع **تطبيق توصيل سريع (Delivery App)**! 🚀\n\nأنا مستشار تحليل الأعمال الخاص بك في **Gapless**. سأساعدك خطوة بخطوة لتحويل فكرتك إلى وثيقة متطلبات تقنية دقيقة ومتكاملة.\n\nيمكنك التحدث معي بحرية أو إرفاق صور، رسومات يدوية (Sketches)، أو لقطات شاشة لتطبيقات مشابهة.\n\n**للبدء:** ما هي الفئة المستهدفة الأساسية للتطبيق (مطاعم، متاجر بقالة، أم طرود عامة)، وفي أي المدن تخطط للإطلاق أولاً؟',
      now
    );

    insertMsg.run(
      'msg-welcome-nadia',
      'pin-nadia-clinic',
      'مرحباً بكِ **د. نادية** في بوابة **Gapless** لتخطيط مشروع **منصة حجز العيادات الطبية (MedBook)**! 🩺\n\nمهمتي هي مساعدتكِ في تحديد كافة التفاصيل الوظيفية والأمنية للمنصة قبل البدء بالتطوير.\n\n**سؤالي الأول:** هل المنصة مخصصة لعيادة واحدة بعدة أطباء، أم أنها سوق مفتوح (Marketplace) يضم عيادات ومراكز طبية متعددة؟',
      now
    );

    insertMsg.run(
      'msg-welcome-karim',
      'pin-karim-fintech',
      'أهلاً بك يا **كريم** في **Gapless** لاستكشاف متطلبات **بوابة الفوترة الإلكترونية (B2B SaaS)**! 📊\n\nسنتعاون معاً لتحديد المعمارية الوظيفية، الصلاحيات، والتكاملات المطلوبة للنسخة الأولية (MVP).\n\n**للانطلاق:** ما هي الأنظمة المحاسبية أو أنظمة الـ ERP التي يحتاج عملاؤك للربط معها في المرحلة الأولى؟',
      now
    );
  }
}

initializeDatabase();

module.exports = db;
