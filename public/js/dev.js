/**
 * Gapless Developer Co-Pilot Mode Logic (public/js/dev.js)
 *
 * Features:
 * - Grouped Multi-User Project Sidebar (shows shared project groups & connected participant chats)
 * - Ghost Mode (with optional quick-choice chips for the client)
 * - Secret Notes (`[DEV_NOTE: ...]`)
 * - Standalone Developer AI Chat (`tabPaneDevAi`) to consult with AI independently at any moment
 * - Hierarchical Project Knowledge Tree Viewer (`tabPaneProjectTree`) showing organized multi-user data
 * - One-Click PRD (`[GENERATE_PRD]`) synthesizing all connected chats in the project tree
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
  const resetSessionChatBtn = document.getElementById('resetSessionChatBtn');
  const generatePrdBtn = document.getElementById('generatePrdBtn');

  const devChatStream = document.getElementById('devChatStream');
  const devTypingBanner = document.getElementById('devTypingBanner');

  const modeTabGhost = document.getElementById('modeTabGhost');
  const modeTabNote = document.getElementById('modeTabNote');
  const triggerAiNowLabel = document.getElementById('triggerAiNowLabel');
  const triggerAiNowCheckbox = document.getElementById('triggerAiNowCheckbox');
  const ghostChoicesRow = document.getElementById('ghostChoicesRow');
  const ghostChoicesInput = document.getElementById('ghostChoicesInput');
  const copilotActionForm = document.getElementById('copilotActionForm');
  const copilotInput = document.getElementById('copilotInput');
  const copilotSubmitBtn = document.getElementById('copilotSubmitBtn');

  // Right Workbench Tabs
  const panelTabBtns = Array.from(document.querySelectorAll('.panel-tab-btn[data-panel-tab]'));
  const tabPaneDevAi = document.getElementById('tabPaneDevAi');
  const tabPaneProjectTree = document.getElementById('tabPaneProjectTree');
  const tabPanePrdDoc = document.getElementById('tabPanePrdDoc');

  // Standalone Developer AI Chat Elements
  const devAiThreadSelect = document.getElementById('devAiThreadSelect');
  const newDevAiThreadBtn = document.getElementById('newDevAiThreadBtn');
  const devAiMessagesContainer = document.getElementById('devAiMessagesContainer');
  const devAiComposerForm = document.getElementById('devAiComposerForm');
  const devAiInput = document.getElementById('devAiInput');
  const devAiSendBtn = document.getElementById('devAiSendBtn');

  // Project Tree Elements
  const projectTreeContainer = document.getElementById('projectTreeContainer');
  const refreshTreeBtn = document.getElementById('refreshTreeBtn');

  // PRD Elements
  const prdViewerContainer = document.getElementById('prdViewerContainer');
  const copyPrdBtn = document.getElementById('copyPrdBtn');
  const downloadPrdBtn = document.getElementById('downloadPrdBtn');

  let adminToken = localStorage.getItem('gapless_admin_token') || null;
  let sessions = [];
  let onlinePinIds = new Set();
  let selectedPinId = new URLSearchParams(window.location.search).get('pinId') || null;
  let currentProjectGroup = null;
  let currentMode = 'ghost';
  let currentPrdMarkdown = '';
  let renderedMsgIds = new Set();

  // Standalone Dev AI state
  let devAiThreads = [];
  let activeDevThreadId = null;

  const socket = io();

  function normalizeTextJeem(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/\u0669/g, 'ج');
  }

  function escapeHtml(str) {
    return normalizeTextJeem(String(str || ''))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMarkdownRich(md) {
    if (!md) return '';
    const safe = escapeHtml(md);
    return safe
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:var(--bg-elevated);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);font-size:0.84em;">$1</code>')
      .replace(/\n/g, '<br/>');
  }

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {})
    };
  }

  [copilotInput, ghostChoicesInput, devAiInput].forEach((inp) => {
    if (!inp) return;
    inp.addEventListener('input', () => {
      const fixed = normalizeTextJeem(inp.value);
      if (fixed !== inp.value) inp.value = fixed;
    });
  });

  // Switch Right Workbench Tabs
  function switchRightTab(tabName) {
    panelTabBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.panelTab === tabName);
    });
    tabPaneDevAi.classList.toggle('hidden', tabName !== 'dev-ai');
    tabPaneProjectTree.classList.toggle('hidden', tabName !== 'project-tree');
    tabPanePrdDoc.classList.toggle('hidden', tabName !== 'prd-doc');
  }

  panelTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchRightTab(btn.dataset.panelTab));
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
      await loadDevAiThreads();
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
  // 2. Load Sessions (Grouped by Shared Project) & Active Session Details
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
      devSessionsList.innerHTML = `<div style="padding:18px; color:var(--text-muted); font-size:0.82rem;">لا توجد جلسات حالياً.</div>`;
      return;
    }

    // Group sessions by project_group
    const groupsMap = new Map();
    for (const s of sessions) {
      const gName = (s.project_group || s.project_name || 'مشروع عام').trim();
      if (!groupsMap.has(gName)) groupsMap.set(gName, []);
      groupsMap.get(gName).push(s);
    }

    const htmlBlocks = [];
    for (const [groupName, members] of groupsMap.entries()) {
      const membersHtml = members
        .map((s) => {
          const isOnline = onlinePinIds.has(s.id);
          const isSelected = s.id === selectedPinId;
          return `
            <div class="session-item ${isSelected ? 'active' : ''}" data-pin-id="${escapeHtml(s.id)}">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="pin-code-pill" style="font-size:0.78rem; padding:2px 8px;">#${escapeHtml(s.pin)}</span>
                <span style="font-size:0.72rem; font-weight:600; color:${isOnline ? 'var(--accent-emerald)' : 'var(--text-muted)'};">
                  ${isOnline ? '● متصل الآن' : '○ غير متصل'}
                </span>
              </div>
              <div style="font-weight:700; font-size:0.9rem; margin-top:5px; color:var(--text-primary);">
                ${escapeHtml(s.client_name)}
              </div>
              <div style="font-size:0.75rem; color:var(--accent-purple); font-weight:600;">
                ${escapeHtml(s.participant_role || 'العميل الرئيسي')}
              </div>
              <div style="display:flex; gap:10px; margin-top:5px; font-size:0.72rem; color:var(--text-muted);">
                <span>${s.message_count || 0} رسالة</span>
                <span>•</span>
                <span>${s.dev_note_count || 0} ملاحظات سرية</span>
              </div>
            </div>
          `;
        })
        .join('');

      htmlBlocks.push(`
        <div class="project-group-block">
          <div class="project-group-header">
            <span>📁 ${escapeHtml(groupName)}</span>
            <span class="badge badge-persona" style="font-size:0.68rem;">${members.length} مشارك</span>
          </div>
          ${membersHtml}
        </div>
      `);
    }

    devSessionsList.innerHTML = htmlBlocks.join('');
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
      currentProjectGroup = s.project_group || s.project_name;

      activeSessionHeaderTitle.textContent = `${normalizeTextJeem(s.client_name)} (${normalizeTextJeem(s.participant_role || 'العميل الرئيسي')}) — مشروع: ${normalizeTextJeem(currentProjectGroup)}`;
      activeSessionHeaderMeta.textContent = `PIN: #${s.pin} | السياق السري (مخفي عن العميل): ${normalizeTextJeem(s.custom_instructions || 'لا يوجد')}`;

      generatePrdBtn.disabled = false;
      if (resetSessionChatBtn) resetSessionChatBtn.disabled = false;
      copilotInput.disabled = false;
      copilotSubmitBtn.disabled = false;

      devChatStream.innerHTML = '';
      renderedMsgIds.clear();
      (data.messages || []).forEach(appendDevMessageBubble);

      renderPrdContent(s.prd_markdown || '');
      if (data.projectTree) {
        renderProjectTree(data.projectTree);
      }
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
            [DEV_NOTE: توجيه سري للمحرك — مخفي عن المستخدم]
          </div>
          <div>${formatMarkdownRich(msg.content)}</div>
        </div>
      `;
    } else {
      row.className = `msg-row ${msg.sender === 'client' ? 'client' : 'ai'}`;

      let badges = '';
      if (meta.ghostMode) {
        badges += `<span class="badge badge-role" style="margin-right:6px;">Ghost Mode (رد المطور كـ AI)</span>`;
      }
      if (meta.flagged) {
        badges += `<span class="badge badge-revoked" style="margin-right:6px;">اعتراض حقن أوامر (${escapeHtml((meta.reasons || []).join(', '))})</span>`;
      }

      let choicesPreview = '';
      if (Array.isArray(meta.choices) && meta.choices.length > 0) {
        choicesPreview = `
          <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border-subtle); font-size:0.75rem; color:var(--text-secondary);">
            <span>الخيارات التفاعلية المعروضة للمستخدم:</span>
            <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:4px;">
              ${meta.choices.map((c) => `<span class="badge badge-persona">${escapeHtml(c)}</span>`).join('')}
            </div>
          </div>
        `;
      }

      let mediaHtml = '';
      if (msg.media_url) {
        const isAudio =
          meta.mediaType === 'audio' ||
          /\.(webm|ogg|mp3|wav|m4a|aac)(\?|$)/i.test(msg.media_url);
        const isPdf = meta.mediaType === 'pdf' || /\.pdf(\?|$)/i.test(msg.media_url);

        if (isAudio) {
          const durationLabel = meta.audioDuration ? ` (${meta.audioDuration})` : '';
          mediaHtml = `
            <div class="audio-bubble-player">
              <div class="audio-bubble-header">
                <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                <span>رسالة صوتية${escapeHtml(durationLabel)}</span>
              </div>
              <audio controls preload="metadata" src="${msg.media_url}"></audio>
            </div>
          `;
        } else if (isPdf) {
          mediaHtml = `
            <div class="msg-media-preview" style="padding:10px 12px;">
              <a href="${msg.media_url}" target="_blank" rel="noopener noreferrer" style="color:var(--brand-text); font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
                <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span>عرض ملف PDF المرفق</span>
              </a>
            </div>
          `;
        } else {
          mediaHtml = `
            <div class="msg-media-preview">
              <img src="${msg.media_url}" alt="مرفق العميل" onclick="window.open('${msg.media_url}', '_blank')" />
            </div>
          `;
        }
      }

      const who = msg.sender === 'client' ? 'المستخدم' : 'المستشار الذكي (ScopeMaster)';
      const timeStr = new Date(msg.created_at).toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });

      row.innerHTML = `
        <div class="msg-bubble">
          ${mediaHtml}
          <div>${formatMarkdownRich(msg.content)}</div>
          ${choicesPreview}
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
  // 3. Hierarchical Project Knowledge Tree Renderer
  // ============================================================================
  function renderProjectTree(tree) {
    if (!tree || !Array.isArray(tree.participants_tree)) {
      projectTreeContainer.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding-top:40px;">اختر جلسة لعرض الشجرة الشاملة للمشروع.</div>`;
      return;
    }

    const nodesHtml = tree.participants_tree
      .map((node) => {
        const inputsHtml =
          node.key_client_inputs && node.key_client_inputs.length > 0
            ? `<ul class="tree-leaf-list">
                ${node.key_client_inputs
                  .map((inp) => `<li>"${escapeHtml(inp.content)}"</li>`)
                  .join('')}
               </ul>`
            : `<div style="color:var(--text-muted); margin-top:4px;">لم يدخل إجابات نصية بعد.</div>`;

        return `
          <div class="tree-node">
            <div class="tree-node-header" onclick="this.nextElementSibling.classList.toggle('hidden')">
              <div>
                <span style="color:var(--brand-primary);">├─ ${escapeHtml(node.client_name)}</span>
                <span class="badge badge-role" style="margin-right:6px;">${escapeHtml(node.participant_role)}</span>
              </div>
              <span class="pin-code-pill" style="font-size:0.75rem; padding:1px 6px;">#${escapeHtml(node.pin)}</span>
            </div>
            <div class="tree-node-body">
              <div style="margin-bottom:6px; color:var(--text-secondary);">
                <strong>السياق السري الخاص بهذا المشارك:</strong> ${escapeHtml(node.custom_instructions_internal || 'غير محدد')}
              </div>
              <div>
                <strong>مدخلات وإجابات هذا المشارك (${node.stats.client_responses}):</strong>
                ${inputsHtml}
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    projectTreeContainer.innerHTML = `
      <div style="margin-bottom:14px; padding:12px; background:var(--bg-secondary); border:1px solid var(--border-strong); border-radius:var(--radius-sm);">
        <div style="font-weight:800; font-size:0.95rem; color:var(--text-primary);">
          🌳 الجذر الشجري للمشروع: ${escapeHtml(tree.project_group)}
        </div>
        <div style="font-size:0.76rem; color:var(--text-secondary); margin-top:4px;">
          إجمالي المشاركين المتصلين: <strong>${tree.total_participants}</strong> • يقرأ محرك <code>agy</code> هذه الشجرة تلقائياً لربط المتطلبات ببعضها.
        </div>
      </div>
      ${nodesHtml}
    `;
  }

  if (refreshTreeBtn) {
    refreshTreeBtn.addEventListener('click', async () => {
      if (!currentProjectGroup) return;
      const res = await fetch(`/api/dev/projects-tree?project_group=${encodeURIComponent(currentProjectGroup)}`, {
        headers: authHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        renderProjectTree(data.tree);
      }
    });
  }

  // ============================================================================
  // 4. Standalone Developer AI Assistant (Direct Dev <-> AI Chat)
  // ============================================================================
  async function loadDevAiThreads() {
    try {
      const res = await fetch('/api/dev/ai-threads', { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      devAiThreads = data.threads || [];
      renderDevAiThreadOptions();

      if (!activeDevThreadId && devAiThreads.length > 0) {
        await selectDevAiThread(devAiThreads[0].id);
      } else if (activeDevThreadId) {
        await selectDevAiThread(activeDevThreadId);
      }
    } catch (err) {
      console.error('Failed to load Dev AI threads:', err);
    }
  }

  function renderDevAiThreadOptions() {
    if (!devAiThreadSelect) return;
    devAiThreadSelect.innerHTML = devAiThreads
      .map(
        (t) =>
          `<option value="${escapeHtml(t.id)}" ${t.id === activeDevThreadId ? 'selected' : ''}>${escapeHtml(t.title)}${t.project_group ? ` (${escapeHtml(t.project_group)})` : ''}</option>`
      )
      .join('');
  }

  async function selectDevAiThread(threadId) {
    activeDevThreadId = threadId;
    renderDevAiThreadOptions();

    const res = await fetch(`/api/dev/ai-threads/${encodeURIComponent(threadId)}`, {
      headers: authHeaders()
    });
    if (!res.ok) return;
    const data = await res.json();
    devAiMessagesContainer.innerHTML = '';
    (data.messages || []).forEach(appendDevAiMessageBubble);
  }

  function appendDevAiMessageBubble(msg) {
    if (!msg) return;
    const row = document.createElement('div');
    const isDev = msg.sender === 'developer';
    row.className = `msg-row ${isDev ? 'client' : 'ai'}`;
    row.style.maxWidth = '92%';

    const who = isDev ? 'أنت (المطور)' : 'المستشار الهندسي الذكي (Dev AI)';
    const timeStr = new Date(msg.created_at).toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });

    row.innerHTML = `
      <div class="msg-bubble" style="font-size:0.84rem; padding:10px 13px;">
        <div>${formatMarkdownRich(msg.content)}</div>
      </div>
      <div class="msg-meta">
        <span>${who}</span>
        <span>•</span>
        <span>${timeStr}</span>
      </div>
    `;
    devAiMessagesContainer.appendChild(row);
    devAiMessagesContainer.scrollTop = devAiMessagesContainer.scrollHeight;
  }

  if (devAiThreadSelect) {
    devAiThreadSelect.addEventListener('change', () => {
      selectDevAiThread(devAiThreadSelect.value);
    });
  }

  if (newDevAiThreadBtn) {
    newDevAiThreadBtn.addEventListener('click', async () => {
      const linkToCurrent = currentProjectGroup
        ? confirm(`هل تريد ربط هذه المحادثة الاستشارية بشجرة المشروع الحالي (${currentProjectGroup})؟\nاضغط OK لربطها بالمشروع، أو Cancel لمحادثة حرة ومنفصلة تماماً.`)
        : false;

      const title = prompt(
        'عنوان المحادثة مع الذكاء الاصطناعي:',
        linkToCurrent ? `نقاش تقني حول ${currentProjectGroup}` : 'استشارة تقنية عامة'
      );
      if (!title) return;

      const res = await fetch('/api/dev/ai-threads', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          title,
          project_group: linkToCurrent ? currentProjectGroup : null
        })
      });
      if (res.ok) {
        const data = await res.json();
        activeDevThreadId = data.thread.id;
        await loadDevAiThreads();
      }
    });
  }

  if (devAiComposerForm) {
    devAiComposerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeDevThreadId) return;
      const content = normalizeTextJeem(devAiInput.value.trim());
      if (!content) return;

      devAiSendBtn.disabled = true;
      devAiSendBtn.textContent = '...';
      devAiInput.value = '';

      try {
        const res = await fetch(`/api/dev/ai-threads/${encodeURIComponent(activeDevThreadId)}/message`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (res.ok) {
          if (data.developerMessage) appendDevAiMessageBubble(data.developerMessage);
          if (data.aiMessage) appendDevAiMessageBubble(data.aiMessage);
        }
      } catch {
        alert('تعذر الاتصال بالمساعد الذكي.');
      } finally {
        devAiSendBtn.disabled = false;
        devAiSendBtn.textContent = 'إرسال';
        devAiInput.focus();
      }
    });
  }

  // ============================================================================
  // 5. Ghost Mode & Secret Notes ([DEV_NOTE: ...])
  // ============================================================================
  function setCoPilotMode(mode) {
    currentMode = mode;
    if (mode === 'ghost') {
      modeTabGhost.className = 'btn btn-primary btn-sm';
      modeTabNote.className = 'btn btn-secondary btn-sm';
      triggerAiNowLabel.classList.add('hidden');
      if (ghostChoicesRow) ghostChoicesRow.classList.remove('hidden');
      copilotInput.placeholder = 'اكتب رسالتك المباشرة للمستخدم لتظهر فوراً في محادثته باسم الذكاء الاصطناعي (Ghost Mode)...';
      copilotSubmitBtn.className = 'btn btn-primary';
      copilotSubmitBtn.innerHTML = '<span>إرسال كـ AI</span>';
    } else {
      modeTabGhost.className = 'btn btn-secondary btn-sm';
      modeTabNote.className = 'btn btn-amber btn-sm';
      triggerAiNowLabel.classList.remove('hidden');
      if (ghostChoicesRow) ghostChoicesRow.classList.add('hidden');
      copilotInput.placeholder = 'اكتب توجيهك السري لـ agy (مثال: اسأل المستخدم عن تقسيم المخزن)... سيتم حقنها بصيغة [DEV_NOTE: ...] دون أن يراها المستخدم.';
      copilotSubmitBtn.className = 'btn btn-amber';
      copilotSubmitBtn.innerHTML = '<span>حقن [DEV_NOTE]</span>';
    }
  }

  modeTabGhost.addEventListener('click', () => setCoPilotMode('ghost'));
  modeTabNote.addEventListener('click', () => setCoPilotMode('note'));

  copilotActionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedPinId) return;

    const text = normalizeTextJeem(copilotInput.value.trim());
    if (!text) return;

    const rawChoices = ghostChoicesInput ? normalizeTextJeem(ghostChoicesInput.value.trim()) : '';

    copilotSubmitBtn.disabled = true;
    copilotInput.value = '';
    if (ghostChoicesInput) ghostChoicesInput.value = '';

    try {
      if (currentMode === 'ghost') {
        const res = await fetch(`/api/dev/sessions/${encodeURIComponent(selectedPinId)}/ghost`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ content: text, choices: rawChoices })
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
    } catch {
      devTypingBanner.classList.add('hidden');
      alert('تعذر إرسال التوجيه.');
    } finally {
      copilotSubmitBtn.disabled = false;
      copilotInput.focus();
    }
  });

  // ============================================================================
  // 6. One-Click PRD Generation ([GENERATE_PRD])
  // ============================================================================
  function renderPrdContent(markdown) {
    currentPrdMarkdown = normalizeTextJeem(markdown || '');
    if (!currentPrdMarkdown) {
      prdViewerContainer.innerHTML = `
        <div style="color:var(--text-muted); text-align:center; padding-top:60px;">
          اضغط على زر <strong>"توليد وثيقة PRD الشاملة ([GENERATE_PRD])"</strong> في الأعلى لتوليد وثيقة متطلبات المنتج الموحدة من جميع محادثات المشروع.
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

  if (resetSessionChatBtn) {
    resetSessionChatBtn.addEventListener('click', async () => {
      if (!selectedPinId) return;
      if (!confirm('هل تريد مسح المحادثة الحالية وإعادة ضبط الترحيب (مع إبقاء المعلومات الأولية سرية للذكاء الاصطناعي فقط)؟')) return;
      const res = await fetch(`/api/admin/pins/${encodeURIComponent(selectedPinId)}/reset-chat`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (res.ok) {
        await selectSession(selectedPinId);
        await loadSessions();
      }
    });
  }

  generatePrdBtn.addEventListener('click', async () => {
    if (!selectedPinId) return;
    switchRightTab('prd-doc');
    generatePrdBtn.disabled = true;
    generatePrdBtn.innerHTML = '<span>جاري توليد وثيقة PRD عبر agy...</span>';
    prdViewerContainer.innerHTML = `<div style="text-align:center; padding-top:60px; color:var(--brand-text);">يقوم محرك <code>agy</code> الآن بقراءة شجرة المشروع المشترك وصياغة وثيقة المتطلبات الشاملة ([GENERATE_PRD])...</div>`;

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
      generatePrdBtn.innerHTML = '<span>توليد وثيقة PRD الشاملة ([GENERATE_PRD])</span>';
    }
  });

  copyPrdBtn.addEventListener('click', async () => {
    if (!currentPrdMarkdown) return;
    await navigator.clipboard.writeText(currentPrdMarkdown);
    const orig = copyPrdBtn.textContent;
    copyPrdBtn.textContent = 'تم النسخ';
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
  // 7. Real-Time Socket Listeners
  // ============================================================================
  socket.on('dev:online_pins', (pinIds) => {
    onlinePinIds = new Set(pinIds || []);
    renderSessionsSidebar();
  });

  socket.on('dev:chat_message', ({ pinId, message }) => {
    if (pinId === selectedPinId) {
      appendDevMessageBubble(message);
      selectSession(selectedPinId);
    } else {
      loadSessions();
    }
  });

  socket.on('dev:typing', ({ pinId, isTyping }) => {
    if (pinId === selectedPinId) {
      devTypingBanner.textContent = 'محرك agy يقوم بالتحليل والكتابة الآن...';
      devTypingBanner.classList.toggle('hidden', !isTyping);
    }
  });

  socket.on('dev:client_typing', ({ pinId, isTyping }) => {
    if (pinId === selectedPinId) {
      devTypingBanner.textContent = 'المستخدم يكتب رسالة الآن في الوقت الفعلي...';
      devTypingBanner.classList.toggle('hidden', !isTyping);
    }
  });

  socket.on('dev:prd_generated', ({ pinId, prdMarkdown }) => {
    if (pinId === selectedPinId) {
      renderPrdContent(prdMarkdown);
    }
  });

  loadSessions();
  loadDevAiThreads();
})();
