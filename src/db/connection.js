/**
 * Database Connection & Schema Initialization
 * Uses better-sqlite3 with WAL mode for concurrent read/write performance.
 * Supports:
 * - Multi-user linked project sessions (`project_group`, `participant_role`)
 * - Hidden initial background context (`custom_instructions` never echoed into visible welcome messages)
 * - Standalone Developer AI Assistant threads (`dev_ai_threads`, `dev_ai_messages`)
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

function ensureColumnExists(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Initialize schema, run non-destructive migrations, and seed default sample PINs if empty.
 */
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pins (
      id TEXT PRIMARY KEY,
      pin TEXT UNIQUE NOT NULL,
      client_name TEXT NOT NULL,
      project_name TEXT NOT NULL,
      project_group TEXT DEFAULT '',
      participant_role TEXT DEFAULT 'العميل الرئيسي (Project Owner)',
      custom_instructions TEXT DEFAULT '',
      persona TEXT DEFAULT 'adaptive_smart',
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

    CREATE TABLE IF NOT EXISTS dev_ai_threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      project_group TEXT DEFAULT NULL,
      conversation_id TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dev_ai_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES dev_ai_threads(id) ON DELETE CASCADE
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

  // Safe migrations for existing databases
  ensureColumnExists('pins', 'project_group', "TEXT DEFAULT ''");
  ensureColumnExists('pins', 'participant_role', "TEXT DEFAULT 'العميل الرئيسي (Project Owner)'");

  // Backfill project_group if empty
  db.exec(`UPDATE pins SET project_group = project_name WHERE project_group IS NULL OR project_group = ''`);

  // Seed default sample PINs if the database is empty
  const countRow = db.prepare('SELECT COUNT(*) as count FROM pins').get();
  if (countRow.count === 0) {
    const now = Date.now();
    const insertPin = db.prepare(`
      INSERT INTO pins (id, pin, client_name, project_name, project_group, participant_role, custom_instructions, persona, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `);

    insertPin.run(
      'pin-sami-delivery',
      '4829',
      'سامي (Sami)',
      'تطبيق توصيل سريع (Delivery App)',
      'تطبيق توصيل سريع (Delivery App)',
      'المدير العام وصاحب المشروع',
      'Client is non-technical, focus on budget, ask about local payment methods in Algeria (BaridiMob, CIB, Edahabia, Cash on Delivery), emphasize delivery logistics and driver tracking.',
      'adaptive_smart',
      now,
      now
    );

    insertPin.run(
      'pin-nadia-clinic',
      '1945',
      'د. نادية (Dr. Nadia)',
      'منصة حجز العيادات الطبية (MedBook)',
      'منصة حجز العيادات الطبية (MedBook)',
      'مديرة العيادة الطبية',
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
      'بوابة الفوترة الإلكترونية (B2B SaaS)',
      'المدير التقني (CTO)',
      'Client has technical background. Focus on multi-tenant roles, ERP API integrations, tax compliance, and high-concurrency edge cases.',
      'technical_analyst',
      now,
      now
    );

    // Add initial welcome message for each seeded PIN (without leaking private custom_instructions)
    const insertMsg = db.prepare(`
      INSERT INTO messages (id, pin_id, sender, content, is_internal, metadata, created_at)
      VALUES (?, ?, 'ai', ?, 0, ?, ?)
    `);

    insertMsg.run(
      'msg-welcome-sami',
      'pin-sami-delivery',
      'أهلاً بك يا **سامي** في جلسة تخطيط مشروع **تطبيق توصيل سريع (Delivery App)**.\n\nسأعمل معك خطوة بخطوة لتحديد كافة المتطلبات والتفاصيل العملية بدقة. للبدء، ما هي الفئة الرئيسية التي سيخدمها التطبيق في المرحلة الأولى؟',
      JSON.stringify({
        choices: ['توصيل الطلبات والمطاعم', 'توصيل الطرود والشحنات', 'توصيل مقاضي ومتاجر متعددة', 'خدمة توصيل مخصصة لشركتنا فقط']
      }),
      now
    );

    insertMsg.run(
      'msg-welcome-nadia',
      'pin-nadia-clinic',
      'مرحباً بكِ **د. نادية** في جلسة تخطيط مشروع **منصة حجز العيادات الطبية (MedBook)**.\n\nللبدء مباشرة، كيف تتصورين هيكلية المنصة في الإطلاق الأول؟',
      JSON.stringify({
        choices: ['منصة خاصة بعيادة واحدة بعدة أطباء', 'مجمع طبي متكامل بعدة أقسام', 'منصة مفتوحة لاشتراك عيادات خارجية']
      }),
      now
    );

    insertMsg.run(
      'msg-welcome-karim',
      'pin-karim-fintech',
      'أهلاً بك يا **كريم** في جلسة التحليل التقني لمشروع **بوابة الفوترة الإلكترونية (B2B SaaS)**.\n\nما هي أولوية التكامل الأساسية في النسخة الأولية (MVP)؟',
      JSON.stringify({
        choices: ['إصدار الفواتير وإدارة الضرائب محلياً', 'الربط عبر API مع أنظمة ERP المحاسبية', 'بوابة دفع وتحصيل آلي للشركات']
      }),
      now
    );
  }
}

initializeDatabase();

module.exports = db;
