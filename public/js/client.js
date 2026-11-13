/**
 * Gapless Client Gateway & Discovery Chat Logic (public/js/client.js)
 *
 * Features:
 * - 4-digit PIN entry with touch keypad & keyboard support
 * - Real-time 5-minute countdown timer when 5 failed attempts occur
 * - Interactive Choice Chips: AI responses include clickable quick-choice buttons
 *   for one-tap replies while still supporting full free-text input
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

  const chatComposerWrapper = document.getElementById('chatComposerWrapper');
  const chatComposerForm = document.getElementById('chatComposerForm');
  const messageInput = document.getElementById('messageInput');
  const sendMessageBtn = document.getElementById('sendMessageBtn');
  const recordVoiceBtn = document.getElementById('recordVoiceBtn');
  const triggerUploadBtn = document.getElementById('triggerUploadBtn');
  const mediaUploadInput = document.getElementById('mediaUploadInput');
  const mediaPreviewChip = document.getElementById('mediaPreviewChip');
  const mediaPreviewThumb = document.getElementById('mediaPreviewThumb');
  const mediaFileNameText = document.getElementById('mediaFileNameText');
  const removeMediaBtn = document.getElementById('removeMediaBtn');

  const voiceRecordingBar = document.getElementById('voiceRecordingBar');
  const cancelRecordingBtn = document.getElementById('cancelRecordingBtn');
  const sendRecordingBtn = document.getElementById('sendRecordingBtn');
  const recordingTimerText = document.getElementById('recordingTimerText');

  const imageLightboxModal = document.getElementById('imageLightboxModal');
  const lightboxImage = document.getElementById('lightboxImage');
  const closeLightboxBtn = document.getElementById('closeLightboxBtn');

  let currentPinDigits = [];
  let isLockedOut = false;
  let lockoutInterval = null;
  let clientToken = localStorage.getItem('gapless_client_token') || null;
  let activeSession = null;
  let renderedMessageIds = new Set();
  let isSubmittingMessage = false;

  let pendingMediaFile = null;
  let pendingThumbUrl = null;
  let mediaRecorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let recordingStartTime = 0;
  let recordingTimerInterval = null;
  let isRecordingCancelled = false;

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

  function formatMarkdownSafe(text) {
    const escaped = escapeHtml(text);
    return escaped
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:var(--bg-elevated);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);font-size:0.84em;">$1</code>')
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
    pinFeedbackText.innerHTML = '<span style="color:var(--brand-text);">جاري التحقق من الرمز...</span>';

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

      clientToken = data.token;
      localStorage.setItem('gapless_client_token', clientToken);
      openChatSession(data.session, data.messages || []);
    } catch {
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
  // 2. Discovery Chat Screen, Choice Chips, & Real-Time Messages
  // ============================================================================
  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    });
  }

  function parseMsgMetadata(msg) {
    try {
      return typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {});
    } catch {
      return {};
    }
  }

  function appendMessageBubble(msg) {
    if (!msg || msg.is_internal || msg.sender === 'dev_note') return;
    if (renderedMessageIds.has(msg.id)) return;
    renderedMessageIds.add(msg.id);

    const meta = parseMsgMetadata(msg);
    const row = document.createElement('div');
    row.className = `msg-row ${msg.sender === 'client' ? 'client' : 'ai'}`;

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
            <a href="${msg.media_url}" target="_blank" rel="noopener noreferrer" style="color:inherit; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
              <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>فتح ملف PDF المرفق</span>
            </a>
          </div>
        `;
      } else {
        mediaHtml = `
          <div class="msg-media-preview">
            <img src="${msg.media_url}" alt="مرفق التصميم" class="chat-zoomable-img" data-full-src="${msg.media_url}" />
          </div>
        `;
      }
    }

    // Render interactive choice chips if this is an AI message and choices exist
    let choicesHtml = '';
    if (msg.sender === 'ai' && Array.isArray(meta.choices) && meta.choices.length > 0) {
      const buttons = meta.choices
        .map(
          (choiceText) => `
          <button type="button" class="choice-chip-btn" data-choice-value="${escapeHtml(choiceText)}">
            <svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <span>${escapeHtml(choiceText)}</span>
          </button>
        `
        )
        .join('');
      choicesHtml = `<div class="choices-container">${buttons}</div>`;
    }

    const senderLabel = msg.sender === 'client' ? 'أنت' : 'مستشار التحليل الذكي';
    row.innerHTML = `
      <div class="msg-bubble">
        ${mediaHtml}
        <div>${formatMarkdownSafe(msg.content)}</div>
        ${choicesHtml}
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

  // Handle clicking on an interactive choice chip or zoomable image
  chatMessagesContainer.addEventListener('click', (e) => {
    const zoomImg = e.target.closest('.chat-zoomable-img[data-full-src]');
    if (zoomImg && imageLightboxModal && lightboxImage) {
      lightboxImage.src = zoomImg.dataset.fullSrc;
      imageLightboxModal.classList.remove('hidden');
      return;
    }

    const chipBtn = e.target.closest('.choice-chip-btn[data-choice-value]');
    if (!chipBtn || isSubmittingMessage) return;

    const chosenValue = chipBtn.dataset.choiceValue;
    if (!chosenValue) return;

    // If the choice ends with '...' (e.g. "سأشرح لك بالتفصيل..."), put it in the input box and focus so the user can elaborate
    if (chosenValue.endsWith('...')) {
      messageInput.value = chosenValue.replace(/\.+$/, '') + ': ';
      messageInput.focus();
      return;
    }

    // Otherwise submit immediately as the client's answer!
    messageInput.value = chosenValue;
    chatComposerForm.requestSubmit();
  });

  function openChatSession(session, messages) {
    activeSession = session;
    pinGatewayScreen.classList.add('hidden');
    chatDiscoveryScreen.classList.remove('hidden');

    chatProjectTitle.textContent = normalizeTextJeem(session.projectGroup || session.projectName);
    const rolePart = session.participantRole ? ` (${normalizeTextJeem(session.participantRole)})` : '';
    chatClientSubtitle.textContent = `${normalizeTextJeem(session.clientName)}${rolePart} • #${session.pin}`;

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

  function updateComposerActionButton() {
    const hasContent = messageInput.value.trim().length > 0 || Boolean(pendingMediaFile);
    if (hasContent) {
      sendMessageBtn.classList.remove('hidden');
      recordVoiceBtn.classList.add('hidden');
    } else {
      sendMessageBtn.classList.add('hidden');
      recordVoiceBtn.classList.remove('hidden');
    }
  }

  function clearPendingMedia() {
    pendingMediaFile = null;
    mediaUploadInput.value = '';
    mediaPreviewChip.classList.add('hidden');
    if (pendingThumbUrl) {
      URL.revokeObjectURL(pendingThumbUrl);
      pendingThumbUrl = null;
    }
    mediaPreviewThumb.src = '';
    mediaPreviewThumb.classList.add('hidden');
    updateComposerActionButton();
  }

  function setPendingMediaFile(file) {
    if (!file) {
      clearPendingMedia();
      return;
    }
    pendingMediaFile = file;
    mediaFileNameText.textContent = file.name || 'ملف مرفق';
    if (pendingThumbUrl) {
      URL.revokeObjectURL(pendingThumbUrl);
      pendingThumbUrl = null;
    }
    if (file.type && file.type.startsWith('image/')) {
      pendingThumbUrl = URL.createObjectURL(file);
      mediaPreviewThumb.src = pendingThumbUrl;
      mediaPreviewThumb.classList.remove('hidden');
    } else {
      mediaPreviewThumb.src = '';
      mediaPreviewThumb.classList.add('hidden');
    }
    mediaPreviewChip.classList.remove('hidden');
    updateComposerActionButton();
  }

  let typingTimeout = null;
  messageInput.addEventListener('input', () => {
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const normalized = normalizeTextJeem(messageInput.value);
    if (normalized !== messageInput.value) {
      messageInput.value = normalized;
      messageInput.setSelectionRange(start, end);
    }

    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 110)}px`;
    updateComposerActionButton();

    socket.emit('client:typing', { isTyping: messageInput.value.trim().length > 0 });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('client:typing', { isTyping: false });
    }, 2000);
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 640) {
      e.preventDefault();
      chatComposerForm.requestSubmit();
    }
  });

  // Support pasting screenshots directly from clipboard (Ctrl+V)
  messageInput.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          const pastedFile = new File([blob], `screenshot-${Date.now()}.${ext}`, { type: blob.type });
          setPendingMediaFile(pastedFile);
          break;
        }
      }
    }
  });

  // Support drag-and-drop images/audio onto the composer
  if (chatComposerWrapper) {
    ['dragenter', 'dragover'].forEach((evt) => {
      chatComposerWrapper.addEventListener(evt, (e) => {
        e.preventDefault();
        chatComposerWrapper.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      chatComposerWrapper.addEventListener(evt, (e) => {
        e.preventDefault();
        chatComposerWrapper.classList.remove('drag-over');
      });
    });
    chatComposerWrapper.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        setPendingMediaFile(file);
      }
    });
  }

  triggerUploadBtn.addEventListener('click', () => {
    mediaUploadInput.click();
  });

  mediaUploadInput.addEventListener('change', () => {
    const file = mediaUploadInput.files[0];
    setPendingMediaFile(file || null);
  });

  removeMediaBtn.addEventListener('click', () => {
    clearPendingMedia();
  });

  // Lightbox close handlers
  if (closeLightboxBtn && imageLightboxModal) {
    closeLightboxBtn.addEventListener('click', () => imageLightboxModal.classList.add('hidden'));
    imageLightboxModal.addEventListener('click', (e) => {
      if (e.target === imageLightboxModal) imageLightboxModal.classList.add('hidden');
    });
  }

  function formatDurationMMSS(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = String(totalSec % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function stopRecordingStream() {
    if (recordingTimerInterval) {
      clearInterval(recordingTimerInterval);
      recordingTimerInterval = null;
    }
    if (recordingStream) {
      recordingStream.getTracks().forEach((t) => t.stop());
      recordingStream = null;
    }
  }

  async function sendClientPayload({ text = '', file = null, audioDuration = '' }) {
    if (isSubmittingMessage || !activeSession) return;
    if (!text && !file) return;

    isSubmittingMessage = true;
    sendMessageBtn.disabled = true;
    recordVoiceBtn.disabled = true;
    triggerUploadBtn.disabled = true;

    const formData = new FormData();
    formData.append('content', text);
    if (audioDuration) {
      formData.append('audio_duration', audioDuration);
    }
    if (file) {
      formData.append('media', file);
    }

    messageInput.value = '';
    messageInput.style.height = 'auto';
    clearPendingMedia();
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
    } catch {
      typingIndicatorRow.classList.add('hidden');
      alert('حدث خطأ في الاتصال بالخادم.');
    } finally {
      isSubmittingMessage = false;
      sendMessageBtn.disabled = false;
      recordVoiceBtn.disabled = false;
      triggerUploadBtn.disabled = false;
      updateComposerActionButton();
      messageInput.focus();
    }
  }

  recordVoiceBtn.addEventListener('click', async () => {
    if (isSubmittingMessage || !activeSession) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('متصفحك لا يدعم تسجيل الصوت مباشرة، يمكنك إرفاق ملف صوتي عبر زر المشبك.');
      return;
    }

    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m)
      );
      mediaRecorder = preferredMime ? new MediaRecorder(recordingStream, { mimeType: preferredMime }) : new MediaRecorder(recordingStream);
      recordingChunks = [];
      isRecordingCancelled = false;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordingChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const durationStr = formatDurationMMSS(Date.now() - recordingStartTime);
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        stopRecordingStream();
        voiceRecordingBar.classList.add('hidden');
        chatComposerForm.classList.remove('hidden');

        if (isRecordingCancelled || recordingChunks.length === 0) {
          return;
        }

        const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
        const audioBlob = new Blob(recordingChunks, { type: mimeType });
        const voiceFile = new File([audioBlob], `voice-${Date.now()}.${ext}`, { type: mimeType });
        await sendClientPayload({ text: '', file: voiceFile, audioDuration: durationStr });
      };

      recordingStartTime = Date.now();
      recordingTimerText.textContent = '0:00';
      chatComposerForm.classList.add('hidden');
      voiceRecordingBar.classList.remove('hidden');

      recordingTimerInterval = setInterval(() => {
        recordingTimerText.textContent = formatDurationMMSS(Date.now() - recordingStartTime);
      }, 400);

      mediaRecorder.start();
    } catch {
      stopRecordingStream();
      alert('تعذر الوصول إلى الميكروفون. يرجى السماح بصلاحية الميكروفون في المتصفح.');
    }
  });

  cancelRecordingBtn.addEventListener('click', () => {
    isRecordingCancelled = true;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      stopRecordingStream();
      voiceRecordingBar.classList.add('hidden');
      chatComposerForm.classList.remove('hidden');
    }
  });

  sendRecordingBtn.addEventListener('click', () => {
    isRecordingCancelled = false;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  });

  chatComposerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = normalizeTextJeem(messageInput.value.trim());
    const file = pendingMediaFile;
    await sendClientPayload({ text, file });
  });

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

  tryRestoreExistingSession();
})();
