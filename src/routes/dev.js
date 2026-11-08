/**
 * Developer Co-Pilot Mode (/dev) API Routes
 * Handles:
 * - Real-time session inspection (including internal dev notes and metadata)
 * - Ghost Mode: Send messages directly into the client's chat appearing as the AI
 * - Secret Notes: Inject `[DEV_NOTE: ...]` prompts into `agy` to guide its questions without the client seeing the note
 * - Trigger AI Follow-up: Optional immediate `agy` turn after a secret note
 * - One-Click PRD: Prompt `agy` with `[GENERATE_PRD]` to compile a full, structured Product Requirements Document
 */
const express = require('express');
const { PinRepo, MessageRepo, normalizeArabicJeem } = require('../db/repository');
const { requireAdminAuth } = require('../security/auth');
const { sanitizeDevNote } = require('../security/sanitizer');
const agyManager = require('../services/agyManager');

module.exports = function createDevRouter(io) {
  const router = express.Router();

  /**
   * GET /api/dev/sessions
   * Lists all client sessions with their full message & dev_note counts.
   */
  router.get('/sessions', requireAdminAuth, (_req, res) => {
    const pins = PinRepo.getAll();
    res.json({
      sessions: pins,
      engineStatus: agyManager.getStatus()
    });
  });

  /**
   * GET /api/dev/sessions/:pinId
   * Returns full session details including internal `[DEV_NOTE: ...]` items and any generated PRD.
   */
  router.get('/sessions/:pinId', requireAdminAuth, (req, res) => {
    const { pinId } = req.params;
    const pinRecord = PinRepo.getById(pinId);
    if (!pinRecord) {
      return res.status(404).json({ error: 'جلسة العميل غير موجودة.' });
    }

    const messages = MessageRepo.getByPinId(pinId, true); // includeInternal = true
    res.json({
      session: pinRecord,
      messages
    });
  });

  /**
   * POST /api/dev/sessions/:pinId/ghost
   * Ghost Mode: Sends a message directly into the client's chat appearing seamlessly as the AI.
   */
  router.post('/sessions/:pinId/ghost', requireAdminAuth, (req, res) => {
    const { pinId } = req.params;
    const { content } = req.body || {};

    const pinRecord = PinRepo.getById(pinId);
    if (!pinRecord) {
      return res.status(404).json({ error: 'جلسة العميل غير موجودة.' });
    }

    const cleanContent = normalizeArabicJeem(String(content || '').trim());
    if (!cleanContent) {
      return res.status(400).json({ error: 'محتوى رسالة Ghost Mode مطلوب.' });
    }

    // Stored with sender = 'ai' so the client sees it identically to an AI message,
    // while metadata records ghostMode: true for developer Co-Pilot visibility.
    const ghostMsg = MessageRepo.create({
      pin_id: pinId,
      sender: 'ai',
      content: cleanContent,
      is_internal: 0,
      metadata: {
        ghostMode: true,
        author: req.admin?.username || 'developer'
      }
    });

    // Emit to the client room (appears as AI) and dev room (shows Ghost badge)
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

      // Save internal developer note (is_internal = 1 -> never sent to client API or client socket room)
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

      // Notify ONLY developer Co-Pilot monitors
      io.to('dev_monitors').emit('dev:chat_message', { pinId, message: noteMsg });

      let aiFollowUp = null;
      if (triggerAiNow) {
        io.to(`pin:${pinId}`).emit('chat:typing', { isTyping: true, sender: 'ai' });
        io.to('dev_monitors').emit('dev:typing', { pinId, isTyping: true });

        const agyResult = await agyManager.runAgyTurn({
          pinId,
          userSafeWrappedPrompt: `[DEV_NOTE: ${cleanNote}]\nPlease ask the client 1-2 natural follow-up questions in Arabic guided by this developer note, without revealing that you received an internal developer note.`,
          isPrdGeneration: false
        });

        aiFollowUp = MessageRepo.create({
          pin_id: pinId,
          sender: 'ai',
          content: agyResult.response,
          is_internal: 0,
          metadata: {
            engine: agyResult.engine,
            guidedByDevNote: noteMsg.id
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

  return router;
};
