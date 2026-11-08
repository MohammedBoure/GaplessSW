/**
 * Gapless Developer Co-Pilot Mode Logic (public/js/dev.js)
 *
 * Features:
 * - Real-time monitoring of all client sessions
 * - Ghost Mode: Inject messages directly into the client's chat appearing as the AI
 * - Secret Notes: Inject `[DEV_NOTE: ...]` into `agy` to guide its questions without the client seeing the note
 * - One-Click PRD: Prompt `agy` with `[GENERATE_PRD]` to compile a structured Product Requirements Document
 */
(function () {
  const devAuthOverlay = document.getElementById('devAuthOverlay');
  const devLoginForm = document.getElementById('devLoginForm');
  const devUsernameInput = document.getElementById('devUsername');
  const devPasswordInput = document.getElementById('devPassword');
  const devLoginError = document.getElementById('devLoginError');
  const devLogoutBtn = document.getElementById('devLogoutBtn');

  const devSessionsList = document.getElementById('devSessionsList');
  const refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
  const activeSessionHeaderTitle = document.getElementById('activeSessionHeaderTitle');
  const activeSessionHeaderMeta = document.getElementById('activeSessionHeaderMeta');
  const generatePrdBtn = document.getElementById('generatePrdBtn');

  const devChatStream = document.getElementById('devChatStream');
  const devTypingBanner = document.getElementById('devTypingBanner');

  const modeTabGhost = document.getElementById('modeTabGhost');
  const modeTabNote = document.getElementById('modeTabNote');
  const triggerAiNowLabel = document.getElementById('triggerAiNowLabel');
  const triggerAiNowCheckbox = document.getElementById('triggerAiNowCheckbox');
  const copilotActionForm = document.getElementById('copilotActionForm');
  const copilotInput = document.getElementById('copilotInput');
  const copilotSubmitBtn = document.getElementById('copilotSubmitBtn');

  const prdViewerContainer = document.getElementById('prdViewerContainer');
  const copyPrdBtn = document.getElementById('copyPrdBtn');
  const downloadPrdBtn = document.getElementById('downloadPrdBtn');

  let adminToken = localStorage.getItem('gapless_admin_token') || null;
  let sessions = [];
  let onlinePinIds = new Set();
  let selectedPinId = new URLSearchParams(window.location.search).get('pinId') || null;
  let currentMode = 'ghost'; // 'ghost' | 'note'
  let currentPrdMarkdown = '';
  let renderedMsgIds = new Set();

  const socket = io();

  function normalizeTextJeem(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/\u0669/g, 'ج');
  }

  function escapeHtml(str) {
    return normalizeTextJeem(String(str || ''))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatMarkdownRich(md) {
    if (!md) return '';
    const safe = escapeHtml(md);
    return safe
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);">$1</code>')
      .replace(/\n/g, '<br/>');
  }

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {})
    };
  }

  // Normalize '٩' -> 'ج' in developer input
  copilotInput.addEventListener('input', () => {
    const fixed = normalizeTextJeem(copilotInput.value);
    if (fixed !== copilotInput.value) copilotInput.value = fixed;
  });

  // ============================================================================
  // 1. Auth
  // ============================================================================
  devLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    devLoginError.classList.add('hidden');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: devUsernameInput.value.trim(),
          password: devPasswordInput.value
        })
      });
      const data = await res.json();
      if (!res.ok) {
        devLoginError.textContent = data.error || 'فشل تسجيل الدخول';
        devLoginError.classList.remove('hidden');
        return;
      }
      adminToken = data.token;
      localStorage.setItem('gapless_admin_token', adminToken);
      devAuthOverlay.classList.add('hidden');
      socket.emit('dev:join', { token: adminToken });
      await loadSessions();
    } catch {
      devLoginError.textContent = 'خطأ في الاتصال بالخادم.';
      devLoginError.classList.remove('hidden');
    }
  });

  devLogoutBtn.addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    localStorage.removeItem('gapless_admin_token');
    adminToken = null;
    devAuthOverlay.classList.remove('hidden');
  });

  // ============================================================================
  // 2. Load Sessions & Active Session Details
  // ============================================================================
  async function loadSessions() {
    try {
      const res = await fetch('/api/dev/sessions', { headers: authHeaders() });
      if (res.status === 401) {
        devAuthOverlay.classList.remove('hidden');
        return;
      }
      const data = await res.json();
      devAuthOverlay.classList.add('hidden');
      socket.emit('dev:join', { token: adminToken });

      sessions = data.sessions || [];
      renderSessionsSidebar();

      if (!selectedPinId && sessions.length > 0) {
        selectSession(sessions[0].id);
      } else if (selectedPinId) {
        selectSession(selectedPinId);
      }
    } catch (err) {
      console.error('Failed to load dev sessions:', err);
    }
  }

  function renderSessionsSidebar() {
    if (!sessions.length) {
      devSessionsList.innerHTML = `<div style="padding:18px; color:var(--text-muted); font-size:0.84rem;">لا توجد جلسات حالياً.</div>`;
      return;
    }

    devSessionsList.innerHTML = sessions
      .map((s) => {
        const isOnline = onlinePinIds.has(s.id);
        const isSelected = s.id === selectedPinId;
        return `
          <div class="session-item ${isSelected ? 'active' : ''}" data-pin-id="${escapeHtml(s.id)}">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span class="pin-code-pill" style="font-size:0.82rem; padding:2px 8px;">#${escapeHtml(s.pin)}</span>
              <span style="font-size:0.74rem; color:${isOnline ? 'var(--accent-emerald)' : 'var(--text-muted)'};">
                ${isOnline ? '● متصل الآن' : '○ غير متصل'}
              </span>
            </div>
            <div style="font-weight:700; font-size:0.92rem; margin-top:6px;">${escapeHtml(s.client_name)}</div>
            <div style="font-size:0.8rem; color:var(--accent-secondary);">${escapeHtml(s.project_name)}</div>
            <div style="display:flex; gap:10px; margin-top:6px; font-size:0.74rem; color:var(--text-muted);">
              <span>💬 ${s.message_count || 0}</span>
              <span>🕵️‍♂️ ${s.dev_note_count || 0} ملاحظات سرية</span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  devSessionsList.addEventListener('click', (e) => {
    const item = e.target.closest('.session-item[data-pin-id]');
    if (!item) return;
    selectSession(item.dataset.pinId);
  });

  async function selectSession(pinId) {
    selectedPinId = pinId;
    renderSessionsSidebar();

    try {
      const res = await fetch(`/api/dev/sessions/${encodeURIComponent(pinId)}`, {
        headers: authHeaders()
      });
      if (!res.ok) return;
      const data = await res.json();
      const s = data.session;

      activeSessionHeaderTitle.textContent = `${normalizeTextJeem(s.client_name)} — ${normalizeTextJeem(s.project_name)} (PIN: #${s.pin})`;
      activeSessionHeaderMeta.textContent = `التوجيه الإداري: ${normalizeTextJeem(s.custom_instructions || 'افتراضي')} | الشخصية: ${s.persona}`;

      generatePrdBtn.disabled = false;
      copilotInput.disabled = false;
      copilotSubmitBtn.disabled = false;

      devChatStream.innerHTML = '';
      renderedMsgIds.clear();
      (data.messages || []).forEach(appendDevMessageBubble);

      renderPrdContent(s.prd_markdown || '');
    } catch (err) {
      console.error('Error selecting session:', err);
    }
  }

  function appendDevMessageBubble(msg) {
    if (!msg || renderedMsgIds.has(msg.id)) return;
    renderedMsgIds.add(msg.id);

    let meta = {};
    try {
      meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata || {};
    } catch {
      meta = {};
    }

    const row = document.createElement('div');

    if (msg.sender === 'dev_note' || msg.is_internal) {
      row.className = 'msg-row dev_note';
      row.innerHTML = `
        <div class="msg-bubble">
          <div style="font-weight:700; color:var(--accent-amber); margin-bottom:4px;">
            🕵️‍♂️ [DEV_NOTE: ملاحظة سرية موجهة لمحرك agy — مخفية تماماً عن العميل]
          </div>
          <div>${formatMarkdownRich(msg.content)}</div>
        </div>
      `;
    } else {
      row.className = `msg-row ${msg.sender === 'client' ? 'client' : 'ai'}`;

      let badges = '';
      if (meta.ghostMode) {
        badges += `<span class="badge" style="background:rgba(168,85,247,0.22); color:#d8b4fe; border:1px solid #a855f7; margin-right:6px;">👻 Ghost Mode (أُرسلت من المطور كـ AI)</span>`;
      }
      if (meta.flagged) {
        badges += `<span class="badge badge-revoked" style="margin-right:6px;">🚨 تم اعتراض محاولة حقن أوامر (${escapeHtml((meta.reasons || []).join(', '))})</span>`;
      }

      let mediaHtml = '';
      if (msg.media_url) {
        mediaHtml = `
          <div class="msg-media-preview">
            <img src="${msg.media_url}" alt="مرفق العميل" onclick="window.open('${msg.media_url}', '_blank')" />
          </div>
        `;
      }

      const who = msg.sender === 'client' ? '👤 العميل' : '🤖 الذكاء الاصطناعي (ScopeMaster)';
      const timeStr = new Date(msg.created_at).toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });

      row.innerHTML = `
        <div class="msg-bubble">
          ${mediaHtml}
          <div>${formatMarkdownRich(msg.content)}</div>
        </div>
        <div class="msg-meta">
          <span>${who}</span>
          <span>•</span>
          <span>${timeStr}</span>
          ${badges}
        </div>
      `;
    }

    devChatStream.appendChild(row);
    devChatStream.scrollTop = devChatStream.scrollHeight;
  }

  // ============================================================================
  // 3. Ghost Mode & Secret Notes ([DEV_NOTE: ...])
  // ============================================================================
  function setCoPilotMode(mode) {
    currentMode = mode;
    if (mode === 'ghost') {
      modeTabGhost.className = 'btn btn-primary btn-sm';
      modeTabNote.className = 'btn btn-secondary btn-sm';
      triggerAiNowLabel.classList.add('hidden');
      copilotInput.placeholder = 'اكتب رسالتك المباشرة للعميل لتظهر فوراً في محادثته باسم الذكاء الاصطناعي (Ghost Mode)...';
      copilotSubmitBtn.className = 'btn btn-primary';
      copilotSubmitBtn.textContent = '👻 إرسال كـ AI';
    } else {
      modeTabGhost.className = 'btn btn-secondary btn-sm';
      modeTabNote.className = 'btn btn-amber btn-sm';
      triggerAiNowLabel.classList.remove('hidden');
      copilotInput.placeholder = 'اكتب توجيهك السري لـ agy (مثال: اسأل العميل عن بوابة الدفع BaridiMob وحدود الميزانية)... سيتم حقنها بصيغة [DEV_NOTE: ...] دون أن يراها العميل.';
      copilotSubmitBtn.className = 'btn btn-amber';
      copilotSubmitBtn.textContent = '🕵️‍♂️ حقن [DEV_NOTE]';
    }
  }

  modeTabGhost.addEventListener('click', () => setCoPilotMode('ghost'));
  modeTabNote.addEventListener('click', () => setCoPilotMode('note'));

  copilotActionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedPinId) return;

    const text = normalizeTextJeem(copilotInput.value.trim());
    if (!text) return;

    copilotSubmitBtn.disabled = true;
    copilotInput.value = '';

    try {
      if (currentMode === 'ghost') {
        const res = await fetch(`/api/dev/sessions/${encodeURIComponent(selectedPinId)}/ghost`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ content: text })
        });
        const data = await res.json();
        if (res.ok && data.message) {
          appendDevMessageBubble(data.message);
        }
      } else {
        const triggerAiNow = triggerAiNowCheckbox.checked;
        if (triggerAiNow) {
          devTypingBanner.classList.remove('hidden');
        }
        const res = await fetch(`/api/dev/sessions/${encodeURIComponent(selectedPinId)}/note`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ note: text, triggerAiNow })
        });
        const data = await res.json();
        devTypingBanner.classList.add('hidden');
        if (res.ok) {
          if (data.noteMessage) appendDevMessageBubble(data.noteMessage);
          if (data.aiFollowUp) appendDevMessageBubble(data.aiFollowUp);
          loadSessions();
        }
      }
    } catch (err) {
      devTypingBanner.classList.add('hidden');
      alert('تعذر إرسال التوجيه.');
    } finally {
      copilotSubmitBtn.disabled = false;
      copilotInput.focus();
    }
  });

  // ============================================================================
  // 4. One-Click PRD Generation ([GENERATE_PRD])
  // ============================================================================
  function renderPrdContent(markdown) {
    currentPrdMarkdown = normalizeTextJeem(markdown || '');
    if (!currentPrdMarkdown) {
      prdViewerContainer.innerHTML = `
        <div style="color:var(--text-muted); text-align:center; padding-top:60px;">
          اضغط على زر <strong>"توليد وثيقة PRD بضغطة واحدة ([GENERATE_PRD])"</strong> في الأعلى لتوليد وثيقة متطلبات المنتج الكاملة من محادثة العميل وملاحظات المطورين.
        </div>
      `;
      copyPrdBtn.disabled = true;
      downloadPrdBtn.disabled = true;
      return;
    }

    prdViewerContainer.innerHTML = formatMarkdownRich(currentPrdMarkdown);
    copyPrdBtn.disabled = false;
    downloadPrdBtn.disabled = false;
  }

  generatePrdBtn.addEventListener('click', async () => {
    if (!selectedPinId) return;
    generatePrdBtn.disabled = true;
    generatePrdBtn.textContent = '⏳ جاري توليد وثيقة PRD عبر agy...';
    prdViewerContainer.innerHTML = `<div style="text-align:center; padding-top:60px; color:var(--accent-secondary);">⚙️ يقوم محرك <code>agy</code> الآن بتحليل المحادثة والملاحظات السرية وصياغة وثيقة المتطلبات الشاملة ([GENERATE_PRD])...</div>`;

    try {
      const res = await fetch(`/api/dev/sessions/${encodeURIComponent(selectedPinId)}/prd`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json();
      if (res.ok && data.prdMarkdown) {
        renderPrdContent(data.prdMarkdown);
      } else {
        alert(data.error || 'فشل توليد وثيقة PRD.');
      }
    } catch {
      alert('حدث خطأ أثناء توليد وثيقة PRD.');
    } finally {
      generatePrdBtn.disabled = false;
      generatePrdBtn.textContent = '📄 توليد وثيقة PRD بضغطة واحدة ([GENERATE_PRD])';
    }
  });

  copyPrdBtn.addEventListener('click', async () => {
    if (!currentPrdMarkdown) return;
    await navigator.clipboard.writeText(currentPrdMarkdown);
    const orig = copyPrdBtn.textContent;
    copyPrdBtn.textContent = '✅ تم النسخ!';
    setTimeout(() => { copyPrdBtn.textContent = orig; }, 1800);
  });

  downloadPrdBtn.addEventListener('click', () => {
    if (!currentPrdMarkdown) return;
    const blob = new Blob([currentPrdMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PRD-${selectedPinId || 'project'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });

  refreshSessionsBtn.addEventListener('click', loadSessions);

  // ============================================================================
  // 5. Real-Time Socket Listeners
  // ============================================================================
  socket.on('dev:online_pins', (pinIds) => {
    onlinePinIds = new Set(pinIds || []);
    renderSessionsSidebar();
  });

  socket.on('dev:chat_message', ({ pinId, message }) => {
    if (pinId === selectedPinId) {
      appendDevMessageBubble(message);
    }
    loadSessions();
  });

  socket.on('dev:typing', ({ pinId, isTyping }) => {
    if (pinId === selectedPinId) {
      devTypingBanner.textContent = '🤖 محرك agy يقوم بالتحليل والكتابة الآن...';
      devTypingBanner.classList.toggle('hidden', !isTyping);
    }
  });

  socket.on('dev:client_typing', ({ pinId, isTyping }) => {
    if (pinId === selectedPinId) {
      devTypingBanner.textContent = '✍️ العميل يكتب رسالة الآن في الوقت الفعلي...';
      devTypingBanner.classList.toggle('hidden', !isTyping);
    }
  });

  socket.on('dev:prd_generated', ({ pinId, prdMarkdown }) => {
    if (pinId === selectedPinId) {
      renderPrdContent(prdMarkdown);
    }
  });

  // Initialize
  loadSessions();
})();
