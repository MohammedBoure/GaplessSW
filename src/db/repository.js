/**
 * Repository Data Access Layer
 * Provides clean CRUD and domain queries for:
 * - PINs & Multi-User Linked Project Groups
 * - Messages & Interactive Choice Chips
 * - Hierarchical Project Knowledge Tree (for multi-participant shared projects)
 * - Standalone Developer AI Assistant Threads
 * - Rate Limits & Security Events
 */
const fs = require('fs');
const path = require('path');
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

/**
 * Builds a clean, natural welcome message for a participant WITHOUT exposing
 * or quoting the Admin's private `custom_instructions` to the client!
 * Also attaches initial helpful quick-choice options so the client can reply with a tap or type freely.
 */
function buildContextAwareWelcomeMessage({ clientName, projectName, participantRole, persona }) {
  const cleanClient = normalizeArabicJeem(clientName || '');
  const cleanProject = normalizeArabicJeem(projectName || '');
  const cleanRole = normalizeArabicJeem((participantRole || '').trim());

  const roleAck =
    cleanRole && cleanRole !== 'العميل الرئيسي (Project Owner)'
      ? ` بصفتك **${cleanRole}** ضمن فريق العمل`
      : '';

  if (persona === 'concise_direct') {
    return `مرحباً بك يا **${cleanClient}** في جلسة تحديد متطلبات مشروع **${cleanProject}**${roleAck}.\n\n**للبدء مباشرة:** كيف تسير طريقة العمل الحالية لديكم، وما هي أهم أولوية تريد أن يحلها النظام أولاً؟`;
  }
  if (persona === 'technical_analyst') {
    return `أهلاً بك يا **${cleanClient}** في جلسة التحليل الفني لمشروع **${cleanProject}**${roleAck}.\n\n**سؤالي الأول لضبط هيكلة النظام:** ما هي العمليات الأساسية والصلاحيات التي تتعامل معها يومياً، وما هي أبرز النقاط التقنية المطلوب تغطيتها؟`;
  }

  return `أهلاً بك يا **${cleanClient}** في جلسة استكشاف متطلبات مشروع **${cleanProject}**${roleAck}.\n\nسأعمل معك خطوة بخطوة لتفصيل كل ما تحتاجه في النظام بأسلوب واضح ومباشر (ويمكنك الاختيار من الخيارات السريعة أدناه أو الكتابة بحرية وإرفاق الصور في أي وقت).\n\n**للبدء من واقع عملك:** كيف تدار الأمور لديكم حالياً، وما هي أهم نقطة تريد أن يسهلها عليك البرنامج؟`;
}

function getDefaultWelcomeChoices() {
  return [
    'تنظيم وإدارة المخزون والمنتجات بدقة',
    'تسهيل المبيعات والفواتير وحسابات الزبائن',
    'توزيع المهام والصلاحيات بين الموظفين',
    'سأشرح لك طريقة عملنا بالتفصيل...'
  ];
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

  getByProjectGroup(projectGroup) {
    if (!projectGroup) return [];
    return db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM messages m WHERE m.pin_id = p.id AND m.is_internal = 0) AS message_count
      FROM pins p
      WHERE LOWER(TRIM(COALESCE(NULLIF(p.project_group, ''), p.project_name))) = LOWER(TRIM(?))
      ORDER BY p.created_at ASC
    `).all(projectGroup);
  },

  getAllProjectGroups() {
    const pins = this.getAll();
    const groupsMap = new Map();
    for (const p of pins) {
      const groupKey = (p.project_group || p.project_name || 'مشروع عام').trim();
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          project_group: groupKey,
          participants: []
        });
      }
      groupsMap.get(groupKey).participants.push(p);
    }
    return Array.from(groupsMap.values());
  },

  create({
    pin,
    client_name,
    project_name,
    project_group = '',
    participant_role = 'العميل الرئيسي (Project Owner)',
    custom_instructions = '',
    persona = 'adaptive_smart'
  }) {
    const id = `pin-${uuidv4().slice(0, 8)}`;
    const now = Date.now();
    const cleanClient = normalizeArabicJeem(client_name.trim());
    const cleanProject = normalizeArabicJeem(project_name.trim());
    const cleanGroup = normalizeArabicJeem((project_group || project_name).trim());
    const cleanRole = normalizeArabicJeem((participant_role || 'العميل الرئيسي (Project Owner)').trim());
    const cleanInstructions = normalizeArabicJeem(custom_instructions.trim());

    db.prepare(`
      INSERT INTO pins (
        id, pin, client_name, project_name, project_group, participant_role,
        custom_instructions, persona, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      pin,
      cleanClient,
      cleanProject,
      cleanGroup,
      cleanRole,
      cleanInstructions,
      persona,
      now,
      now
    );

    // Seed welcome message WITHOUT exposing custom_instructions to the client
    const welcomeContent = buildContextAwareWelcomeMessage({
      clientName: cleanClient,
      projectName: cleanProject,
      participantRole: cleanRole,
      persona
    });

    MessageRepo.create({
      pin_id: id,
      sender: 'ai',
      content: welcomeContent,
      is_internal: 0,
      metadata: {
        choices: getDefaultWelcomeChoices()
      }
    });

    const created = this.getById(id);
    ProjectTreeRepo.syncProjectTree(cleanGroup);
    return created;
  },

  update(id, { client_name, project_name, project_group, participant_role, custom_instructions, persona, status, pin }) {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = Date.now();
    const updatedClient = client_name !== undefined ? normalizeArabicJeem(client_name.trim()) : existing.client_name;
    const updatedProject = project_name !== undefined ? normalizeArabicJeem(project_name.trim()) : existing.project_name;
    const updatedGroup =
      project_group !== undefined
        ? normalizeArabicJeem((project_group.trim() || updatedProject))
        : (existing.project_group || updatedProject);
    const updatedRole =
      participant_role !== undefined
        ? normalizeArabicJeem(participant_role.trim())
        : (existing.participant_role || 'العميل الرئيسي (Project Owner)');
    const updatedInstructions = custom_instructions !== undefined ? normalizeArabicJeem(custom_instructions.trim()) : existing.custom_instructions;
    const updatedPersona = persona !== undefined ? persona : existing.persona;
    const updatedStatus = status !== undefined ? status : existing.status;
    const updatedPin = pin !== undefined ? pin : existing.pin;

    db.prepare(`
      UPDATE pins
      SET pin = ?, client_name = ?, project_name = ?, project_group = ?, participant_role = ?,
          custom_instructions = ?, persona = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updatedPin,
      updatedClient,
      updatedProject,
      updatedGroup,
      updatedRole,
      updatedInstructions,
      updatedPersona,
      updatedStatus,
      now,
      id
    );

    // If the session only has the initial welcome message, refresh it cleanly (never exposing custom_instructions)
    const msgs = MessageRepo.getByPinId(id, false);
    if (msgs.length === 1 && msgs[0].sender === 'ai') {
      const updatedWelcome = buildContextAwareWelcomeMessage({
        clientName: updatedClient,
        projectName: updatedProject,
        participantRole: updatedRole,
        persona: updatedPersona
      });
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(updatedWelcome, msgs[0].id);
    }

    const updated = this.getById(id);
    ProjectTreeRepo.syncProjectTree(updatedGroup);
    return updated;
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
    const updated = this.getById(id);
    if (updated) {
      ProjectTreeRepo.syncProjectTree(updated.project_group || updated.project_name);
    }
    return updated;
  },

  touchActivity(id) {
    const now = Date.now();
    db.prepare('UPDATE pins SET last_active_at = ? WHERE id = ?').run(now, id);
  },

  delete(id) {
    const existing = this.getById(id);
    const res = db.prepare('DELETE FROM pins WHERE id = ?').run(id);
    if (existing) {
      ProjectTreeRepo.syncProjectTree(existing.project_group || existing.project_name);
    }
    return res;
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

    const pinRecord = PinRepo.getById(pin_id);
    if (pinRecord) {
      ProjectTreeRepo.syncProjectTree(pinRecord.project_group || pinRecord.project_name);
    }

    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  },

  clearHistory(pinId) {
    db.prepare('DELETE FROM messages WHERE pin_id = ?').run(pinId);
    db.prepare('UPDATE pins SET conversation_id = NULL WHERE id = ?').run(pinId);
  }
};

/**
 * Hierarchical Project Tree Builder & Sync Engine (`ProjectTreeRepo`)
 * Organizes multi-participant sessions belonging to the same project into a structured
 * hierarchical tree both in-memory/API and on disk inside `sandbox_env/projects_tree/<slug>/`
 * so `agy` can read and navigate even large volumes of multi-user conversations effortlessly.
 */
const ProjectTreeRepo = {
  slugify(name) {
    return Buffer.from(String(name || 'default').trim().toLowerCase()).toString('hex').slice(0, 24) || 'project';
  },

  buildProjectTreeData(projectGroup) {
    const participants = PinRepo.getByProjectGroup(projectGroup);
    const nodes = participants.map((p) => {
      const allMsgs = MessageRepo.getByPinId(p.id, true);
      const clientMsgs = allMsgs.filter((m) => m.sender === 'client');
      const aiMsgs = allMsgs.filter((m) => m.sender === 'ai');
      const devNotes = allMsgs.filter((m) => m.sender === 'dev_note');

      // Extract concise key statements from this participant for fast tree indexing
      const keyClientInputs = clientMsgs.map((m) => ({
        id: m.id,
        content: m.content,
        media_url: m.media_url,
        created_at: m.created_at
      }));

      return {
        pin_id: p.id,
        pin: p.pin,
        client_name: p.client_name,
        participant_role: p.participant_role || 'العميل الرئيسي',
        persona: p.persona,
        status: p.status,
        custom_instructions_internal: p.custom_instructions || '',
        stats: {
          total_messages: allMsgs.filter((m) => !m.is_internal).length,
          client_responses: clientMsgs.length,
          ai_questions: aiMsgs.length,
          secret_dev_notes: devNotes.length
        },
        key_client_inputs: keyClientInputs,
        dev_notes: devNotes.map((d) => ({ id: d.id, content: d.content, created_at: d.created_at })),
        recent_transcript: allMsgs
          .filter((m) => !m.is_internal)
          .slice(-10)
          .map((m) => ({
            sender: m.sender,
            content: m.content,
            created_at: m.created_at
          }))
      };
    });

    return {
      project_group: projectGroup,
      total_participants: nodes.length,
      updated_at: Date.now(),
      participants_tree: nodes
    };
  },

  syncProjectTree(projectGroup) {
    if (!projectGroup) return null;
    try {
      const treeData = this.buildProjectTreeData(projectGroup);
      const slug = this.slugify(projectGroup);
      const dir = path.join(config.PROJECT_TREES_DIR, slug);
      fs.mkdirSync(dir, { recursive: true });

      const participantsDir = path.join(dir, 'participants');
      fs.mkdirSync(participantsDir, { recursive: true });

      // 1. Write structured JSON tree
      const treeJsonPath = path.join(dir, 'project_tree.json');
      fs.writeFileSync(treeJsonPath, JSON.stringify(treeData, null, 2));

      // 2. Write each participant's full Markdown file for deep on-demand reading by `agy`
      const indexLines = [
        `# الفهرس الشجري الشامل للمشروع: ${projectGroup}`,
        `عدد المشاركين المتصلين بالمشروع: ${treeData.total_participants}`,
        `آخر تحديث: ${new Date(treeData.updated_at).toISOString()}`,
        ``,
        `## هيكل المشاركين وجلساتهم المتصلة (Tree Nodes):`
      ];

      for (const node of treeData.participants_tree) {
        const partFile = path.join(participantsDir, `pin_${node.pin}.md`);
        const fullMsgs = MessageRepo.getByPinId(node.pin_id, false);
        const transcriptMd = fullMsgs
          .map((m) => `- **[${m.sender === 'client' ? node.client_name : 'ScopeMaster AI'}]:** ${m.content}`)
          .join('\n');

        const partMd = [
          `# جلسة المشارك: ${node.client_name} (الدور: ${node.participant_role})`,
          `- **رمز الجلسة (PIN):** ${node.pin}`,
          `- **المعلومات الخلفية السرية للمشارك (مخفية عن المشارك):** ${node.custom_instructions_internal || 'لا يوجد'}`,
          `- **عدد مداخلات المشارك:** ${node.stats.client_responses}`,
          ``,
          `## ملخص إجابات ومدخلات هذا المشارك:`,
          node.key_client_inputs.length > 0
            ? node.key_client_inputs.map((k, idx) => `${idx + 1}. ${k.content}`).join('\n')
            : '- لم يدخل إجابات بعد.',
          ``,
          `## السجل الكامل للمحادثة:`,
          transcriptMd || '- لا توجد رسائل.'
        ].join('\n');

        fs.writeFileSync(partFile, partMd);

        indexLines.push(`### 👤 [${node.client_name}] — الدور: (${node.participant_role}) | PIN: #${node.pin}`);
        indexLines.push(`- **ملف السجل الكامل للقراءة (\`read_file\`):** \`${partFile}\``);
        indexLines.push(`- **معلومات خلفية سرية عن المشارك:** ${node.custom_instructions_internal || 'لا يوجد'}`);
        indexLines.push(`- **أبرز ما ذكره هذا المشارك (${node.stats.client_responses} مداخلات):**`);
        if (node.key_client_inputs.length === 0) {
          indexLines.push(`  * (لم يشارك بإجابات بعد)`);
        } else {
          for (const k of node.key_client_inputs.slice(-6)) {
            indexLines.push(`  * "${k.content.replace(/\n+/g, ' ')}"`);
          }
        }
        indexLines.push('');
      }

      const indexMdPath = path.join(dir, 'INDEX.md');
      fs.writeFileSync(indexMdPath, indexLines.join('\n'));

      return {
        treeData,
        indexMdPath,
        treeJsonPath
      };
    } catch (err) {
      console.error('[ProjectTreeRepo] Error syncing project tree:', err.message);
      return null;
    }
  }
};

/**
 * Standalone Developer AI Consultant Threads (`DevAiRepo`)
 * Enables the developer to chat directly with `agy` in a dedicated private thread
 * at any moment (optionally linked to a project tree or completely general).
 */
const DevAiRepo = {
  getAllThreads() {
    return db.prepare(`
      SELECT t.*,
        (SELECT COUNT(*) FROM dev_ai_messages m WHERE m.thread_id = t.id) AS message_count
      FROM dev_ai_threads t
      ORDER BY t.updated_at DESC
    `).all();
  },

  getThreadById(id) {
    return db.prepare('SELECT * FROM dev_ai_threads WHERE id = ?').get(id);
  },

  createThread({ title, project_group = null }) {
    const id = `devthread-${uuidv4().slice(0, 8)}`;
    const now = Date.now();
    const cleanTitle = normalizeArabicJeem((title || 'استشارة تقنية جديدة').trim());
    const cleanGroup = project_group ? normalizeArabicJeem(project_group.trim()) : null;

    db.prepare(`
      INSERT INTO dev_ai_threads (id, title, project_group, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, cleanTitle, cleanGroup, now, now);

    // Seed welcome message for developer
    this.addMessage({
      thread_id: id,
      sender: 'ai',
      content: cleanGroup
        ? `مرحباً بك في **مساعد المطورين الخاص (Developer AI Workbench)**! 🧠\nهذه المحادثة مرتبطة بشجرة بيانات المشروع المشترك **(${cleanGroup})**.\n\nيمكنك سؤالي عن أي تفاصيل، تحليل التناقضات بين إجابات المستخدمين المتعددين، اقتراح هيكلة قاعدة البيانات (Database Schema)، أو صياغة أسئلة مخصصة لأحد المشاركين.`
        : `مرحباً بك في **مساعد المطورين المستقل (Standalone Developer AI)**! 🧠\nهذه مساحة حرة ومنفصلة تماماً عن محادثات العملاء. يمكنك مناقشة أي فكرة برمجية، تحليل معماري، أو استفسار تقني معي في أي لحظة.`
    });

    return this.getThreadById(id);
  },

  updateConversationId(id, conversationId) {
    const now = Date.now();
    db.prepare('UPDATE dev_ai_threads SET conversation_id = ?, updated_at = ? WHERE id = ?').run(conversationId, now, id);
  },

  deleteThread(id) {
    return db.prepare('DELETE FROM dev_ai_threads WHERE id = ?').run(id);
  },

  getMessages(threadId) {
    return db.prepare('SELECT * FROM dev_ai_messages WHERE thread_id = ? ORDER BY created_at ASC').all(threadId);
  },

  addMessage({ thread_id, sender, content, metadata = {} }) {
    const id = `devmsg-${uuidv4()}`;
    const now = Date.now();
    const cleanContent = normalizeArabicJeem(content);
    db.prepare(`
      INSERT INTO dev_ai_messages (id, thread_id, sender, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, thread_id, sender, cleanContent, JSON.stringify(metadata || {}), now);
    db.prepare('UPDATE dev_ai_threads SET updated_at = ? WHERE id = ?').run(now, thread_id);
    return db.prepare('SELECT * FROM dev_ai_messages WHERE id = ?').get(id);
  }
};

const RateLimitRepo = {
  getByIp(ip) {
    const row = db.prepare('SELECT * FROM rate_limits WHERE ip = ?').get(ip);
    if (!row) {
      return { ip, failed_attempts: 0, lockout_until: 0, last_attempt_at: 0, is_locked: false, remaining_ms: 0 };
    }
    const now = Date.now();
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
  ProjectTreeRepo,
  DevAiRepo,
  RateLimitRepo,
  SecurityEventRepo,
  normalizeArabicJeem,
  buildContextAwareWelcomeMessage,
  getDefaultWelcomeChoices
};
