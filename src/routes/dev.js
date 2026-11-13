/**
 * Developer Co-Pilot Mode (/dev) API Routes
 * Handles:
 * - Real-time session inspection (including internal dev notes, metadata, and project groups)
 * - Hierarchical Project Knowledge Tree inspection (`/api/dev/projects-tree`)
 * - Standalone Developer AI Consultant Chat (`/api/dev/ai-threads` & `/api/dev/ai-threads/:threadId/message`)
 * - Ghost Mode: Send messages directly into the client's chat appearing as the AI (with optional Choice Chips)
 * - Secret Notes: Inject `[DEV_NOTE: ...]` prompts into `agy` to guide its questions without the client seeing the note
 * - One-Click PRD: Prompt `agy` with `[GENERATE_PRD]` to compile a full, structured Product Requirements Document
 */
const express = require('express');
const {
  PinRepo,
  MessageRepo,
  ProjectTreeRepo,
  DevAiRepo,
  normalizeArabicJeem
} = require('../db/repository');
const { requireAdminAuth } = require('../security/auth');
const { sanitizeDevNote } = require('../security/sanitizer');
const agyManager = require('../services/agyManager');

module.exports = function createDevRouter(io) {
  const router = express.Router();

  /**
   * GET /api/dev/sessions
   * Lists all client sessions, grouped projects, and engine status.
   */
  router.get('/sessions', requireAdminAuth, (_req, res) => {
    const pins = PinRepo.getAll();
    const projectGroups = PinRepo.getAllProjectGroups();
    res.json({
      sessions: pins,
      projectGroups,
      engineStatus: agyManager.getStatus()
    });
  });

  /**
   * GET /api/dev/projects-tree
   * Returns the hierarchical project knowledge tree for a specific project_group (or all project groups).
   */
  router.get('/projects-tree', requireAdminAuth, (req, res) => {
    const groupName = req.query.project_group;
    if (groupName) {
      const tree = ProjectTreeRepo.buildProjectTreeData(String(groupName));
      return res.json({ tree });
    }
    const allGroups = PinRepo.getAllProjectGroups();
    const trees = allGroups.map((g) => ProjectTreeRepo.buildProjectTreeData(g.project_group));
    res.json({ trees });
  });

  /**
   * GET /api/dev/sessions/:pinId
   * Returns full session details including internal `[DEV_NOTE: ...]` items, linked project tree, and any generated PRD.
   */
  router.get('/sessions/:pinId', requireAdminAuth, (req, res) => {
    const { pinId } = req.params;
    const pinRecord = PinRepo.getById(pinId);
    if (!pinRecord) {
      return res.status(404).json({ error: 'جلسة العميل غير موجودة.' });
    }

    const messages = MessageRepo.getByPinId(pinId, true); // includeInternal = true
    const projectGroup = pinRecord.project_group || pinRecord.project_name;
    const projectTree = ProjectTreeRepo.buildProjectTreeData(projectGroup);

    res.json({
      session: pinRecord,
      messages,
      projectTree
    });
  });

  /**
   * POST /api/dev/sessions/:pinId/ghost
   * Ghost Mode: Sends a message directly into the client's chat appearing seamlessly as the AI.
   * Supports optional `choices` array so the developer can also attach interactive quick-reply buttons!
   */
  router.post('/sessions/:pinId/ghost', requireAdminAuth, (req, res) => {
    const { pinId } = req.params;
    const { content, choices } = req.body || {};

    const pinRecord = PinRepo.getById(pinId);
    if (!pinRecord) {
      return res.status(404).json({ error: 'جلسة العميل غير موجودة.' });
    }

    const cleanContent = normalizeArabicJeem(String(content || '').trim());
    if (!cleanContent) {
      return res.status(400).json({ error: 'محتوى رسالة Ghost Mode مطلوب.' });
    }

    // Parse choices if passed as array or pipe-separated string or [CHOICES: ...] inside text
    let parsedChoices = [];
    if (Array.isArray(choices)) {
      parsedChoices = choices.map((c) => normalizeArabicJeem(String(c).trim())).filter(Boolean);
    } else if (typeof choices === 'string' && choices.trim()) {
      parsedChoices = choices
        .split('|')
        .map((c) => normalizeArabicJeem(c.trim()))
        .filter(Boolean);
    }

    const ghostMsg = MessageRepo.create({
      pin_id: pinId,
      sender: 'ai',
      content: cleanContent,
      is_internal: 0,
      metadata: {
        ghostMode: true,
        author: req.admin?.username || 'developer',
        choices: parsedChoices
      }
    });

    io.to(`pin:${pinId}`).emit('chat:message', ghostMsg);
    io.to('dev_monitors').emit('dev:chat_message', { pinId, message: ghostMsg });

    res.json({
      success: true,
      message: ghostMsg
    });
  });

  /**
   * POST /api/dev/sessions/:pinId/note
   * Secret Notes: Injects `[DEV_NOTE: ...]` into the session without the client seeing it.
   * If `triggerAiNow` is true, immediately invokes `agy` so it asks the client a guided follow-up question right away.
   */
  router.post('/sessions/:pinId/note', requireAdminAuth, async (req, res) => {
    try {
      const { pinId } = req.params;
      const { note, triggerAiNow = false } = req.body || {};

      const pinRecord = PinRepo.getById(pinId);
      if (!pinRecord) {
        return res.status(404).json({ error: 'جلسة العميل غير موجودة.' });
      }

      const cleanNote = sanitizeDevNote(note || '');
      if (!cleanNote) {
        return res.status(400).json({ error: 'محتوى الملاحظة السرية مطلوب.' });
      }

      const noteMsg = MessageRepo.create({
        pin_id: pinId,
        sender: 'dev_note',
        content: cleanNote,
        is_internal: 1,
        metadata: {
          formattedDirective: `[DEV_NOTE: ${cleanNote}]`,
          author: req.admin?.username || 'developer'
        }
      });

      io.to('dev_monitors').emit('dev:chat_message', { pinId, message: noteMsg });

      let aiFollowUp = null;
      if (triggerAiNow) {
        io.to(`pin:${pinId}`).emit('chat:typing', { isTyping: true, sender: 'ai' });
        io.to('dev_monitors').emit('dev:typing', { pinId, isTyping: true });

        const agyResult = await agyManager.runAgyTurn({
          pinId,
          userSafeWrappedPrompt: `[DEV_NOTE: ${cleanNote}]\nPlease ask the client 1-2 natural follow-up questions in Arabic guided by this developer note, without revealing that you received an internal developer note. Include [CHOICES: ...] at the end if appropriate.`,
          isPrdGeneration: false
        });

        aiFollowUp = MessageRepo.create({
          pin_id: pinId,
          sender: 'ai',
          content: agyResult.response,
          is_internal: 0,
          metadata: {
            engine: agyResult.engine,
            guidedByDevNote: noteMsg.id,
            choices: agyResult.choices || []
          }
        });

        io.to(`pin:${pinId}`).emit('chat:typing', { isTyping: false, sender: 'ai' });
        io.to('dev_monitors').emit('dev:typing', { pinId, isTyping: false });

        io.to(`pin:${pinId}`).emit('chat:message', aiFollowUp);
        io.to('dev_monitors').emit('dev:chat_message', { pinId, message: aiFollowUp });
      }

      res.json({
        success: true,
        noteMessage: noteMsg,
        aiFollowUp
      });
    } catch (err) {
      console.error('[DevNoteRoute Error]:', err);
      res.status(500).json({ error: 'حدث خطأ أثناء حقن الملاحظة السرية.' });
    }
  });

  /**
   * POST /api/dev/sessions/:pinId/prd
   * One-Click PRD: Prompts `agy` with `[GENERATE_PRD]` to compile a full, structured Product Requirements Document.
   */
  router.post('/sessions/:pinId/prd', requireAdminAuth, async (req, res) => {
    try {
      const { pinId } = req.params;
      const pinRecord = PinRepo.getById(pinId);
      if (!pinRecord) {
        return res.status(404).json({ error: 'جلسة العميل غير موجودة.' });
      }

      io.to('dev_monitors').emit('dev:prd_generating', { pinId, isGenerating: true });

      const agyResult = await agyManager.runAgyTurn({
        pinId,
        userSafeWrappedPrompt: '[GENERATE_PRD]',
        isPrdGeneration: true
      });

      const updatedPin = PinRepo.updatePrd(pinId, agyResult.response);

      io.to('dev_monitors').emit('dev:prd_generated', {
        pinId,
        prdMarkdown: updatedPin.prd_markdown,
        updatedAt: updatedPin.updated_at,
        engine: agyResult.engine
      });

      res.json({
        success: true,
        prdMarkdown: updatedPin.prd_markdown,
        engine: agyResult.engine,
        updatedAt: updatedPin.updated_at
      });
    } catch (err) {
      console.error('[DevPrdRoute Error]:', err);
      io.to('dev_monitors').emit('dev:prd_generating', { pinId: req.params.pinId, isGenerating: false });
      res.status(500).json({ error: 'حدث خطأ أثناء توليد وثيقة المتطلبات (PRD).' });
    }
  });

  // ============================================================================
  // Standalone Developer AI Assistant Routes (/api/dev/ai-threads)
  // ============================================================================

  /**
   * GET /api/dev/ai-threads
   * Lists all standalone developer AI consultation threads (creates a default one if none exist).
   */
  router.get('/ai-threads', requireAdminAuth, (_req, res) => {
    let threads = DevAiRepo.getAllThreads();
    if (threads.length === 0) {
      DevAiRepo.createThread({ title: 'مساحة الاستشارة التقنية العامة', project_group: null });
      threads = DevAiRepo.getAllThreads();
    }
    res.json({ threads });
  });

  /**
   * POST /api/dev/ai-threads
   * Creates a new standalone developer AI thread (optionally linked to a project_group tree).
   */
  router.post('/ai-threads', requireAdminAuth, (req, res) => {
    const { title, project_group } = req.body || {};
    const thread = DevAiRepo.createThread({
      title: title || (project_group ? `تحليل مشروع: ${project_group}` : 'استشارة تقنية جديدة'),
      project_group: project_group || null
    });
    const messages = DevAiRepo.getMessages(thread.id);
    res.status(201).json({ thread, messages });
  });

  /**
   * GET /api/dev/ai-threads/:threadId
   * Fetches messages for a specific standalone developer AI thread.
   */
  router.get('/ai-threads/:threadId', requireAdminAuth, (req, res) => {
    const thread = DevAiRepo.getThreadById(req.params.threadId);
    if (!thread) {
      return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }
    const messages = DevAiRepo.getMessages(thread.id);
    res.json({ thread, messages });
  });

  /**
   * DELETE /api/dev/ai-threads/:threadId
   */
  router.delete('/ai-threads/:threadId', requireAdminAuth, (req, res) => {
    DevAiRepo.deleteThread(req.params.threadId);
    res.json({ success: true });
  });

  /**
   * POST /api/dev/ai-threads/:threadId/message
   * Sends a direct developer question to `agy` and returns the AI response.
   */
  router.post('/ai-threads/:threadId/message', requireAdminAuth, async (req, res) => {
    try {
      const { threadId } = req.params;
      const { content } = req.body || {};
      const thread = DevAiRepo.getThreadById(threadId);
      if (!thread) {
        return res.status(404).json({ error: 'محادثة المطور غير موجودة.' });
      }

      const cleanPrompt = normalizeArabicJeem(String(content || '').trim());
      if (!cleanPrompt) {
        return res.status(400).json({ error: 'يرجى كتابة سؤالك أو طلبك.' });
      }

      const devMsg = DevAiRepo.addMessage({
        thread_id: threadId,
        sender: 'developer',
        content: cleanPrompt
      });

      const agyRes = await agyManager.runDevAssistantTurn({
        threadId,
        developerPrompt: cleanPrompt
      });

      const aiMsg = DevAiRepo.addMessage({
        thread_id: threadId,
        sender: 'ai',
        content: agyRes.response,
        metadata: { engine: agyRes.engine }
      });

      res.json({
        success: true,
        developerMessage: devMsg,
        aiMessage: aiMsg
      });
    } catch (err) {
      console.error('[DevAiThreadMessage Error]:', err);
      res.status(500).json({ error: 'حدث خطأ أثناء التواصل مع الذكاء الاصطناعي.' });
    }
  });

  return router;
};
