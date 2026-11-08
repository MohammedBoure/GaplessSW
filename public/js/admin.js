/**
 * Gapless Admin Management Dashboard Logic (public/js/admin.js)
 *
 * Handles:
 * - Admin authentication (admin / admin123)
 * - Creating, editing, revoking, reactivating, and deleting 4-digit PINs
 * - Custom Instructions & Model Persona configuration per PIN
 * - Live tracking of IP brute-force lockouts & manual IP unblocking/locking
 * - Security & Prompt Injection audit logs
 */
(function () {
  const adminAuthOverlay = document.getElementById('adminAuthOverlay');
  const adminLoginForm = document.getElementById('adminLoginForm');
  const adminUsernameInput = document.getElementById('adminUsername');
  const adminPasswordInput = document.getElementById('adminPassword');
  const adminLoginError = document.getElementById('adminLoginError');
  const adminLogoutBtn = document.getElementById('adminLogoutBtn');

  const statTotalPins = document.getElementById('statTotalPins');
  const statActivePins = document.getElementById('statActivePins');
  const statLockedIps = document.getElementById('statLockedIps');

  const pinConfigForm = document.getElementById('pinConfigForm');
  const pinFormTitle = document.getElementById('pinFormTitle');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const editingPinId = document.getElementById('editingPinId');
  const pinCodeInput = document.getElementById('pinCodeInput');
  const generateRandomPinBtn = document.getElementById('generateRandomPinBtn');
  const clientNameInput = document.getElementById('clientNameInput');
  const projectNameInput = document.getElementById('projectNameInput');
  const personaSelect = document.getElementById('personaSelect');
  const customInstructionsInput = document.getElementById('customInstructionsInput');
  const savePinBtn = document.getElementById('savePinBtn');

  const pinsListContainer = document.getElementById('pinsListContainer');
  const rateLimitsContainer = document.getElementById('rateLimitsContainer');
  const securityEventsContainer = document.getElementById('securityEventsContainer');
  const refreshOverviewBtn = document.getElementById('refreshOverviewBtn');
  const manualLockIpInput = document.getElementById('manualLockIpInput');
  const manualLockIpBtn = document.getElementById('manualLockIpBtn');

  let adminToken = localStorage.getItem('gapless_admin_token') || null;
  let allPins = [];
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

  const PERSONA_LABELS = {
    friendly_consultant: '🤝 مستشار ودود (Friendly Consultant)',
    concise_direct: '⚡ مختصر ومباشر (Concise & Direct)',
    technical_analyst: '🧠 محلل تقني (Technical Analyst)'
  };

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {})
    };
  }

  // Normalize '٩' -> 'ج' on text inputs
  [clientNameInput, projectNameInput, customInstructionsInput].forEach((input) => {
    input.addEventListener('input', () => {
      const fixed = normalizeTextJeem(input.value);
      if (fixed !== input.value) input.value = fixed;
    });
  });

  // Generate random 4-digit PIN
  generateRandomPinBtn.addEventListener('click', () => {
    const random4 = String(Math.floor(1000 + Math.random() * 9000));
    pinCodeInput.value = random4;
  });

  // ============================================================================
  // 1. Authentication
  // ============================================================================
  adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    adminLoginError.classList.add('hidden');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: adminUsernameInput.value.trim(),
          password: adminPasswordInput.value
        })
      });
      const data = await res.json();
      if (!res.ok) {
        adminLoginError.textContent = data.error || 'فشل تسجيل الدخول';
        adminLoginError.classList.remove('hidden');
        return;
      }

      adminToken = data.token;
      localStorage.setItem('gapless_admin_token', adminToken);
      adminAuthOverlay.classList.add('hidden');
      socket.emit('dev:join', { token: adminToken });
      await loadOverview();
    } catch {
      adminLoginError.textContent = 'خطأ في الاتصال بالخادم.';
      adminLoginError.classList.remove('hidden');
    }
  });

  adminLogoutBtn.addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    localStorage.removeItem('gapless_admin_token');
    adminToken = null;
    adminAuthOverlay.classList.remove('hidden');
  });

  // ============================================================================
  // 2. Load & Render Dashboard Data
  // ============================================================================
  async function loadOverview() {
    try {
      const res = await fetch('/api/admin/overview', { headers: authHeaders() });
      if (res.status === 401) {
        adminAuthOverlay.classList.remove('hidden');
        return;
      }
      const data = await res.json();
      adminAuthOverlay.classList.add('hidden');
      socket.emit('dev:join', { token: adminToken });

      allPins = data.pins || [];
      renderPinsList(allPins);
      renderRateLimits(data.rateLimits || []);
      renderSecurityEvents(data.securityEvents || []);

      statTotalPins.textContent = allPins.length;
      statActivePins.textContent = allPins.filter((p) => p.status === 'active').length;
      statLockedIps.textContent = (data.rateLimits || []).filter((r) => r.is_locked).length;
    } catch (err) {
      console.error('Error loading overview:', err);
    }
  }

  function renderPinsList(pins) {
    if (!pins.length) {
      pinsListContainer.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:24px;">لا توجد رموز PIN مسجلة حالياً. أنشئ رمزاً جديداً من النموذج الجانبي.</div>`;
      return;
    }

    pinsListContainer.innerHTML = pins
      .map((item) => {
        const isActive = item.status === 'active';
        const personaLabel = PERSONA_LABELS[item.persona] || item.persona;
        return `
          <div class="card" style="background:var(--bg-primary); padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:12px;">
                <span class="pin-code-pill">${escapeHtml(item.pin)}</span>
                <div>
                  <div style="font-weight:700; font-size:1rem;">
                    ${escapeHtml(item.client_name)} — <span style="color:var(--accent-secondary);">${escapeHtml(item.project_name)}</span>
                  </div>
                  <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
                    <span class="badge ${isActive ? 'badge-active' : 'badge-revoked'}">
                      ${isActive ? '● نشط (Active)' : '⊘ موقوف (Revoked)'}
                    </span>
                    <span class="badge badge-persona">${escapeHtml(personaLabel)}</span>
                    <span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-secondary);">
                      💬 ${item.message_count || 0} رسالة
                    </span>
                  </div>
                </div>
              </div>

              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <a href="/dev?pinId=${encodeURIComponent(item.id)}" class="btn btn-emerald btn-sm">
                  🕵️‍♂️ مراقبة Co-Pilot
                </a>
                <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="${escapeHtml(item.id)}">
                  ✏️ تعديل
                </button>
                <button type="button" class="btn btn-amber btn-sm" data-action="toggle-status" data-id="${escapeHtml(item.id)}" data-status="${isActive ? 'revoked' : 'active'}">
                  ${isActive ? '⏸ إيقاف الرمز' : '▶ تفعيل الرمز'}
                </button>
                <button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="${escapeHtml(item.id)}">
                  🗑 حذف
                </button>
              </div>
            </div>

            <div style="margin-top:12px; padding:10px 12px; background:rgba(30,41,59,0.55); border-radius:8px; border-right:3px solid var(--accent-primary); font-size:0.84rem; color:var(--text-secondary);">
              <strong style="color:var(--text-primary);">التعليمات والتوصيات المخصصة للعميل:</strong><br/>
              ${item.custom_instructions ? escapeHtml(item.custom_instructions) : '<em>لا توجد تعليمات خاصة مضافة.</em>'}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderRateLimits(rateLimits) {
    statLockedIps.textContent = rateLimits.filter((r) => r.is_locked).length;

    if (!rateLimits.length) {
      rateLimitsContainer.innerHTML = `<div style="font-size:0.84rem; color:var(--text-muted); padding:10px 0;">لا توجد محاولات دخول خاطئة أو عناوين IP محظورة حالياً. ✅</div>`;
      return;
    }

    rateLimitsContainer.innerHTML = rateLimits
      .map((rl) => {
        const mins = Math.floor((rl.remaining_seconds || 0) / 60);
        const secs = (rl.remaining_seconds || 0) % 60;
        const timerStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        return `
          <div style="padding:12px; background:var(--bg-primary); border:1px solid ${rl.is_locked ? 'rgba(244,63,94,0.5)' : 'var(--border-subtle)'}; border-radius:10px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <div style="font-family:var(--font-mono); font-weight:700; font-size:0.9rem; direction:ltr; text-align:right;">
                IP: ${escapeHtml(rl.ip)}
              </div>
              <div style="font-size:0.78rem; color:${rl.is_locked ? '#fda4af' : 'var(--text-secondary)'}; margin-top:2px;">
                المحاولات الخاطئة: <strong>${rl.failed_attempts} / 5</strong>
                ${rl.is_locked ? ` • 🔒 محظور (متبقي <span style="font-family:var(--font-mono);">${timerStr}</span>)` : ''}
              </div>
            </div>
            <button type="button" class="btn btn-emerald btn-sm" data-unblock-ip="${escapeHtml(rl.ip)}">
              🔓 فك الحظر وتصفير العداد
            </button>
          </div>
        `;
      })
      .join('');
  }

  function renderSecurityEvents(events) {
    if (!events.length) {
      securityEventsContainer.innerHTML = `<div style="font-size:0.84rem; color:var(--text-muted);">لا توجد أحداث أمنية مسجلة.</div>`;
      return;
    }

    securityEventsContainer.innerHTML = events
      .map((ev) => {
        const isAlert = ev.event_type.includes('LOCKOUT') || ev.event_type.includes('INJECTION') || ev.event_type.includes('FAILED');
        const timeStr = new Date(ev.created_at).toLocaleTimeString('ar-DZ');
        return `
          <div style="padding:9px 12px; background:var(--bg-primary); border-radius:8px; border-right:3px solid ${isAlert ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-size:0.8rem; display:flex; justify-content:space-between; gap:10px;">
            <div>
              <strong style="color:${isAlert ? '#fda4af' : '#6ee7b7'};">[${escapeHtml(ev.event_type)}]</strong>
              <span style="color:var(--text-secondary); margin-right:6px;">${escapeHtml(ev.details)}</span>
            </div>
            <div style="color:var(--text-muted); font-family:var(--font-mono); white-space:nowrap; direction:ltr;">
              ${escapeHtml(ev.ip)} • ${timeStr}
            </div>
          </div>
        `;
      })
      .join('');
  }

  // ============================================================================
  // 3. Create / Edit / Toggle / Delete PIN Handlers
  // ============================================================================
  function resetPinForm() {
    editingPinId.value = '';
    pinFormTitle.textContent = '➕ إنشاء رمز PIN جديد لمشروع';
    savePinBtn.textContent = '💾 حفظ وتفعيل رمز العميل';
    cancelEditBtn.classList.add('hidden');
    pinConfigForm.reset();
  }

  cancelEditBtn.addEventListener('click', resetPinForm);

  pinConfigForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = editingPinId.value;
    const payload = {
      pin: pinCodeInput.value.trim(),
      client_name: normalizeTextJeem(clientNameInput.value.trim()),
      project_name: normalizeTextJeem(projectNameInput.value.trim()),
      persona: personaSelect.value,
      custom_instructions: normalizeTextJeem(customInstructionsInput.value.trim())
    };

    try {
      const url = id ? `/api/admin/pins/${id}` : '/api/admin/pins';
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'حدث خطأ أثناء حفظ الرمز.');
        return;
      }

      resetPinForm();
      await loadOverview();
    } catch {
      alert('تعذر الاتصال بالخادم.');
    }
  });

  pinsListContainer.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const pinObj = allPins.find((p) => p.id === id);
    if (!pinObj) return;

    if (action === 'edit') {
      editingPinId.value = pinObj.id;
      pinCodeInput.value = pinObj.pin;
      clientNameInput.value = pinObj.client_name;
      projectNameInput.value = pinObj.project_name;
      personaSelect.value = pinObj.persona;
      customInstructionsInput.value = pinObj.custom_instructions || '';
      pinFormTitle.textContent = `✏️ تعديل رمز العميل (#${pinObj.pin})`;
      savePinBtn.textContent = '💾 تحديث بيانات الرمز';
      cancelEditBtn.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'toggle-status') {
      const newStatus = btn.dataset.status;
      await fetch(`/api/admin/pins/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ status: newStatus })
      });
      await loadOverview();
    } else if (action === 'delete') {
      if (!confirm(`هل أنت متأكد من حذف رمز العميل (${pinObj.client_name} - #${pinObj.pin}) وجميع محادثاته؟`)) {
        return;
      }
      await fetch(`/api/admin/pins/${id}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      await loadOverview();
    }
  });

  // Unblock IP handler
  rateLimitsContainer.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-unblock-ip]');
    if (!btn) return;
    const ip = btn.dataset.unblockIp;
    await fetch('/api/admin/rate-limits/unblock', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ ip })
    });
    await loadOverview();
  });

  // Manual Lock IP handler
  manualLockIpBtn.addEventListener('click', async () => {
    const ip = manualLockIpInput.value.trim();
    if (!ip) return;
    await fetch('/api/admin/rate-limits/lock', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ ip })
    });
    manualLockIpInput.value = '';
    await loadOverview();
  });

  refreshOverviewBtn.addEventListener('click', loadOverview);

  // Real-time Socket Updates
  socket.on('security:rate_limit_updated', (list) => {
    renderRateLimits(list || []);
  });

  socket.on('admin:pins_updated', (pins) => {
    allPins = pins || [];
    renderPinsList(allPins);
  });

  socket.on('security:event', () => {
    loadOverview();
  });

  // Auto-refresh lockout timers every 3 seconds
  setInterval(() => {
    if (adminAuthOverlay.classList.contains('hidden')) {
      loadOverview();
    }
  }, 5000);

  // Initialize
  loadOverview();
})();
