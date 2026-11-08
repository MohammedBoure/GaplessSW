/**
 * Gapless Client Gateway & Discovery Chat Logic (public/js/client.js)
 *
 * Features:
 * - 4-digit PIN entry with touch keypad & keyboard support
 * - Real-time 5-minute countdown timer when 5 failed attempts occur
 * - Arabic character normalization ('٩' -> 'ج') in conversational inputs
 * - Real-time WebSocket message sync, Ghost Mode reception, and typing indicators
 * - Sketch / Screenshot / Wireframe upload support
 */
(function () {
  const pinGatewayScreen = document.getElementById('pinGatewayScreen');
  const chatDiscoveryScreen = document.getElementById('chatDiscoveryScreen');
  const pinSlots = Array.from(document.querySelectorAll('.pin-slot'));
  const keypadButtons = Array.from(document.querySelectorAll('.key-btn[data-digit]'));
  const clearPinBtn = document.getElementById('clearPinBtn');
  const backspacePinBtn = document.getElementById('backspacePinBtn');
  const pinFeedbackText = document.getElementById('pinFeedbackText');
  const lockoutCard = document.getElementById('lockoutCard');
  const lockoutTimerDisplay = document.getElementById('lockoutTimerDisplay');

  const chatProjectTitle = document.getElementById('chatProjectTitle');
  const chatClientSubtitle = document.getElementById('chatClientSubtitle');
  const chatMessagesContainer = document.getElementById('chatMessagesContainer');
  const typingIndicatorRow = document.getElementById('typingIndicatorRow');
  const exitSessionBtn = document.getElementById('exitSessionBtn');

  const chatComposerForm = document.getElementById('chatComposerForm');
  const messageInput = document.getElementById('messageInput');
  const sendMessageBtn = document.getElementById('sendMessageBtn');
  const triggerUploadBtn = document.getElementById('triggerUploadBtn');
  const mediaUploadInput = document.getElementById('mediaUploadInput');
  const mediaPreviewChip = document.getElementById('mediaPreviewChip');
  const mediaFileNameText = document.getElementById('mediaFileNameText');
  const removeMediaBtn = document.getElementById('removeMediaBtn');

  let currentPinDigits = [];
  let isLockedOut = false;
  let lockoutInterval = null;
  let clientToken = localStorage.getItem('gapless_client_token') || null;
  let activeSession = null;
  let renderedMessageIds = new Set();
  let isSubmittingMessage = false;

  const socket = io();

  // Normalize Arabic '٩' (U+0669) -> 'ج' in conversational text
  function normalizeTextJeem(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/\u0669/g, 'ج');
  }

  // Format simple markdown (bold, code, bullet lists, line breaks) safely
  function formatMarkdownSafe(text) {
    const escaped = normalizeTextJeem(String(text || ''))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return escaped
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);font-size:0.84em;">$1</code>')
      .replace(/\n/g, '<br/>');
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  // ============================================================================
  // 1. PIN Keypad & Lockout Timer Logic
  // ============================================================================
  function renderPinSlots(hasError = false) {
    pinSlots.forEach((slot, idx) => {
      const val = currentPinDigits[idx] || '';
      slot.textContent = val ? '•' : '';
      slot.classList.toggle('filled', Boolean(val));
      slot.classList.toggle('active', idx === currentPinDigits.length && !isLockedOut);
      slot.classList.toggle('error', hasError);
    });
  }

  function setKeypadDisabled(disabled) {
    keypadButtons.forEach((btn) => { btn.disabled = disabled; });
    clearPinBtn.disabled = disabled;
    backspacePinBtn.disabled = disabled;
  }

  function startLockoutCountdown(lockoutUntilMs) {
    isLockedOut = true;
    setKeypadDisabled(true);
    lockoutCard.classList.remove('hidden');

    if (lockoutInterval) clearInterval(lockoutInterval);

    const tick = () => {
      const remainingMs = Math.max(0, lockoutUntilMs - Date.now());
      const totalSeconds = Math.ceil(remainingMs / 1000);
      const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const secs = String(totalSeconds % 60).padStart(2, '0');
      lockoutTimerDisplay.textContent = `${mins}:${secs}`;

      if (remainingMs <= 0) {
        clearInterval(lockoutInterval);
        isLockedOut = false;
        lockoutCard.classList.add('hidden');
        setKeypadDisabled(false);
        currentPinDigits = [];
        renderPinSlots();
        pinFeedbackText.innerHTML = '<span style="color:var(--accent-emerald);">انتهى وقت الحظر المؤقت. يمكنك إدخال رمز PIN الآن.</span>';
      }
    };

    tick();
    lockoutInterval = setInterval(tick, 1000);
  }

  async function checkLockoutStatusOnLoad() {
    try {
      const res = await fetch('/api/client/lockout-status');
      const data = await res.json();
      if (data.isLocked && data.lockoutUntil > Date.now()) {
        startLockoutCountdown(data.lockoutUntil);
      } else if (data.failedAttempts > 0) {
        const left = Math.max(0, data.maxAttempts - data.failedAttempts);
        pinFeedbackText.innerHTML = `<span style="color:var(--accent-amber);">تنبيه: لديك ${data.failedAttempts} محاولات سابقة خاطئة (متبقي ${left} محاولات).</span>`;
      }
    } catch (err) {
      console.error('Failed to check lockout status:', err);
    }
  }

  async function submitPin(pinCode) {
    setKeypadDisabled(true);
    pinFeedbackText.innerHTML = '<span style="color:var(--accent-secondary);">جاري التحقق من الرمز...</span>';

    try {
      const res = await fetch('/api/client/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinCode })
      });
      const data = await res.json();

      if (!res.ok) {
        renderPinSlots(true);
        pinFeedbackText.innerHTML = `<span style="color:var(--accent-rose); font-weight:600;">${normalizeTextJeem(data.error || 'رمز غير صحيح')}</span>`;

        if (data.isLocked && data.lockoutUntil) {
          startLockoutCountdown(data.lockoutUntil);
        } else {
          setTimeout(() => {
            currentPinDigits = [];
            renderPinSlots(false);
            setKeypadDisabled(false);
          }, 420);
        }
        return;
      }

      // Success! Save session and open Chat View
      clientToken = data.token;
      localStorage.setItem('gapless_client_token', clientToken);
      openChatSession(data.session, data.messages || []);
    } catch (err) {
      setKeypadDisabled(false);
      pinFeedbackText.innerHTML = '<span style="color:var(--accent-rose);">تعذر الاتصال بالخادم. حاول مرة أخرى.</span>';
    }
  }

  function handleDigitPress(digit) {
    if (isLockedOut || currentPinDigits.length >= 4) return;
    currentPinDigits.push(digit);
    renderPinSlots(false);

    if (currentPinDigits.length === 4) {
      submitPin(currentPinDigits.join(''));
    }
  }

  keypadButtons.forEach((btn) => {
    btn.addEventListener('click', () => handleDigitPress(btn.dataset.digit));
  });

  clearPinBtn.addEventListener('click', () => {
    if (isLockedOut) return;
    currentPinDigits = [];
    renderPinSlots(false);
  });

  backspacePinBtn.addEventListener('click', () => {
    if (isLockedOut) return;
    currentPinDigits.pop();
    renderPinSlots(false);
  });

  // Support physical keyboard digits on PIN screen
  window.addEventListener('keydown', (e) => {
    if (!pinGatewayScreen.classList.contains('hidden') && !isLockedOut) {
      if (/^[0-9]$/.test(e.key)) {
        handleDigitPress(e.key);
      } else if (e.key === 'Backspace') {
        currentPinDigits.pop();
        renderPinSlots(false);
      } else if (e.key === 'Escape') {
        currentPinDigits = [];
        renderPinSlots(false);
      }
    }
  });

  // ============================================================================
  // 2. Discovery Chat Screen & Real-Time Messages
  // ============================================================================
  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    });
  }

  function appendMessageBubble(msg) {
    if (!msg || msg.is_internal || msg.sender === 'dev_note') return;
    if (renderedMessageIds.has(msg.id)) return;
    renderedMessageIds.add(msg.id);

    const row = document.createElement('div');
    row.className = `msg-row ${msg.sender === 'client' ? 'client' : 'ai'}`;

    let mediaHtml = '';
    if (msg.media_url) {
      mediaHtml = `
        <div class="msg-media-preview">
          <img src="${msg.media_url}" alt="مرفق التصميم" onclick="window.open('${msg.media_url}', '_blank')" />
        </div>
      `;
    }

    const senderLabel = msg.sender === 'client' ? 'أنت' : 'مستشار Gapless الذكي';
    row.innerHTML = `
      <div class="msg-bubble">
        ${mediaHtml}
        <div>${formatMarkdownSafe(msg.content)}</div>
      </div>
      <div class="msg-meta">
        <span>${senderLabel}</span>
        <span>•</span>
        <span>${formatTime(msg.created_at)}</span>
      </div>
    `;

    chatMessagesContainer.appendChild(row);
    scrollToBottom();
  }

  function openChatSession(session, messages) {
    activeSession = session;
    pinGatewayScreen.classList.add('hidden');
    chatDiscoveryScreen.classList.remove('hidden');

    chatProjectTitle.textContent = normalizeTextJeem(session.projectName);
    chatClientSubtitle.textContent = `العميل: ${normalizeTextJeem(session.clientName)} • رمز #${session.pin}`;

    chatMessagesContainer.innerHTML = '';
    renderedMessageIds.clear();
    messages.forEach(appendMessageBubble);

    socket.emit('client:join', { token: clientToken });
    scrollToBottom();
  }

  async function tryRestoreExistingSession() {
    if (!clientToken) {
      await checkLockoutStatusOnLoad();
      return;
    }

    try {
      const res = await fetch('/api/client/session', {
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      if (!res.ok) {
        localStorage.removeItem('gapless_client_token');
        clientToken = null;
        await checkLockoutStatusOnLoad();
        return;
      }
      const data = await res.json();
      openChatSession(data.session, data.messages || []);
    } catch {
      await checkLockoutStatusOnLoad();
    }
  }

  exitSessionBtn.addEventListener('click', async () => {
    await fetch('/api/client/logout', { method: 'POST' });
    localStorage.removeItem('gapless_client_token');
    clientToken = null;
    activeSession = null;
    currentPinDigits = [];
    renderPinSlots(false);
    setKeypadDisabled(false);
    chatDiscoveryScreen.classList.add('hidden');
    pinGatewayScreen.classList.remove('hidden');
  });

  // Live conversion of '٩' -> 'ج' while typing in chat input
  let typingTimeout = null;
  messageInput.addEventListener('input', () => {
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const normalized = normalizeTextJeem(messageInput.value);
    if (normalized !== messageInput.value) {
      messageInput.value = normalized;
      messageInput.setSelectionRange(start, end);
    }

    // Auto-resize textarea
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 110)}px`;

    // Emit live typing state to Developer Co-Pilot
    socket.emit('client:typing', { isTyping: messageInput.value.trim().length > 0 });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('client:typing', { isTyping: false });
    }, 2000);
  });

  // Submit on Enter (without Shift on desktop)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 640) {
      e.preventDefault();
      chatComposerForm.requestSubmit();
    }
  });

  // Media attachment handling
  triggerUploadBtn.addEventListener('click', () => {
    mediaUploadInput.click();
  });

  mediaUploadInput.addEventListener('change', () => {
    const file = mediaUploadInput.files[0];
    if (file) {
      mediaFileNameText.textContent = `📎 ${file.name}`;
      mediaPreviewChip.classList.remove('hidden');
    } else {
      mediaPreviewChip.classList.add('hidden');
    }
  });

  removeMediaBtn.addEventListener('click', () => {
    mediaUploadInput.value = '';
    mediaPreviewChip.classList.add('hidden');
  });

  // Send message & optional sketch/screenshot
  chatComposerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingMessage || !activeSession) return;

    const text = normalizeTextJeem(messageInput.value.trim());
    const file = mediaUploadInput.files[0];
    if (!text && !file) return;

    isSubmittingMessage = true;
    sendMessageBtn.disabled = true;
    triggerUploadBtn.disabled = true;

    const formData = new FormData();
    formData.append('content', text);
    if (file) {
      formData.append('media', file);
    }

    // Clear composer immediately for snappy mobile UX
    messageInput.value = '';
    messageInput.style.height = 'auto';
    mediaUploadInput.value = '';
    mediaPreviewChip.classList.add('hidden');
    socket.emit('client:typing', { isTyping: false });

    typingIndicatorRow.classList.remove('hidden');
    scrollToBottom();

    try {
      const res = await fetch('/api/client/message', {
        method: 'POST',
        headers: { Authorization: `Bearer ${clientToken}` },
        body: formData
      });
      const data = await res.json();

      typingIndicatorRow.classList.add('hidden');

      if (res.ok) {
        if (data.clientMessage) appendMessageBubble(data.clientMessage);
        if (data.aiMessage) appendMessageBubble(data.aiMessage);
      } else {
        alert(data.error || 'تعذر إرسال الرسالة.');
      }
    } catch (err) {
      typingIndicatorRow.classList.add('hidden');
      alert('حدث خطأ في الاتصال بالخادم.');
    } finally {
      isSubmittingMessage = false;
      sendMessageBtn.disabled = false;
      triggerUploadBtn.disabled = false;
      messageInput.focus();
    }
  });

  // Real-time Socket Listeners
  socket.on('chat:message', (msg) => {
    appendMessageBubble(msg);
  });

  socket.on('chat:typing', ({ isTyping }) => {
    typingIndicatorRow.classList.toggle('hidden', !isTyping);
    if (isTyping) scrollToBottom();
  });

  socket.on('chat:reset', ({ messages }) => {
    chatMessagesContainer.innerHTML = '';
    renderedMessageIds.clear();
    (messages || []).forEach(appendMessageBubble);
  });

  socket.on('session:revoked', ({ message }) => {
    alert(message || 'تم إيقاف الجلسة من قبل الإدارة.');
    exitSessionBtn.click();
  });

  // Initialize
  tryRestoreExistingSession();
})();
